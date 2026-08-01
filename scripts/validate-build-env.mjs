import { isTruthy, loadLocalEnv } from "./load-local-env.mjs";

loadLocalEnv();

const dataSource = process.env.MENU_DATA_SOURCE?.trim().toLowerCase();
const productionSignals = [
  ["VERCEL_ENV", process.env.VERCEL_ENV],
  ["DEPLOY_ENV", process.env.DEPLOY_ENV],
  ["APP_ENV", process.env.APP_ENV],
  ["NODE_ENV", process.env.NODE_ENV],
].filter(([, value]) => value?.trim().toLowerCase() === "production");
const isProduction = productionSignals.length > 0;

if (!dataSource) {
  fail(
    "MENU_DATA_SOURCE is required. Use fixture explicitly for local/CI builds or supabase for real data.",
  );
}

if (!new Set(["fixture", "supabase"]).has(dataSource)) {
  fail('MENU_DATA_SOURCE must be either "fixture" or "supabase".');
}

if (dataSource === "fixture") {
  if (isProduction) {
    const signals = productionSignals.map(([name]) => name).join(", ");
    fail(`Fixture data is forbidden in production builds (${signals}).`);
  }

  if (!isTruthy(process.env.ALLOW_FIXTURE_BUILD)) {
    fail(
      "Fixture builds require ALLOW_FIXTURE_BUILD=true. This prevents accidental placeholder deployments.",
    );
  }

  console.log("Build environment valid: explicit non-production fixture build.");
  process.exit(0);
}

const requiredSupabaseEnvNames = [
  "PUBLIC_SUPABASE_URL",
  "PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_DB_URL",
];
const missingEnvNames = requiredSupabaseEnvNames.filter(
  (name) => !process.env[name]?.trim(),
);

if (missingEnvNames.length > 0) {
  fail(`Supabase build credentials are missing: ${missingEnvNames.join(", ")}.`);
}

validateUrl("PUBLIC_SUPABASE_URL", process.env.PUBLIC_SUPABASE_URL, {
  protocols: isProduction ? ["https:"] : ["http:", "https:"],
});
validateUrl("SUPABASE_DB_URL", process.env.SUPABASE_DB_URL, {
  protocols: ["postgres:", "postgresql:"],
});

if (isProduction) {
  if (!process.env.PUBLIC_SITE_URL?.trim()) {
    fail("PUBLIC_SITE_URL is required in production builds.");
  }

  validateUrl("PUBLIC_SITE_URL", process.env.PUBLIC_SITE_URL, {
    protocols: ["https:"],
  });
}

console.log(
  `Build environment valid: Supabase source${isProduction ? " for production" : ""}.`,
);

function validateUrl(name, rawValue, { protocols }) {
  let url;

  try {
    url = new URL(rawValue);
  } catch {
    fail(`${name} must be a valid URL.`);
  }

  if (!protocols.includes(url.protocol)) {
    fail(`${name} must use one of these protocols: ${protocols.join(", ")}.`);
  }
}

function fail(message) {
  console.error(`Build environment error: ${message}`);
  process.exit(1);
}
