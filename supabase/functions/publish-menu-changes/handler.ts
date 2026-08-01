import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.111.0";
import {
  getCorsHeaders,
  isOriginAllowed,
  parseAllowedOrigins,
} from "../_shared/cors.ts";

const operation = "publish_menu_changes" as const;
const defaultCooldownSeconds = 60;
const maximumCooldownSeconds = 3600;
const defaultHookTimeoutMs = 10000;
const minimumHookTimeoutMs = 250;
const maximumHookTimeoutMs = 30000;

type PublishMessage =
  | "cors_origin_not_allowed"
  | "method_not_allowed"
  | "unauthorized"
  | "permission_denied"
  | "publish_not_configured"
  | "publish_cooldown"
  | "publish_already_queued"
  | "publish_queued"
  | "publish_failed"
  | "publish_state_uncertain";

interface PublishResponse {
  ok: boolean;
  changed: boolean;
  requires_redeploy: boolean;
  operation: typeof operation;
  message: PublishMessage;
  cooldown_seconds_remaining?: number;
  content_revision?: number;
}

interface ReservePublishRow {
  request_id: number | null;
  reserved: boolean;
  message: string;
  cooldown_remaining_seconds: number | null;
  content_revision: number | null;
}

interface CompletePublishRow {
  completed: boolean;
  message: string;
}

export type DeployHookMode = "vercel" | "test";

interface DeployHookConfig {
  mode: DeployHookMode;
  url: string;
  timeoutMs: number;
}

const jsonResponse = (
  request: Request,
  allowedOrigins: Set<string>,
  status: number,
  body: PublishResponse,
): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...getCorsHeaders(request, allowedOrigins),
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    },
  });

const responseBody = (
  ok: boolean,
  changed: boolean,
  requiresRedeploy: boolean,
  message: PublishMessage,
  options: {
    cooldownSecondsRemaining?: number;
    contentRevision?: number;
  } = {},
): PublishResponse => ({
  ok,
  changed,
  requires_redeploy: requiresRedeploy,
  operation,
  message,
  ...(options.cooldownSecondsRemaining === undefined
    ? {}
    : { cooldown_seconds_remaining: options.cooldownSecondsRemaining }),
  ...(options.contentRevision === undefined
    ? {}
    : { content_revision: options.contentRevision }),
});

const requiredEnv = (name: string): string | null => {
  const value = Deno.env.get(name)?.trim();
  return value && value.length > 0 ? value : null;
};

export const parseIntegerEnv = (
  rawValue: string | undefined,
  defaultValue: number,
  minimum: number,
  maximum: number,
): number | null => {
  if (rawValue === undefined || rawValue.trim() === "") {
    return defaultValue;
  }

  const normalized = rawValue.trim();

  if (!/^\d+$/.test(normalized)) {
    return null;
  }

  const value = Number(normalized);

  return Number.isSafeInteger(value) && value >= minimum && value <= maximum
    ? value
    : null;
};

export const getBearerToken = (request: Request): string | null => {
  const authorization = request.headers.get("Authorization");

  if (!authorization) {
    return null;
  }

  const [scheme, token] = authorization.trim().split(/\s+/, 2);

  return scheme?.toLowerCase() === "bearer" && token ? token : null;
};

export const validateDeployHookUrl = (
  rawValue: string,
  mode: DeployHookMode,
): string | null => {
  if (rawValue !== rawValue.trim() || /\s/.test(rawValue)) {
    return null;
  }

  try {
    const url = new URL(rawValue);

    if (url.username || url.password || url.hash) {
      return null;
    }

    if (mode === "vercel") {
      if (
        url.protocol !== "https:"
        || url.hostname !== "api.vercel.com"
        || !url.pathname.startsWith("/v1/integrations/deploy/")
      ) {
        return null;
      }
    } else {
      const loopbackHosts = new Set([
        "localhost",
        "127.0.0.1",
        "[::1]",
        "::1",
        "host.docker.internal",
      ]);

      if (
        !["http:", "https:"].includes(url.protocol)
        || !loopbackHosts.has(url.hostname)
      ) {
        return null;
      }
    }

    return url.toString();
  } catch {
    return null;
  }
};

const getDeployHookConfig = (): DeployHookConfig | null => {
  const rawMode = (Deno.env.get("DEPLOY_HOOK_MODE") ?? "vercel").trim();

  if (rawMode !== "vercel" && rawMode !== "test") {
    return null;
  }

  const rawUrl = Deno.env.get("VERCEL_DEPLOY_HOOK_URL");
  const timeoutMs = parseIntegerEnv(
    Deno.env.get("DEPLOY_HOOK_TIMEOUT_MS"),
    defaultHookTimeoutMs,
    minimumHookTimeoutMs,
    maximumHookTimeoutMs,
  );

  if (!rawUrl || timeoutMs === null) {
    return null;
  }

  const url = validateDeployHookUrl(rawUrl, rawMode);

  return url ? { mode: rawMode, url, timeoutMs } : null;
};

export const extractHookJobId = async (response: Response): Promise<string | null> => {
  const contentType = response.headers.get("Content-Type") ?? "";

  if (!contentType.toLowerCase().includes("application/json")) {
    return null;
  }

  try {
    const body = await response.clone().json();
    const candidates = [
      body?.job?.id,
      body?.jobId,
      body?.deployment?.id,
      body?.id,
    ];

    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim().length > 0) {
        return candidate.trim().slice(0, 160);
      }
    }
  } catch {
    return null;
  }

  return null;
};

export const deferredPublishMessage = (
  reserveMessage: string,
): "publish_cooldown" | "publish_already_queued" | null => {
  if (reserveMessage === "publish_cooldown") {
    return "publish_cooldown";
  }

  if (reserveMessage === "publish_already_queued") {
    return "publish_already_queued";
  }

  return null;
};

const completePublishRequest = async (
  serviceClient: SupabaseClient,
  params: {
    requestId: number;
    publishStatus: "succeeded" | "failed";
    publishMessage: "publish_queued" | "publish_failed";
    hookStatusCode: number | null;
    hookJobId: string | null;
    phase: string;
  },
): Promise<boolean> => {
  try {
    const { data, error } = await serviceClient.rpc("complete_menu_publish_request", {
      p_request_id: params.requestId,
      p_publish_status: params.publishStatus,
      p_publish_message: params.publishMessage,
      p_hook_status_code: params.hookStatusCode,
      p_hook_job_id: params.hookJobId,
    });

    const row = Array.isArray(data)
      ? data[0] as CompletePublishRow | undefined
      : data as CompletePublishRow | null;

    if (!error && row?.completed === true) {
      return true;
    }

    console.error("publish completion logging failed", {
      request_id: params.requestId,
      phase: params.phase,
      error_code: error?.code ?? null,
      result_message: row?.message ?? null,
    });
  } catch {
    console.error("publish completion logging failed", {
      request_id: params.requestId,
      phase: params.phase,
      error_code: "rpc_exception",
    });
  }

  return false;
};

export const handlePublishRequest = async (request: Request): Promise<Response> => {
  const allowedOrigins = parseAllowedOrigins(Deno.env.get("PUBLISH_ALLOWED_ORIGINS"));
  const origin = request.headers.get("Origin");

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: isOriginAllowed(origin, allowedOrigins) ? 204 : 403,
      headers: getCorsHeaders(request, allowedOrigins),
    });
  }

  if (!isOriginAllowed(origin, allowedOrigins)) {
    return jsonResponse(
      request,
      allowedOrigins,
      403,
      responseBody(false, false, true, "cors_origin_not_allowed"),
    );
  }

  if (request.method !== "POST") {
    return jsonResponse(
      request,
      allowedOrigins,
      405,
      responseBody(false, false, true, "method_not_allowed"),
    );
  }

  const token = getBearerToken(request);

  if (!token) {
    return jsonResponse(
      request,
      allowedOrigins,
      401,
      responseBody(false, false, true, "unauthorized"),
    );
  }

  const supabaseUrl = requiredEnv("SUPABASE_URL");
  const supabaseAnonKey = requiredEnv("SUPABASE_ANON_KEY");

  if (!supabaseUrl || !supabaseAnonKey) {
    return jsonResponse(
      request,
      allowedOrigins,
      500,
      responseBody(false, false, true, "publish_not_configured"),
    );
  }

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const {
    data: { user },
    error: userError,
  } = await userClient.auth.getUser(token);

  if (userError || !user) {
    return jsonResponse(
      request,
      allowedOrigins,
      401,
      responseBody(false, false, true, "unauthorized"),
    );
  }

  const { data: canPublish, error: permissionError } = await userClient.rpc(
    "can_publish_menu",
  );

  if (permissionError || canPublish !== true) {
    return jsonResponse(
      request,
      allowedOrigins,
      403,
      responseBody(false, false, true, "permission_denied"),
    );
  }

  const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const deployHook = getDeployHookConfig();
  const cooldownSeconds = parseIntegerEnv(
    Deno.env.get("PUBLISH_COOLDOWN_SECONDS"),
    defaultCooldownSeconds,
    0,
    maximumCooldownSeconds,
  );

  if (!serviceRoleKey || !deployHook || cooldownSeconds === null) {
    return jsonResponse(
      request,
      allowedOrigins,
      500,
      responseBody(false, false, true, "publish_not_configured"),
    );
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: reserveData, error: reserveError } = await serviceClient.rpc(
    "reserve_menu_publish_request",
    {
      p_user_id: user.id,
      p_cooldown_seconds: cooldownSeconds,
    },
  );

  const reserveRow = Array.isArray(reserveData)
    ? reserveData[0] as ReservePublishRow | undefined
    : reserveData as ReservePublishRow | null;

  if (reserveError || !reserveRow || reserveRow.content_revision === null) {
    return jsonResponse(
      request,
      allowedOrigins,
      502,
      responseBody(false, false, true, "publish_failed"),
    );
  }

  const contentRevision = Number(reserveRow.content_revision);
  const responseOptions = {
    contentRevision,
    ...(Number.isSafeInteger(reserveRow.cooldown_remaining_seconds)
      ? { cooldownSecondsRemaining: Math.max(0, reserveRow.cooldown_remaining_seconds ?? 0) }
      : {}),
  };

  if (!reserveRow.reserved) {
    const deferredMessage = deferredPublishMessage(reserveRow.message);

    if (deferredMessage) {
      return jsonResponse(
        request,
        allowedOrigins,
        200,
        responseBody(true, false, true, deferredMessage, responseOptions),
      );
    }

    return jsonResponse(
      request,
      allowedOrigins,
      403,
      responseBody(false, false, true, "permission_denied", responseOptions),
    );
  }

  if (reserveRow.request_id === null) {
    return jsonResponse(
      request,
      allowedOrigins,
      502,
      responseBody(false, false, true, "publish_failed", responseOptions),
    );
  }

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), deployHook.timeoutMs);
  let hookResponse: Response;

  try {
    hookResponse = await fetch(deployHook.url, {
      method: "POST",
      headers: {
        "Idempotency-Key": `il-figlio-menu-${reserveRow.request_id}`,
        "User-Agent": "il-figlio-publish-menu-changes/1",
      },
      signal: abortController.signal,
    });
  } catch {
    clearTimeout(timeoutId);
    const completionRecorded = await completePublishRequest(serviceClient, {
      requestId: reserveRow.request_id,
      publishStatus: "failed",
      publishMessage: "publish_failed",
      hookStatusCode: null,
      hookJobId: null,
      phase: "hook_fetch_failed",
    });

    return jsonResponse(
      request,
      allowedOrigins,
      502,
      responseBody(
        false,
        false,
        true,
        completionRecorded ? "publish_failed" : "publish_state_uncertain",
        responseOptions,
      ),
    );
  } finally {
    clearTimeout(timeoutId);
  }

  const hookJobId = await extractHookJobId(hookResponse);

  if (!hookResponse.ok) {
    const completionRecorded = await completePublishRequest(serviceClient, {
      requestId: reserveRow.request_id,
      publishStatus: "failed",
      publishMessage: "publish_failed",
      hookStatusCode: hookResponse.status,
      hookJobId,
      phase: "hook_response_failed",
    });

    return jsonResponse(
      request,
      allowedOrigins,
      502,
      responseBody(
        false,
        false,
        true,
        completionRecorded ? "publish_failed" : "publish_state_uncertain",
        responseOptions,
      ),
    );
  }

  const completionRecorded = await completePublishRequest(serviceClient, {
    requestId: reserveRow.request_id,
    publishStatus: "succeeded",
    publishMessage: "publish_queued",
    hookStatusCode: hookResponse.status,
    hookJobId,
    phase: "hook_response_succeeded",
  });

  if (!completionRecorded) {
    return jsonResponse(
      request,
      allowedOrigins,
      502,
      responseBody(false, false, true, "publish_state_uncertain", responseOptions),
    );
  }

  return jsonResponse(
    request,
    allowedOrigins,
    200,
    responseBody(true, true, false, "publish_queued", {
      contentRevision,
      cooldownSecondsRemaining: cooldownSeconds,
    }),
  );
};
