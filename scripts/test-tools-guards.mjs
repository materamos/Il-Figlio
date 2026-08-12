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
        "MENU_SNAPSHOT_URL",
        "NODE_ENV",
        "PUBLIC_SITE_URL",
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

test("Google snapshot builds require the snapshot URL", async () => {
  await withTemporaryDirectory((directory) => {
    const result = run(validateScript, directory, {
      MENU_DATA_SOURCE: "google_snapshot",
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /MENU_SNAPSHOT_URL/);
  });
});

test("a complete local Google snapshot build environment passes", async () => {
  await withTemporaryDirectory((directory) => {
    const result = run(validateScript, directory, {
      MENU_DATA_SOURCE: "google_snapshot",
      MENU_SNAPSHOT_URL: "http://127.0.0.1:8787/menu.json",
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Google snapshot source/);
  });
});

test("production Google snapshot builds require HTTPS URLs", async () => {
  await withTemporaryDirectory((directory) => {
    const result = run(validateScript, directory, {
      MENU_DATA_SOURCE: "google_snapshot",
      MENU_SNAPSHOT_URL: "http://example.test/menu.json",
      VERCEL_ENV: "production",
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /MENU_SNAPSHOT_URL must use.*https:/);
  });

  await withTemporaryDirectory((directory) => {
    const result = run(validateScript, directory, {
      MENU_DATA_SOURCE: "google_snapshot",
      MENU_SNAPSHOT_URL: "https://script.google.com/macros/s/example/exec",
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
      MENU_SNAPSHOT_URL: "https://script.google.com/macros/s/public-source/exec",
    });

    assert.equal(result.status, 0, result.stderr);
  });
});

test("dist verification rejects private values and deploy hook markers", async () => {
  await withTemporaryDirectory(async (directory) => {
    const snapshotUrl = "https://script.google.com/macros/s/public-source/exec";
    await mkdir(path.join(directory, "dist"));
    await writeFile(
      path.join(directory, "dist", "leak.js"),
      `${snapshotUrl}\nhttps://api.vercel.com/v1/integrations/deploy/example`,
    );

    const result = run(verifyScript, directory, {
      MENU_SNAPSHOT_URL: snapshotUrl,
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Sensitive content was found/);
    assert.match(result.stderr, /MENU_SNAPSHOT_URL raw value/);
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
