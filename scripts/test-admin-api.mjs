import assert from "node:assert/strict";
import test from "node:test";

import { AdminApiError, createAdminApi } from "../src/admin/api.ts";
import { readRecoverySessionFromUrl } from "../src/admin/session.ts";

const config = {
  supabaseUrl: "https://project.supabase.co",
  supabaseAnonKey: "public-anon-key",
  deployedRevision: 1,
};

const session = {
  accessToken: "access-token",
  refreshToken: "refresh-token",
  expiresAt: Date.now() + 3_600_000,
};

test("password login uses the manual Auth REST contract without cookies", async () => {
  const calls = [];
  const api = createAdminApi(config, {
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return Response.json({
        access_token: "new-access",
        refresh_token: "new-refresh",
        expires_in: 3600,
        user: { id: "user" },
      });
    },
  });

  const result = await api.signIn("admin@example.com", "secret-password");
  assert.equal(result.accessToken, "new-access");
  assert.equal(calls[0].url, "https://project.supabase.co/auth/v1/token?grant_type=password");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.credentials, "omit");
  assert.equal(calls[0].init.headers.apikey, "public-anon-key");
  assert.equal("Authorization" in calls[0].init.headers, false);
});

test("authenticated RPC sends bearer and apikey with the exact function body", async () => {
  const calls = [];
  const api = createAdminApi(config, {
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return Response.json({
        ok: true,
        changed: true,
        requires_redeploy: false,
        operation: "set_item_availability",
        message: "availability_updated",
        revision: 3,
      });
    },
  });

  await api.mutate(session, "set_item_availability", {
    p_item_id: "00000000-0000-4000-8000-000000000001",
    p_available: false,
    p_expected_updated_at: null,
  });

  assert.equal(
    calls[0].url,
    "https://project.supabase.co/rest/v1/rpc/set_item_availability",
  );
  assert.equal(calls[0].init.headers.Authorization, "Bearer access-token");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    p_item_id: "00000000-0000-4000-8000-000000000001",
    p_available: false,
    p_expected_updated_at: null,
  });
});

test("publish invokes the fixed Edge endpoint with an empty JSON object", async () => {
  const calls = [];
  const api = createAdminApi(config, {
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return Response.json({
        ok: true,
        changed: true,
        requires_redeploy: true,
        operation: "publish_menu_changes",
        message: "publish_queued",
        content_revision: 5,
      });
    },
  });

  const result = await api.publish(session);
  assert.equal(result.message, "publish_queued");
  assert.equal(calls[0].url, "https://project.supabase.co/functions/v1/publish-menu-changes");
  assert.equal(calls[0].init.body, "{}");
  assert.equal(calls[0].init.headers.Authorization, "Bearer access-token");
  assert.equal(calls[0].init.headers.apikey, "public-anon-key");
});

test("request timeout becomes a recoverable Spanish error", async () => {
  const api = createAdminApi(config, {
    timeoutMs: 5,
    fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }),
  });

  await assert.rejects(
    () => api.signIn("admin@example.com", "password"),
    (error) => error instanceof AdminApiError
      && error.kind === "timeout"
      && /tardó demasiado/.test(error.message),
  );
});

test("recovery parser extracts tokens and sanitizes the browser URL", () => {
  const parsed = readRecoverySessionFromUrl(
    "https://ilfiglio.example/admin/?tracking=1#access_token=access&refresh_token=refresh&expires_in=3600&type=recovery",
  );

  assert.equal(parsed.isRecovery, true);
  assert.equal(parsed.session?.accessToken, "access");
  assert.equal(parsed.session?.refreshToken, "refresh");
  assert.equal(parsed.sanitizedUrl, "https://ilfiglio.example/admin/?tracking=1");
  assert.equal(parsed.sanitizedUrl.includes("access_token"), false);
});
