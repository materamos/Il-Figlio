import { execFileSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";

const rootDir = process.cwd();
const supportedExtensions = new Set([".cjs", ".js", ".mjs"]);
const ignoredDirectories = new Set([
  ".astro",
  ".branches",
  ".git",
  ".temp",
  ".vercel",
  "coverage",
  "dist",
  "node_modules",
]);
const files = await listFiles(rootDir);

for (const file of files) {
  execFileSync(process.execPath, ["--check", file], {
    cwd: rootDir,
    stdio: "inherit",
  });
}

console.log(`JS syntax check passed for ${files.length} files.`);

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) {
      continue;
    }

    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await listFiles(entryPath)));
      continue;
    }

    if (entry.isFile() && supportedExtensions.has(path.extname(entry.name))) {
      files.push(entryPath);
    }
  }

  return files.sort();
}
