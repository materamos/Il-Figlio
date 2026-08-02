import assert from "node:assert/strict";
import test from "node:test";
import {
  auditProtectedSchemasNotExposed,
  auditSupabasePlatformSurface,
} from "../../scripts/supabase-platform-audit.mjs";

const publicRuntimeBody = {
  schema_version: 1,
  business: {
    status: "closed",
    message: null,
  },
  availability: [],
};

test("platform audit validates public runtime before protected schemas", async () => {
  const requests = [];
  const failures = await auditSupabasePlatformSurface({
    supabaseUrl: "https://example.supabase.co/",
    supabaseAnonKey: "public-anon-key",
    async fetchImpl(url, options) {
      requests.push({ url, options });

      if (url.includes("/rpc/get_public_runtime_state")) {
        return jsonResponse(200, [{ get_public_runtime_state: publicRuntimeBody }]);
      }

      return jsonResponse(406, { code: "PGRST106" });
    },
  });

  assert.deepEqual(failures, []);
  assert.equal(requests.length, 3);
  assert.equal(
    requests[0].url,
    "https://example.supabase.co/rest/v1/rpc/get_public_runtime_state",
  );
  assert.equal(requests[0].options.method, "POST");
  assert.equal(requests[0].options.headers.apikey, "public-anon-key");
  assert.equal(
    requests[0].options.headers.Authorization,
    "Bearer public-anon-key",
  );
  assert.deepEqual(
    requests.slice(1).map((request) => request.options.headers["Accept-Profile"]),
    ["app_private", "menu_content"],
  );
  assert.ok(requests.every((request) => request.options.signal instanceof AbortSignal));
});

test("platform audit rejects an invalid public runtime control", async () => {
  const failures = await auditSupabasePlatformSurface({
    supabaseUrl: "https://example.supabase.co",
    supabaseAnonKey: "public-anon-key",
    async fetchImpl(url) {
      if (url.includes("/rpc/get_public_runtime_state")) {
        return jsonResponse(200, { schema_version: 1 });
      }

      return jsonResponse(406, { code: "PGRST106" });
    },
  });

  assert.deepEqual(failures, [
    "Public runtime Data API probe returned an invalid contract.",
  ]);
});

test("protected schema probes fail closed on non-PGRST106 responses", async () => {
  const responses = [
    jsonResponse(200, []),
    jsonResponse(401, { code: "42501" }),
  ];
  const failures = await auditProtectedSchemasNotExposed({
    supabaseUrl: "https://example.supabase.co",
    supabaseAnonKey: "public-anon-key",
    async fetchImpl() {
      return responses.shift();
    },
  });

  assert.equal(failures.length, 2);
  assert.match(failures[0], /status 200, code unknown/);
  assert.match(failures[1], /status 401, code 42501/);
});

test("protected schema probes report malformed and failed requests", async () => {
  let requestCount = 0;
  const failures = await auditProtectedSchemasNotExposed({
    supabaseUrl: "https://example.supabase.co",
    supabaseAnonKey: "public-anon-key",
    async fetchImpl() {
      requestCount += 1;

      if (requestCount === 1) {
        return new Response("not-json", { status: 406 });
      }

      throw new Error("network unavailable");
    },
  });

  assert.equal(failures.length, 2);
  assert.match(failures[0], /status 406, code unknown/);
  assert.match(failures[1], /network unavailable/);
});

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
