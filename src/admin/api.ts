import {
  normalizeAdminState,
  normalizeRpcResult,
  type AdminApiConfig,
  type AdminOperationalState,
  type AuthSession,
  type RpcResult,
} from "./contracts.ts";

interface AuthResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

interface ApiOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class AdminApiError extends Error {
  readonly status: number | null;
  readonly kind: "auth" | "permission" | "timeout" | "network" | "request";

  constructor(
    message: string,
    options: {
      status?: number | null;
      kind?: AdminApiError["kind"];
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "AdminApiError";
    this.status = options.status ?? null;
    this.kind = options.kind ?? "request";
  }
}

export function createAdminApi(config: AdminApiConfig, options: ApiOptions = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 12_000;

  async function signIn(email: string, password: string): Promise<AuthSession> {
    const body = await requestJson(
      `${config.supabaseUrl}/auth/v1/token?grant_type=password`,
      {
        method: "POST",
        headers: authHeaders(config),
        body: JSON.stringify({ email, password }),
      },
    );
    if (!isAuthResponse(body)) {
      throw new AdminApiError("No se pudo iniciar sesión.", { kind: "auth" });
    }
    return toSession(body);
  }

  async function refresh(session: AuthSession): Promise<AuthSession | null> {
    try {
      const body = await requestJson(
        `${config.supabaseUrl}/auth/v1/token?grant_type=refresh_token`,
        {
          method: "POST",
          headers: authHeaders(config),
          body: JSON.stringify({ refresh_token: session.refreshToken }),
        },
      );
      return isAuthResponse(body) ? toSession(body) : null;
    } catch (error) {
      if (error instanceof AdminApiError && error.kind === "auth") return null;
      throw error;
    }
  }

  async function logout(session: AuthSession): Promise<void> {
    try {
      await requestJson(`${config.supabaseUrl}/auth/v1/logout`, {
        method: "POST",
        headers: authHeaders(config, session),
      });
    } catch {
      // Local logout must succeed even if Supabase cannot be reached.
    }
  }

  async function requestPasswordRecovery(email: string, redirectUrl: string): Promise<void> {
    const url = new URL(`${config.supabaseUrl}/auth/v1/recover`);
    url.searchParams.set("redirect_to", redirectUrl);
    await requestJson(url.toString(), {
      method: "POST",
      headers: authHeaders(config),
      body: JSON.stringify({ email }),
    });
  }

  async function updatePassword(session: AuthSession, password: string): Promise<void> {
    await requestJson(`${config.supabaseUrl}/auth/v1/user`, {
      method: "PUT",
      headers: authHeaders(config, session),
      body: JSON.stringify({ password }),
    });
  }

  async function loadState(session: AuthSession): Promise<AdminOperationalState> {
    const body = await rpcRequest(session, "get_admin_operational_state", {});
    return normalizeAdminState(body);
  }

  async function mutate(
    session: AuthSession,
    name: string,
    body: Record<string, unknown>,
  ): Promise<RpcResult> {
    return normalizeRpcResult(await rpcRequest(session, name, body));
  }

  async function publish(session: AuthSession): Promise<RpcResult> {
    const body = await requestJson(
      `${config.supabaseUrl}/functions/v1/publish-menu-changes`,
      {
        method: "POST",
        headers: authHeaders(config, session),
        body: "{}",
      },
      true,
    );
    const result = normalizeRpcResult(body);
    if (result.message === "unauthorized") {
      throw new AdminApiError("La sesión expiró. Volvé a iniciar sesión.", { kind: "auth" });
    }
    return result;
  }

  async function rpcRequest(
    session: AuthSession,
    name: string,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    return requestJson(`${config.supabaseUrl}/rest/v1/rpc/${encodeURIComponent(name)}`, {
      method: "POST",
      headers: authHeaders(config, session),
      body: JSON.stringify(body),
    });
  }

  async function requestJson(
    url: string,
    init: RequestInit,
    allowErrorResponse = false,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;

    try {
      response = await fetchImpl(url, {
        ...init,
        credentials: "omit",
        cache: "no-store",
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new AdminApiError(
          "La operación tardó demasiado. Revisá la conexión e intentá de nuevo.",
          { kind: "timeout", cause: error },
        );
      }
      throw new AdminApiError(
        "No pudimos conectar con el servicio. Revisá la conexión e intentá de nuevo.",
        { kind: "network", cause: error },
      );
    } finally {
      globalThis.clearTimeout(timeout);
    }

    const responseBody = await readJsonBody(response);
    if (!response.ok && !allowErrorResponse) {
      throw toApiError(response.status, responseBody);
    }
    return responseBody;
  }

  return {
    loadState,
    logout,
    mutate,
    publish,
    refresh,
    requestPasswordRecovery,
    signIn,
    updatePassword,
  };
}

export type AdminApi = ReturnType<typeof createAdminApi>;

export async function readJsonBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function authHeaders(config: AdminApiConfig, session?: AuthSession): HeadersInit {
  return {
    apikey: config.supabaseAnonKey,
    ...(session ? { Authorization: `Bearer ${session.accessToken}` } : {}),
    "Content-Type": "application/json",
  };
}

function isAuthResponse(value: unknown): value is AuthResponse {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<AuthResponse>;
  return typeof record.access_token === "string"
    && typeof record.refresh_token === "string"
    && typeof record.expires_in === "number"
    && record.expires_in > 0;
}

function toSession(value: AuthResponse): AuthSession {
  return {
    accessToken: value.access_token,
    refreshToken: value.refresh_token,
    expiresAt: Date.now() + value.expires_in * 1000,
  };
}

function toApiError(status: number, body: unknown): AdminApiError {
  const rawMessage = readErrorMessage(body).toLowerCase();

  if (status === 401 || rawMessage.includes("jwt") || rawMessage.includes("token")) {
    return new AdminApiError("La sesión expiró. Volvé a iniciar sesión.", {
      status,
      kind: "auth",
    });
  }
  if (status === 403 || rawMessage.includes("permission") || rawMessage.includes("authorized")) {
    return new AdminApiError("No tenés permisos para realizar esta acción.", {
      status,
      kind: "permission",
    });
  }
  if (status === 400 && rawMessage.includes("invalid login credentials")) {
    return new AdminApiError("El email o la contraseña no son correctos.", {
      status,
      kind: "auth",
    });
  }
  return new AdminApiError(
    status >= 500
      ? "El servicio no está disponible en este momento. Intentá de nuevo en unos minutos."
      : "No se pudo completar la operación. Revisá los datos e intentá de nuevo.",
    { status, kind: "request" },
  );
}

function readErrorMessage(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const record = body as Record<string, unknown>;
  const message = record.message ?? record.msg ?? record.error_description ?? record.error;
  return typeof message === "string" ? message : "";
}
