import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";

const rootDir = process.cwd();
const supportedSuites = new Set(["admin", "menu", "tools"]);
const suite = process.argv[2];

if (!supportedSuites.has(suite)) {
  console.error(
    `Unknown test suite "${suite ?? ""}". Expected one of: ${[...supportedSuites].join(", ")}.`,
  );
  process.exit(1);
}

const conventionDirectory = path.join(rootDir, "tests", suite);
const scriptsDirectory = path.join(rootDir, "scripts");
const conventionFiles = await listMatchingFiles(
  conventionDirectory,
  (fileName) => fileName.endsWith(".test.mjs"),
);
const legacyFiles = await listMatchingFiles(
  scriptsDirectory,
  (fileName) =>
    (fileName === `test-${suite}.mjs` || fileName.startsWith(`test-${suite}-`)) &&
    fileName.endsWith(".mjs"),
  false,
);
const files = [...new Set([...conventionFiles, ...legacyFiles])].sort();

if (files.length === 0) {
  console.error(
    `Test suite "${suite}" is empty. Add tests/${suite}/**/*.test.mjs or scripts/test-${suite}-*.mjs.`,
  );
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--test", ...files], {
  cwd: rootDir,
  stdio: "inherit",
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);

async function listMatchingFiles(directory, predicate, recursive = true) {
  let entries;

  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);

    if (recursive && entry.isDirectory()) {
      files.push(...(await listMatchingFiles(entryPath, predicate, true)));
      continue;
    }

    if (entry.isFile() && predicate(entry.name)) {
      files.push(entryPath);
    }
  }

  return files;
}
