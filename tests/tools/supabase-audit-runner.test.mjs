import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import {
  redactSensitiveText,
  splitSqlStatements,
  validateAuditTransactionContract,
} from "../../scripts/audit-supabase-readonly.mjs";

const projectRoot = process.cwd();
const auditScript = path.join(projectRoot, "scripts", "audit-supabase-readonly.mjs");

test("SQL splitter preserves quoted and dollar-quoted semicolons", () => {
  const statements = splitSqlStatements(`
    -- Audit header.
    begin transaction read only;
    select 'value;still-quoted' as diagnostic;
    do $audit$ begin perform 'inside;block'; end $audit$;
    /* Final boundary. */ rollback;
  `);

  assert.equal(statements.length, 4);
  assert.match(statements[1], /value;still-quoted/);
  assert.match(statements[2], /inside;block/);
  assert.doesNotThrow(() => validateAuditTransactionContract(statements));
});

test("transaction contract requires read-only begin and rollback", () => {
  assert.throws(
    () => validateAuditTransactionContract(splitSqlStatements("begin; select 1; rollback;")),
    /BEGIN TRANSACTION READ ONLY/,
  );
  assert.throws(
    () => validateAuditTransactionContract(splitSqlStatements("begin read only; select 1; commit;")),
    /end with ROLLBACK/,
  );
});

test("redaction removes database URLs and API keys", () => {
  const databaseUrl = "postgresql://audit-user:secret@example.test/postgres";
  const anonKey = "public-anon-key";
  const redacted = redactSensitiveText(
    `Failed for ${databaseUrl} with ${anonKey}`,
    [databaseUrl, anonKey],
  );

  assert.equal(redacted, "Failed for [redacted] with [redacted]");
});

test("audit command lists every missing environment variable", () => {
  const environment = { ...process.env, SKIP_LOCAL_ENV: "true" };
  delete environment.SUPABASE_AUDIT_DB_URL;
  delete environment.PUBLIC_SUPABASE_URL;
  delete environment.PUBLIC_SUPABASE_ANON_KEY;

  const result = spawnSync(process.execPath, [auditScript], {
    cwd: projectRoot,
    encoding: "utf8",
    env: environment,
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /SUPABASE_AUDIT_DB_URL/);
  assert.match(result.stderr, /PUBLIC_SUPABASE_URL/);
  assert.match(result.stderr, /PUBLIC_SUPABASE_ANON_KEY/);
});
