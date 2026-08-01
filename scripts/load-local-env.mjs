import { loadEnvFile } from "node:process";
import path from "node:path";

/**
 * Load local environment files without overriding values supplied by the shell.
 * `.env.local` is loaded first so it keeps precedence over `.env`.
 */
export function loadLocalEnv(rootDir = process.cwd()) {
  if (isTruthy(process.env.SKIP_LOCAL_ENV)) {
    return;
  }

  for (const fileName of [".env.local", ".env"]) {
    try {
      loadEnvFile(path.join(rootDir, fileName));
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }
  }
}

export function isTruthy(value) {
  return ["1", "true", "yes", "on"].includes(value?.trim().toLowerCase());
}
