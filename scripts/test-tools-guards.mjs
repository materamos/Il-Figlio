import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const projectRoot = process.cwd();
const validateScript = path.join(projectRoot, "scripts", "validate-build-env.mjs");
const verifyScript = path.join(projectRoot, "scripts", "verify-dist-secrets.mjs");
const cleanEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(
    ([name]) =>
      ![
        "ALLOW_FIXTURE_BUILD",
        "APP_ENV",
        "DEPLOY_ENV",
        "MENU_DATA_SOURCE",
        "NODE_ENV",
        "PUBLIC_SITE_URL",
        "PUBLIC_SUPABASE_ANON_KEY",
        "PUBLIC_SUPABASE_URL",
        "SUPABASE_AUDIT_DB_URL",
        "SUPABASE_DB_URL",
        "VERCEL_ENV",
      ].includes(name),
  ),
);

test("fixture builds require an explicit opt-in", async () => {
  await withTemporaryDirectory((directory) => {
    const result = run(validateScript, directory, {
      MENU_DATA_SOURCE: "fixture",
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /ALLOW_FIXTURE_BUILD=true/);
  });
});

test("explicit local fixture builds pass", async () => {
  await withTemporaryDirectory((directory) => {
    const result = run(validateScript, directory, {
      ALLOW_FIXTURE_BUILD: "true",
      MENU_DATA_SOURCE: "fixture",
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /explicit non-production fixture build/);
  });
});

test("production can never use the fixture", async () => {
  await withTemporaryDirectory((directory) => {
    const result = run(validateScript, directory, {
      ALLOW_FIXTURE_BUILD: "true",
      MENU_DATA_SOURCE: "fixture",
      VERCEL_ENV: "production",
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /forbidden in production/);
  });
});

test("Supabase builds list missing credentials", async () => {
  await withTemporaryDirectory((directory) => {
    const result = run(validateScript, directory, {
      MENU_DATA_SOURCE: "supabase",
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /PUBLIC_SUPABASE_URL/);
    assert.match(result.stderr, /PUBLIC_SUPABASE_ANON_KEY/);
    assert.match(result.stderr, /SUPABASE_DB_URL/);
  });
});

test("a complete local Supabase build environment passes", async () => {
  await withTemporaryDirectory((directory) => {
    const result = run(validateScript, directory, {
      MENU_DATA_SOURCE: "supabase",
      PUBLIC_SUPABASE_ANON_KEY: "local-anon-key",
      PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      SUPABASE_DB_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Supabase source/);
  });
});

test("production Supabase builds require the canonical HTTPS site URL", async () => {
  await withTemporaryDirectory((directory) => {
    const result = run(validateScript, directory, {
      MENU_DATA_SOURCE: "supabase",
      PUBLIC_SUPABASE_ANON_KEY: "production-anon-key",
      PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_DB_URL: "postgresql://postgres:secret@db.example.supabase.co:5432/postgres",
      VERCEL_ENV: "production",
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /PUBLIC_SITE_URL/);
  });
});

test("dist verification accepts a clean artifact", async () => {
  await withTemporaryDirectory(async (directory) => {
    await mkdir(path.join(directory, "dist"));
    await writeFile(path.join(directory, "dist", "index.html"), "<h1>Il Figlio</h1>");

    const result = run(verifyScript, directory, {
      SUPABASE_DB_URL: "postgresql://private-build-connection",
    });

    assert.equal(result.status, 0, result.stderr);
  });
});

test("dist verification rejects private values and deploy hook markers", async () => {
  await withTemporaryDirectory(async (directory) => {
    const buildSecret = "postgresql://private-build-connection";
    const auditSecret = "postgresql://private-audit-connection";
    await mkdir(path.join(directory, "dist"));
    await writeFile(
      path.join(directory, "dist", "leak.js"),
      `${buildSecret}\n${auditSecret}\nhttps://api.vercel.com/v1/integrations/deploy/example`,
    );

    const result = run(verifyScript, directory, {
      SUPABASE_AUDIT_DB_URL: auditSecret,
      SUPABASE_DB_URL: buildSecret,
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Sensitive content was found/);
    assert.match(result.stderr, /SUPABASE_AUDIT_DB_URL raw value/);
    assert.match(result.stderr, /SUPABASE_DB_URL raw value/);
    assert.match(result.stderr, /api\.vercel\.com/);
  });
});

function run(script, cwd, environment) {
  return spawnSync(process.execPath, [script], {
    cwd,
    encoding: "utf8",
    env: {
      ...cleanEnvironment,
      SKIP_LOCAL_ENV: "true",
      ...environment,
    },
  });
}

async function withTemporaryDirectory(callback) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "il-figlio-tools-"));

  try {
    return await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
