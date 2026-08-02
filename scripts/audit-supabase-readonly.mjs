import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import postgres from "postgres";
import { loadLocalEnv } from "./load-local-env.mjs";
import { auditSupabasePlatformSurface } from "./supabase-platform-audit.mjs";

const auditDatabaseUrlEnvName = "SUPABASE_AUDIT_DB_URL";
const publicSupabaseUrlEnvName = "PUBLIC_SUPABASE_URL";
const publicSupabaseAnonKeyEnvName = "PUBLIC_SUPABASE_ANON_KEY";
const auditFile = "docs/supabase/audits/database-audit.sql";

export async function runSupabaseReadonlyAudit() {
  loadLocalEnv();

  const databaseUrl = process.env[auditDatabaseUrlEnvName]?.trim();
  const publicSupabaseUrl = process.env[publicSupabaseUrlEnvName]?.trim();
  const publicSupabaseAnonKey = process.env[publicSupabaseAnonKeyEnvName]?.trim();
  const missingVariables = [
    [auditDatabaseUrlEnvName, databaseUrl],
    [publicSupabaseUrlEnvName, publicSupabaseUrl],
    [publicSupabaseAnonKeyEnvName, publicSupabaseAnonKey],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missingVariables.length > 0) {
    throw new Error(
      `Supabase read-only audit requires: ${missingVariables.join(", ")}.`,
    );
  }

  const auditPath = path.resolve(auditFile);
  const statements = splitSqlStatements(readFileSync(auditPath, "utf8"));
  validateAuditTransactionContract(statements);

  const sql = postgres(databaseUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
  });
  const failures = [];
  let transactionOpen = false;

  try {
    console.log(`Running ${auditFile} (${statements.length - 2} audit statements)...`);

    for (const [index, statement] of statements.entries()) {
      const command = normalizedSqlCommand(statement);
      const label = getStatementLabel(statement, index);
      let rows;

      try {
        rows = await sql.unsafe(statement);
      } catch (error) {
        failures.push(`${auditFile} ${label}: query failed: ${errorMessage(error)}`);
        break;
      }

      if (isBeginReadOnly(command)) {
        transactionOpen = true;
      } else if (command === "rollback") {
        transactionOpen = false;
      }

      collectDiagnosticRows(auditFile, label, rows, failures);
    }

    failures.push(...(await auditSupabasePlatformSurface({
      supabaseUrl: publicSupabaseUrl,
      supabaseAnonKey: publicSupabaseAnonKey,
    })));
  } finally {
    if (transactionOpen) {
      try {
        await sql.unsafe("rollback");
      } catch (error) {
        failures.push(`Rollback failed: ${errorMessage(error)}`);
      }
    }

    await sql.end();
  }

  const redactedFailures = failures.map((failure) =>
    redactSensitiveText(failure, [databaseUrl, publicSupabaseAnonKey]),
  );

  if (redactedFailures.length > 0) {
    throw new Error(
      `Supabase read-only audit failed:\n${redactedFailures.map((failure) => `- ${failure}`).join("\n")}`,
    );
  }

  console.log(
    `Supabase read-only audit passed for ${auditFile} and the Data API surface.`,
  );
}

export function splitSqlStatements(sqlText) {
  const statements = [];
  let statementStart = 0;
  let quote = null;
  let dollarQuoteTag = null;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < sqlText.length; index += 1) {
    const char = sqlText[index];
    const nextChar = sqlText[index + 1];

    if (inLineComment) {
      if (char === "\n") {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      if (char === "*" && nextChar === "/") {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }

    if (dollarQuoteTag) {
      if (sqlText.startsWith(dollarQuoteTag, index)) {
        index += dollarQuoteTag.length - 1;
        dollarQuoteTag = null;
      }
      continue;
    }

    if (quote) {
      if (char === quote) {
        if (sqlText[index + 1] === quote) {
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }

    if (char === "-" && nextChar === "-") {
      inLineComment = true;
      index += 1;
      continue;
    }

    if (char === "/" && nextChar === "*") {
      inBlockComment = true;
      index += 1;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (char === "$") {
      const match = sqlText.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);

      if (match) {
        dollarQuoteTag = match[0];
        index += dollarQuoteTag.length - 1;
      }
      continue;
    }

    if (char === ";") {
      addStatement(statements, sqlText.slice(statementStart, index));
      statementStart = index + 1;
    }
  }

  addStatement(statements, sqlText.slice(statementStart));
  return statements;
}

export function validateAuditTransactionContract(statements) {
  if (statements.length < 2 || !isBeginReadOnly(normalizedSqlCommand(statements[0]))) {
    throw new Error("Supabase audit SQL must begin with BEGIN TRANSACTION READ ONLY.");
  }

  if (normalizedSqlCommand(statements.at(-1)) !== "rollback") {
    throw new Error("Supabase audit SQL must end with ROLLBACK.");
  }
}

export function redactSensitiveText(text, sensitiveValues) {
  return sensitiveValues.reduce(
    (redacted, value) => value ? redacted.replaceAll(value, "[redacted]") : redacted,
    String(text),
  );
}

function addStatement(statements, rawStatement) {
  const statement = rawStatement.trim();

  if (statement.length > 0) {
    statements.push(statement);
  }
}

function normalizedSqlCommand(statement) {
  return stripLeadingComments(statement).trim().replace(/\s+/g, " ").toLowerCase();
}

function stripLeadingComments(statement) {
  let remaining = statement.trimStart();

  while (remaining.startsWith("--") || remaining.startsWith("/*")) {
    if (remaining.startsWith("--")) {
      const lineEnd = remaining.indexOf("\n");
      remaining = lineEnd === -1 ? "" : remaining.slice(lineEnd + 1).trimStart();
      continue;
    }

    const blockEnd = remaining.indexOf("*/", 2);
    if (blockEnd === -1) {
      return remaining;
    }
    remaining = remaining.slice(blockEnd + 2).trimStart();
  }

  return remaining;
}

function isBeginReadOnly(command) {
  return command === "begin read only" || command === "begin transaction read only";
}

function getStatementLabel(statement, index) {
  const commentMatch = statement.match(/^\s*--\s*(.+)$/m);
  return commentMatch ? commentMatch[1].trim() : `statement ${index + 1}`;
}

function collectDiagnosticRows(auditPath, label, rows, failures) {
  for (const row of rows) {
    if (typeof row?.diagnostic !== "string" || row.diagnostic.length === 0) {
      continue;
    }

    failures.push(`${auditPath} ${label}: ${formatRow(row)}`);
  }
}

function formatRow(row) {
  return JSON.stringify(row, (_key, value) =>
    typeof value === "bigint" ? value.toString() : value,
  );
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

const isDirectExecution =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  runSupabaseReadonlyAudit().catch((error) => {
    const databaseUrl = process.env[auditDatabaseUrlEnvName]?.trim();
    const publicSupabaseAnonKey = process.env[publicSupabaseAnonKeyEnvName]?.trim();
    console.error(
      redactSensitiveText(errorMessage(error), [databaseUrl, publicSupabaseAnonKey]),
    );
    process.exitCode = 1;
  });
}
