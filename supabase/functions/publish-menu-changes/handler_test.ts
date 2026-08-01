import {
  deferredPublishMessage,
  extractHookJobId,
  getBearerToken,
  parseIntegerEnv,
  validateDeployHookUrl,
} from "./handler.ts";

const assertEquals = (actual: unknown, expected: unknown, message: string): void => {
  if (!Object.is(actual, expected)) {
    throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
  }
};

Deno.test("validates production and test deploy-hook boundaries", () => {
  assertEquals(
    validateDeployHookUrl(
      "https://api.vercel.com/v1/integrations/deploy/prj_example/hook_example",
      "vercel",
    ),
    "https://api.vercel.com/v1/integrations/deploy/prj_example/hook_example",
    "valid Vercel hook",
  );
  assertEquals(
    validateDeployHookUrl("https://example.com/v1/integrations/deploy/hook", "vercel"),
    null,
    "foreign host must be rejected",
  );
  assertEquals(
    validateDeployHookUrl("http://127.0.0.1:8787/deploy", "test"),
    "http://127.0.0.1:8787/deploy",
    "loopback test hook",
  );
  assertEquals(
    validateDeployHookUrl("http://host.docker.internal:8787/deploy", "test"),
    "http://host.docker.internal:8787/deploy",
    "Docker host test hook",
  );
  assertEquals(
    validateDeployHookUrl("http://example.test:8787/deploy", "test"),
    null,
    "foreign test hook must be rejected",
  );
});

Deno.test("parses bounded integer environment values", () => {
  assertEquals(parseIntegerEnv(undefined, 60, 0, 3600), 60, "default");
  assertEquals(parseIntegerEnv("0", 60, 0, 3600), 0, "lower bound");
  assertEquals(parseIntegerEnv("3600", 60, 0, 3600), 3600, "upper bound");
  assertEquals(parseIntegerEnv("-1", 60, 0, 3600), null, "negative");
  assertEquals(parseIntegerEnv("3601", 60, 0, 3600), null, "out of range");
  assertEquals(parseIntegerEnv("1.5", 60, 0, 3600), null, "not integer");
});

Deno.test("requires a bearer token", () => {
  assertEquals(
    getBearerToken(new Request("https://example.test", {
      headers: { Authorization: "Bearer token-value" },
    })),
    "token-value",
    "valid bearer",
  );
  assertEquals(
    getBearerToken(new Request("https://example.test", {
      headers: { Authorization: "Basic token-value" },
    })),
    null,
    "invalid scheme",
  );
});

Deno.test("extracts and bounds a deploy-hook job id", async () => {
  const response = new Response(JSON.stringify({ job: { id: "job_123" } }), {
    headers: { "Content-Type": "application/json" },
  });

  assertEquals(await extractHookJobId(response), "job_123", "nested job id");
});

Deno.test("preserves publication deferral messages for the admin", () => {
  assertEquals(
    deferredPublishMessage("publish_cooldown"),
    "publish_cooldown",
    "cooldown remains distinguishable",
  );
  assertEquals(
    deferredPublishMessage("publish_already_queued"),
    "publish_already_queued",
    "active queue remains distinguishable",
  );
  assertEquals(
    deferredPublishMessage("permission_denied"),
    null,
    "unexpected reserve result is not rewritten",
  );
});
