import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { loadLocalEnv } from "./load-local-env.mjs";

const rootDir = process.cwd();
const distDir = path.resolve(rootDir, process.env.DIST_DIR?.trim() || "dist");
const privateEnvNames = [
  "DATABASE_URL",
  "PUBLISH_WEBHOOK_SECRET",
  "SUPABASE_ACCESS_TOKEN",
  "SUPABASE_AUDIT_DB_URL",
  "SUPABASE_DB_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "VERCEL_DEPLOY_HOOK_URL",
];
const forbiddenStaticMarkers = [
  ...privateEnvNames,
  "api.vercel.com/v1/integrations/deploy/",
  "sb_secret_",
  "-----BEGIN PRIVATE KEY-----",
  "-----BEGIN RSA PRIVATE KEY-----",
];

loadLocalEnv(rootDir);

const secretValueMarkers = privateEnvNames.flatMap((name) => {
  const value = process.env[name]?.trim();

  if (!value || value.length < 8) {
    return [];
  }

  return [
    { label: `${name} raw value`, value },
    { label: `${name} URL-encoded value`, value: encodeURIComponent(value) },
    { label: `${name} base64 value`, value: Buffer.from(value).toString("base64") },
  ];
});

try {
  const directoryStat = await stat(distDir);
  if (!directoryStat.isDirectory()) {
    throw new Error("not a directory");
  }
} catch {
  console.error(`${path.relative(rootDir, distDir) || distDir} does not exist. Run npm run build first.`);
  process.exit(1);
}

const files = await listFiles(distDir);
const findings = [];

for (const filePath of files) {
  const content = await readFile(filePath);

  for (const marker of forbiddenStaticMarkers) {
    if (content.includes(Buffer.from(marker))) {
      findings.push({ filePath, label: `forbidden marker: ${marker}` });
    }
  }

  for (const marker of secretValueMarkers) {
    if (content.includes(Buffer.from(marker.value))) {
      findings.push({ filePath, label: marker.label });
    }
  }
}

if (findings.length > 0) {
  console.error("Secret verification failed. Sensitive content was found in dist/:");
  for (const finding of findings) {
    console.error(`- ${path.relative(rootDir, finding.filePath)}: ${finding.label}`);
  }
  process.exit(1);
}

console.log(`Secret verification passed across ${files.length} dist files.`);

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await listFiles(entryPath)));
      continue;
    }

    if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}
