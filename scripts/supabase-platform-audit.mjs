import { parseRuntimeState } from "../public/scripts/menu-runtime-state.js";

const protectedSchemaProbes = [
  { schema: "app_private", table: "admin_users" },
  { schema: "menu_content", table: "menu_categories" },
];

const requestTimeoutMs = 10_000;

export async function auditSupabasePlatformSurface({
  supabaseUrl,
  supabaseAnonKey,
  fetchImpl = fetch,
}) {
  const failures = [];

  failures.push(...(await auditPublicRuntimeState({
    supabaseUrl,
    supabaseAnonKey,
    fetchImpl,
  })));
  failures.push(...(await auditProtectedSchemasNotExposed({
    supabaseUrl,
    supabaseAnonKey,
    fetchImpl,
  })));

  return failures;
}

export async function auditPublicRuntimeState({
  supabaseUrl,
  supabaseAnonKey,
  fetchImpl = fetch,
}) {
  const normalizedSupabaseUrl = normalizeSupabaseUrl(supabaseUrl);
  let response;

  try {
    response = await fetchImpl(
      `${normalizedSupabaseUrl}/rest/v1/rpc/get_public_runtime_state`,
      {
        method: "POST",
        headers: requestHeaders(supabaseAnonKey, {
          "Content-Type": "application/json",
        }),
        body: "{}",
        signal: AbortSignal.timeout(requestTimeoutMs),
      },
    );
  } catch (error) {
    return [`Public runtime Data API probe failed: ${errorMessage(error)}`];
  }

  const body = await readJsonBody(response);

  if (!response.ok) {
    return [
      `Public runtime Data API probe returned status ${response.status} (code ${responseCode(body)}).`,
    ];
  }

  try {
    parseRuntimeState(body);
  } catch {
    return ["Public runtime Data API probe returned an invalid contract."];
  }

  return [];
}

export async function auditProtectedSchemasNotExposed({
  supabaseUrl,
  supabaseAnonKey,
  fetchImpl = fetch,
}) {
  const normalizedSupabaseUrl = normalizeSupabaseUrl(supabaseUrl);
  const failures = [];

  for (const probe of protectedSchemaProbes) {
    let response;

    try {
      response = await fetchImpl(
        `${normalizedSupabaseUrl}/rest/v1/${probe.table}?select=*&limit=0`,
        {
          headers: requestHeaders(supabaseAnonKey, {
            "Accept-Profile": probe.schema,
          }),
          signal: AbortSignal.timeout(requestTimeoutMs),
        },
      );
    } catch (error) {
      failures.push(
        `Data API exposure probe failed for ${probe.schema}: ${errorMessage(error)}`,
      );
      continue;
    }

    const body = await readJsonBody(response);

    if (response.status !== 406 || body?.code !== "PGRST106") {
      failures.push(
        `Protected schema ${probe.schema} did not return PGRST106 ` +
          `(status ${response.status}, code ${responseCode(body)}).`,
      );
    }
  }

  return failures;
}

function requestHeaders(supabaseAnonKey, additionalHeaders = {}) {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${supabaseAnonKey}`,
    apikey: supabaseAnonKey,
    ...additionalHeaders,
  };
}

function normalizeSupabaseUrl(supabaseUrl) {
  return supabaseUrl.replace(/\/+$/, "");
}

async function readJsonBody(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function responseCode(body) {
  return typeof body?.code === "string" ? body.code : "unknown";
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
