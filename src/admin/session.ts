import type { AdminApi } from "./api.ts";
import type { AuthSession } from "./contracts.ts";

const SESSION_STORAGE_KEY = "il-figlio-admin-session";

interface RecoveryLocationResult {
  session: AuthSession | null;
  isRecovery: boolean;
  sanitizedUrl: string;
}

export function createSessionManager(api: AdminApi) {
  let currentSession: AuthSession | null = null;

  async function start(): Promise<{ session: AuthSession | null; recovery: boolean }> {
    const recoveryLocation = readRecoverySessionFromUrl(window.location.href);
    if (recoveryLocation.sanitizedUrl !== window.location.href) {
      window.history.replaceState({}, document.title, recoveryLocation.sanitizedUrl);
    }
    if (recoveryLocation.isRecovery && recoveryLocation.session) {
      currentSession = recoveryLocation.session;
      saveStoredSession(currentSession);
      return { session: currentSession, recovery: true };
    }

    currentSession = await getValidStoredSession();
    return { session: currentSession, recovery: false };
  }

  async function signIn(email: string, password: string): Promise<AuthSession> {
    currentSession = await api.signIn(email, password);
    saveStoredSession(currentSession);
    return currentSession;
  }

  async function requireSession(): Promise<AuthSession> {
    const candidate = currentSession ?? readStoredSession();
    if (!candidate) throw new Error("La sesión expiró. Volvé a iniciar sesión.");

    if (candidate.expiresAt - Date.now() > 60_000) {
      currentSession = candidate;
      return candidate;
    }

    const refreshed = await api.refresh(candidate);
    if (!refreshed) {
      clearStoredSession();
      currentSession = null;
      throw new Error("La sesión expiró. Volvé a iniciar sesión.");
    }
    currentSession = refreshed;
    saveStoredSession(refreshed);
    return refreshed;
  }

  async function logout(): Promise<void> {
    const session = currentSession ?? readStoredSession();
    currentSession = null;
    clearStoredSession();
    if (session) await api.logout(session);
  }

  function clear(): void {
    currentSession = null;
    clearStoredSession();
  }

  async function getValidStoredSession(): Promise<AuthSession | null> {
    const stored = readStoredSession();
    if (!stored) return null;
    if (stored.expiresAt - Date.now() > 60_000) return stored;
    const refreshed = await api.refresh(stored);
    if (!refreshed) {
      clearStoredSession();
      return null;
    }
    saveStoredSession(refreshed);
    return refreshed;
  }

  return { clear, logout, requireSession, signIn, start };
}

export type SessionManager = ReturnType<typeof createSessionManager>;

export function readRecoverySessionFromUrl(urlValue: string): RecoveryLocationResult {
  const url = new URL(urlValue);
  const hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));
  const type = hashParams.get("type");
  const isRecovery = type === "recovery" || type === "invite";
  const accessToken = hashParams.get("access_token");
  const refreshToken = hashParams.get("refresh_token");
  const expiresIn = Number(hashParams.get("expires_in") ?? "3600");
  const sensitiveQueryKeys = ["access_token", "refresh_token", "expires_in", "type"];
  const hasSensitiveQuery = sensitiveQueryKeys.some((key) => url.searchParams.has(key));
  const hasSensitiveHash = sensitiveQueryKeys.some((key) => hashParams.has(key));

  if (hasSensitiveQuery) {
    for (const key of sensitiveQueryKeys) url.searchParams.delete(key);
  }
  if (hasSensitiveHash) url.hash = "";

  const validSession = isRecovery
    && Boolean(accessToken)
    && Boolean(refreshToken)
    && Number.isFinite(expiresIn)
    && expiresIn > 0;

  return {
    isRecovery,
    sanitizedUrl: url.toString(),
    session: validSession
      ? {
          accessToken: accessToken as string,
          refreshToken: refreshToken as string,
          expiresAt: Date.now() + expiresIn * 1000,
        }
      : null,
  };
}

function readStoredSession(): AuthSession | null {
  try {
    const value = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!value) return null;
    const parsed = JSON.parse(value) as Partial<AuthSession>;
    if (
      typeof parsed.accessToken !== "string"
      || typeof parsed.refreshToken !== "string"
      || typeof parsed.expiresAt !== "number"
    ) {
      clearStoredSession();
      return null;
    }
    return parsed as AuthSession;
  } catch {
    return null;
  }
}

function saveStoredSession(session: AuthSession): void {
  try {
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Private browsing/storage restrictions must not prevent the current session.
  }
}

function clearStoredSession(): void {
  try {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
    localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // There is no local state left to depend on if storage is unavailable.
  }
}
