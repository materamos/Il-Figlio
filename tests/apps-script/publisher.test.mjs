import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import path from "node:path";
import vm from "node:vm";

import { parsePublishedMenuSnapshot } from "../../src/utils/menuContent.ts";

const rootDir = process.cwd();
const scriptDir = path.join(rootDir, "apps-script", "src");
const context = vm.createContext({
  console,
  Utilities: {
    Charset: { UTF_8: "UTF_8" },
    DigestAlgorithm: { SHA_256: "SHA_256" },
    computeDigest(_algorithm, value) {
      return [...createHash("sha256").update(value, "utf8").digest()]
        .map((byte) => (byte > 127 ? byte - 256 : byte));
    },
  },
});

for (const fileName of [
  "Config.js",
  "Seed.js",
  "Validation.js",
  "Snapshot.js",
  "SheetReader.js",
  "Publishing.js",
]) {
  const source = await readFile(path.join(scriptDir, fileName), "utf8");
  vm.runInContext(source, context, { filename: fileName });
}

const plain = (value) => JSON.parse(JSON.stringify(value));
const validState = () => [
  ["campo", "valor"],
  ["estado", "Abierto"],
  ["mensaje", "Tomamos pedidos."],
];
const seededMenu = () => [
  plain(context.MENU_HEADERS),
  ...plain(context.INITIAL_MENU_ROWS),
];

test("the canonical seed maps all 24 products into the versioned wire shape", () => {
  const result = context.validateAndBuildDraft_(seededMenu(), validState());

  assert.equal(result.ok, true, plain(result.issues));
  assert.equal(result.draft.currency, "ARS");
  assert.deepEqual(plain(result.draft.business), {
    status: "open",
    message: "Tomamos pedidos.",
  });
  assert.deepEqual(
    plain(result.draft.categories.map((category) => [category.code, category.items.length])),
    [
      ["classic", 12],
      ["filled", 4],
      ["gourmet", 4],
      ["empanadas", 2],
      ["extras", 2],
    ],
  );

  const mozzarella = result.draft.categories[0].items[0];
  assert.deepEqual(plain(mozzarella.prices), { whole: 14000, slice: 2500 });
  assert.equal(mozzarella.description.includes("albahaca"), true);
});

test("hidden products stay in the Sheet draft but are excluded from publication", () => {
  const menu = seededMenu();
  menu[1][9] = "No";
  const result = context.validateAndBuildDraft_(menu, validState());

  assert.equal(result.ok, true);
  assert.equal(result.draft.categories[0].items.length, 11);
  assert.equal(
    result.draft.categories.some((category) =>
      category.items.some((item) => item.id === "clasica-mozzarella")),
    false,
  );
});

test("validation rejects duplicated ordering, malformed IDs and incompatible prices", () => {
  const menu = seededMenu();
  menu[1][0] = "Not stable";
  menu[2][2] = 1;
  menu[13][7] = 1000;
  const result = context.validateAndBuildDraft_(menu, validState());
  const issues = plain(result.issues);

  assert.equal(result.ok, false);
  assert.ok(issues.some((issue) => issue.path === "Carta!A2"));
  assert.ok(issues.some((issue) => issue.path === "Carta!C3" && issue.message.includes("duplicado")));
  assert.ok(issues.some((issue) => issue.path === "Carta!H14" && issue.message.includes("no corresponde")));
});

test("validation enforces exact headers, supported status and message length", () => {
  const menu = seededMenu();
  menu[0][5] = "precio";
  const state = validState();
  state[1][1] = "Pausado";
  state[2][1] = "x".repeat(161);
  const result = context.validateAndBuildDraft_(menu, state);
  const paths = plain(result.issues.map((issue) => issue.path));

  assert.equal(result.ok, false);
  assert.ok(paths.includes("Carta!F1"));
  assert.ok(paths.includes("Estado!B2"));
  assert.ok(paths.includes("Estado!B3"));
});

test("canonical SHA-256 is deterministic and excludes published_at", () => {
  const draft = context.validateAndBuildDraft_(seededMenu(), validState()).draft;
  const first = context.buildPublishedSnapshot_(draft, 7, "2026-08-11T12:00:00.000Z");
  const second = context.buildPublishedSnapshot_(draft, 7, "2026-08-11T13:00:00.000Z");
  const nextRevision = context.buildPublishedSnapshot_(draft, 8, "2026-08-11T12:00:00.000Z");

  assert.deepEqual(Object.keys(plain(first)), [
    "schema_version",
    "revision",
    "published_at",
    "source_hash",
    "currency",
    "business",
    "categories",
  ]);
  assert.match(first.source_hash, /^[0-9a-f]{64}$/);
  assert.equal(first.source_hash, second.source_hash);
  assert.notEqual(first.source_hash, nextRevision.source_hash);

  const canonicalJson = JSON.stringify(plain(context.buildCanonicalPayload_(draft, 7)));
  assert.equal(first.source_hash, createHash("sha256").update(canonicalJson).digest("hex"));
});

test("Astro accepts the exact snapshot emitted by Apps Script", () => {
  const draft = context.validateAndBuildDraft_(seededMenu(), validState()).draft;
  const wireSnapshot = plain(context.buildPublishedSnapshot_(
    draft,
    1,
    "2026-08-11T12:00:00.000Z",
  ));
  const parsed = parsePublishedMenuSnapshot(wireSnapshot);

  assert.equal(parsed.schemaVersion, 1);
  assert.equal(parsed.content.revision, 1);
  assert.equal(parsed.content.items.length, 24);
  assert.equal(parsed.businessStatus.status, "open");
  assert.equal(parsed.sourceHash, wireSnapshot.source_hash);
});

test("publication confirmation requires the exact revision, hash and valid build time", () => {
  const expectedHash = "a".repeat(64);
  const valid = {
    schemaVersion: 1,
    revision: 4,
    sourceHash: expectedHash,
    builtAt: "2026-08-11T12:00:00.000Z",
  };

  assert.equal(context.matchesPublishedReceipt_(valid, 4, expectedHash), true);
  assert.equal(context.matchesPublishedReceipt_({ ...valid, revision: 3 }, 4, expectedHash), false);
  assert.equal(context.matchesPublishedReceipt_({ ...valid, sourceHash: "b".repeat(64) }, 4, expectedHash), false);
  assert.equal(context.matchesPublishedReceipt_({ ...valid, builtAt: "invalid" }, 4, expectedHash), false);
});

test("a confirmed revision keeps later Sheet edits visibly unpublished", () => {
  assert.deepEqual(plain(context.buildPublishedDashboardState_(4, false)), {
    status: "Publicado — revisión 4",
    detail: "La revisión y el hash coinciden con el sitio público.",
  });
  assert.deepEqual(plain(context.buildPublishedDashboardState_(4, true)), {
    status: "Cambios sin publicar",
    detail: "La revisión 4 está publicada, pero hay cambios posteriores que siguen en borrador.",
  });
});

test("only a checked Publicacion B2 edit is treated as a publish request", () => {
  const makeEvent = ({ sheetName = "Publicacion", value = true, row = 2, column = 2 } = {}) => {
    const sheet = {
      getName: () => sheetName,
      getRange: () => ({ getValue: () => value }),
    };
    return {
      range: {
        getSheet: () => sheet,
        getRow: () => row,
        getLastRow: () => row,
        getColumn: () => column,
        getLastColumn: () => column,
      },
    };
  };

  assert.equal(context.isPublishEdit_(makeEvent()), true);
  assert.equal(context.isPublishEdit_(makeEvent({ value: false })), false);
  assert.equal(context.isPublishEdit_(makeEvent({ sheetName: "Carta" })), false);
  assert.equal(context.isPublishEdit_(makeEvent({ row: 3 })), false);
});

test("configuration validators accept only the intended HTTPS endpoints", () => {
  assert.doesNotThrow(() => context.validateDeployHookUrl_(
    "https://api.vercel.com/v1/integrations/deploy/prj_example/hook_secret",
  ));
  assert.doesNotThrow(() => context.validatePublicSiteUrl_("https://ilfiglio.example"));
  assert.doesNotThrow(() => context.validatePublicSiteUrl_("https://ilfiglio.example/"));
  assert.throws(() => context.validateDeployHookUrl_("https://example.com/hook"));
  assert.throws(() => context.validatePublicSiteUrl_("http://ilfiglio.example"));
  assert.throws(() => context.validatePublicSiteUrl_("https://ilfiglio.example/carta"));
  assert.throws(() => context.validatePublicSiteUrl_("https://ilfiglio.example?preview=1"));
});
