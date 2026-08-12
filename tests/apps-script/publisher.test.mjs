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
    base64Encode(value) {
      return Buffer.from(value, "utf8").toString("base64");
    },
    base64Decode(value) {
      return Buffer.from(value, "base64");
    },
    newBlob(value) {
      return {
        getDataAsString: () => Buffer.from(value).toString("utf8"),
      };
    },
    getUuid() {
      return "00000000-0000-4000-8000-000000000001";
    },
  },
});

for (const fileName of [
  "Config.js",
  "Seed.js",
  "Validation.js",
  "Snapshot.js",
  "EditorV2.js",
  "SheetReader.js",
  "Publishing.js",
  "Code.js",
]) {
  const source = await readFile(path.join(scriptDir, fileName), "utf8");
  vm.runInContext(source, context, { filename: fileName });
}

const plain = (value) => JSON.parse(JSON.stringify(value));
const createProperties = (initial = {}) => {
  const state = { ...initial };
  return {
    state,
    getProperty: (key) => state[key] ?? null,
    getProperties: () => ({ ...state }),
    setProperty: (key, value) => { state[key] = String(value); },
    setProperties: (values) => {
      Object.entries(values).forEach(([key, value]) => { state[key] = String(value); });
    },
    deleteProperty: (key) => { delete state[key]; },
  };
};
const validState = () => [
  ["campo", "valor"],
  ["estado", "Abierto"],
  ["mensaje", "Tomamos pedidos."],
];
const seededMenu = () => [
  plain(context.MENU_HEADERS),
  ...plain(context.INITIAL_MENU_ROWS),
];
const migratedEditor = () => plain(context.prepareV2MigrationData_(seededMenu(), validState()));

test("the operator menu exposes only publishing and format recovery", () => {
  const entries = [];
  const menu = {
    addItem(label, handler) {
      entries.push(["item", label, handler]);
      return this;
    },
    addSeparator() {
      entries.push(["separator"]);
      return this;
    },
    addToUi() {
      entries.push(["done"]);
    },
  };
  const previousSpreadsheetApp = context.SpreadsheetApp;
  context.SpreadsheetApp = {
    getUi: () => ({
      createMenu: (label) => {
        entries.push(["menu", label]);
        return menu;
      },
    }),
  };

  try {
    context.onOpen();
  } finally {
    context.SpreadsheetApp = previousSpreadsheetApp;
  }

  assert.deepEqual(plain(entries), [
    ["menu", "Il Figlio"],
    ["item", "Publicar cambios", "publishChanges"],
    ["separator"],
    ["item", "Restaurar formato", "restoreEditorFormatting"],
    ["done"],
  ]);
});

test("publication instructions keep only the two essential steps", () => {
  const source = context.setupV2PublicationSheet_.toString();

  assert.match(source, /\["1", "Editá una categoría\."\]/);
  assert.match(source, /\["2", "Volvé aquí y marcá Publicar cambios\."\]/);
  assert.doesNotMatch(source, /Desmarcá Mostrar/);
  assert.doesNotMatch(source, /Arrastrá la fila/);
  assert.match(source, /getRange\("A13:B15"\)\.setValues/);
  assert.match(
    context.verifyPublishedRevision.toString(),
    /ensureV2PublicationLayoutCurrent_\(\)/,
  );
});

test("product names are normalized in the Sheet before publication", () => {
  assert.equal(
    context.normalizeEditorV2ProductName_("  fugazza   CON   MOZZARELLA "),
    "Fugazza con mozzarella",
  );
  assert.equal(context.normalizeEditorV2ProductName_("c.b.o"), "C.B.O");
  assert.equal(context.normalizeEditorV2ProductName_("AGLIO E OLIO"), "Aglio e olio");
  assert.equal(context.normalizeEditorV2ProductName_("4 quesos"), "4 Quesos");
  assert.equal(context.normalizeEditorV2ProductName_(1200), 1200);

  const writes = [];
  const nameRange = {
    getValues: () => [["  jamón Y MORRONES "], ["c.b.o"]],
    setValues: (values) => writes.push(plain(values)),
  };
  const sheet = {
    getName: () => "Clásicas",
    getRange: (row, column, rows, columns) => {
      assert.deepEqual([row, column, rows, columns], [2, 1, 2, 1]);
      return nameRange;
    },
  };
  const editedRange = {
    getSheet: () => sheet,
    getRow: () => 1,
    getLastRow: () => 3,
    getColumn: () => 1,
    getLastColumn: () => 2,
  };

  assert.equal(context.normalizeEditorV2ProductNamesForRange_(editedRange), true);
  assert.deepEqual(writes, [[
    ["Jamón y morrones"],
    ["C.B.O"],
  ]]);
});

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
    status: "Menú actualizado",
    detail: "Los cambios ya están visibles en el sitio.",
  });
  assert.deepEqual(plain(context.buildPublishedDashboardState_(4, true)), {
    status: "Hay cambios pendientes",
    detail: "El menú está actualizado, pero hiciste cambios nuevos que todavía no publicaste.",
  });
});

test("published JSON survives private property chunking without Unicode loss", () => {
  const draft = context.validateAndBuildDraft_(seededMenu(), validState()).draft;
  const snapshot = context.buildPublishedSnapshot_(draft, 7, "2026-08-11T12:00:00.000Z");
  const contents = JSON.stringify(snapshot);
  const chunks = plain(context.encodeSnapshotChunks_(contents));
  const properties = createProperties();

  assert.ok(chunks.length >= 1);
  assert.ok(chunks.every((chunk) => chunk.length <= context.APP_CONFIG.snapshotChunkSize));
  assert.equal(context.decodeSnapshotChunks_(chunks), contents);
  assert.equal(context.snapshotMatches_(contents, 7, snapshot.source_hash), true);

  context.writeSnapshotChunks_(properties, contents);
  assert.equal(properties.state.SNAPSHOT_ACTIVE_SLOT, "A");
  assert.equal(context.readSnapshotSlot_(properties, "A"), contents);

  const nextSnapshot = context.buildPublishedSnapshot_(draft, 8, "2026-08-11T13:00:00.000Z");
  const nextContents = JSON.stringify(nextSnapshot);
  context.writeSnapshotChunks_(properties, nextContents);
  assert.equal(properties.state.SNAPSHOT_ACTIVE_SLOT, "B");
  assert.equal(context.readSnapshotSlot_(properties, "B"), nextContents);
  assert.equal(context.readSnapshotSlot_(properties, "A"), contents);

  properties.state.SNAPSHOT_B_CHUNK_0 = "corrupt";
  assert.equal(context.readSnapshotSlot_(properties, "B"), null);
  assert.equal(context.readSnapshotSlot_(properties, "A"), contents);
  assert.equal(context.readSnapshotContentsFromProperties_(properties), null);
  assert.equal(context.snapshotMatches_(contents.replace("Mozzarella", "Muzzarella"), 7, snapshot.source_hash), false);
});

test("a partial inactive-slot write never replaces the active snapshot", () => {
  const draft = context.validateAndBuildDraft_(seededMenu(), validState()).draft;
  const first = JSON.stringify(
    context.buildPublishedSnapshot_(draft, 7, "2026-08-11T12:00:00.000Z"),
  );
  const second = JSON.stringify(
    context.buildPublishedSnapshot_(draft, 8, "2026-08-11T13:00:00.000Z"),
  );
  const properties = createProperties();
  context.writeSnapshotChunks_(properties, first);

  const stableSetProperties = properties.setProperties;
  properties.setProperties = (values) => {
    const [firstEntry] = Object.entries(values);
    stableSetProperties(Object.fromEntries([firstEntry]));
    throw new Error("simulated partial property write");
  };

  assert.throws(
    () => context.writeSnapshotChunks_(properties, second),
    /simulated partial property write/,
  );
  assert.equal(properties.state.SNAPSHOT_ACTIVE_SLOT, "A");
  assert.equal(context.readSnapshotSlot_(properties, "A"), first);
  assert.equal(context.readSnapshotSlot_(properties, "B"), null);
});

test("the v4 property layout remains readable during the slot migration", () => {
  const draft = context.validateAndBuildDraft_(seededMenu(), validState()).draft;
  const snapshot = context.buildPublishedSnapshot_(draft, 7, "2026-08-11T12:00:00.000Z");
  const contents = JSON.stringify(snapshot);
  const chunks = plain(context.encodeSnapshotChunks_(contents));
  const properties = createProperties({ SNAPSHOT_CHUNK_COUNT: String(chunks.length) });
  chunks.forEach((chunk, index) => { properties.state[`SNAPSHOT_CHUNK_${index}`] = chunk; });
  const previousPropertiesService = context.PropertiesService;
  context.PropertiesService = { getScriptProperties: () => properties };

  try {
    assert.equal(context.readLegacySnapshotContents_(), contents);
    properties.state.SNAPSHOT_CHUNK_0 = "corrupt";
    assert.equal(context.readLegacySnapshotContents_(), null);
  } finally {
    context.PropertiesService = previousPropertiesService;
  }
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

test("schema v2 is complete only with every operational tab and tolerates unrelated tabs", () => {
  const v2Names = plain(context.editorV2SheetNames_());
  const legacyNames = plain(context.legacySheetNames_());

  assert.equal(context.detectSheetSchemaFromNames_([...v2Names, "Notas"]), "v2");
  assert.equal(context.detectSheetSchemaFromNames_(legacyNames), "legacy");
  assert.equal(context.detectSheetSchemaFromNames_([...v2Names, ...legacyNames]), "dual");
  assert.equal(context.detectSheetSchemaFromNames_([...legacyNames, v2Names[0]]), "partial");
  assert.equal(context.detectSheetSchemaFromNames_(v2Names.slice(0, -1)), "partial");
  assert.equal(context.detectSheetSchemaFromNames_(["Notas"]), "unknown");
});

test("legacy rows migrate to semantic category tabs without changing the canonical menu", () => {
  const migration = migratedEditor();
  const validation = context.validateAndBuildEditorV2Draft_(
    migration.categorySheets,
    migration.localSheet,
  );

  assert.equal(validation.ok, true, plain(validation.issues));
  assert.equal(context.draftsAreCanonicallyEqual_(migration.legacyDraft, validation.draft), true);
  assert.deepEqual(migration.categorySheets["Clásicas"][0], [
    "Producto",
    "Entera",
    "Porción",
    "Mostrar",
    "Descripción",
    "_id",
  ]);
  assert.deepEqual(migration.categorySheets.Rellenas[0], [
    "Producto",
    "Entera",
    "Mostrar",
    "Descripción",
    "_id",
  ]);
  assert.deepEqual(migration.categorySheets.Empanadas[0], [
    "Producto",
    "Unidad",
    "Mostrar",
    "Descripción",
    "_id",
  ]);
  assert.deepEqual(migration.categorySheets.Extras[0], [
    "Producto",
    "Porción",
    "Mostrar",
    "Descripción",
    "_id",
  ]);
  assert.deepEqual(migration.categorySheets["Clásicas"][1], [
    "Mozzarella",
    14000,
    2500,
    true,
    "Salsa de tomate, mozzarella, orégano o albahaca y aceitunas.",
    "clasica-mozzarella",
  ]);
});

test("row position defines product order in each category", () => {
  const migration = migratedEditor();
  const classics = migration.categorySheets["Clásicas"];
  [classics[1], classics[2]] = [classics[2], classics[1]];
  const validation = context.validateAndBuildEditorV2Draft_(
    migration.categorySheets,
    migration.localSheet,
  );

  assert.equal(validation.ok, true, plain(validation.issues));
  assert.deepEqual(
    plain(validation.draft.categories[0].items.slice(0, 2).map((item) => [item.name, item.order_index])),
    [["Fugazza", 1], ["Mozzarella", 2]],
  );
});

test("an incomplete hidden row stays as a draft and becomes required when shown", () => {
  const migration = migratedEditor();
  migration.categorySheets.Rellenas.push([
    "Nueva pizza",
    "",
    false,
    "Descripción todavía en preparación.",
    "rellena-nueva-pizza",
  ]);

  const hidden = context.validateAndBuildEditorV2Draft_(
    migration.categorySheets,
    migration.localSheet,
  );
  assert.equal(hidden.ok, true, plain(hidden.issues));
  assert.equal(hidden.draft.categories[1].items.some((item) => item.id === "rellena-nueva-pizza"), false);

  migration.categorySheets.Rellenas.at(-1)[2] = true;
  const shown = context.validateAndBuildEditorV2Draft_(
    migration.categorySheets,
    migration.localSheet,
  );
  assert.equal(shown.ok, false);
  assert.ok(plain(shown.issues).some((issue) =>
    issue.sheet === "Rellenas" && issue.column === 2 && issue.message.includes("precio")));
});

test("a blank Mostrar checkbox is treated as hidden for a newly typed draft row", () => {
  const migration = migratedEditor();
  migration.categorySheets.Gourmet.push([
    "Borrador nuevo",
    "",
    "",
    "",
    "gourmet-borrador-nuevo",
  ]);
  const validation = context.validateAndBuildEditorV2Draft_(
    migration.categorySheets,
    migration.localSheet,
  );

  assert.equal(validation.ok, true, plain(validation.issues));
  assert.equal(validation.draft.categories[2].items.some((item) =>
    item.id === "gourmet-borrador-nuevo"), false);
});

test("missing and copied internal IDs are regenerated without changing valid IDs", () => {
  const definition = plain(context.EDITOR_V2_CATEGORY_DEFINITIONS[1]);
  let sequence = 0;
  const values = [
    ["Fugazzeta", 24000, true, "", "rellena-fugazzeta"],
    ["Nueva", "", false, "", ""],
    ["Copia", 24000, true, "", "rellena-fugazzeta"],
  ];
  const normalized = context.normalizeEditorV2Ids_(values, definition, {}, () => {
    sequence += 1;
    return `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
  });

  assert.equal(normalized.changed, true);
  assert.equal(normalized.ids[0][0], "rellena-fugazzeta");
  assert.match(normalized.ids[1][0], /^00000000-0000-4000-8000-/);
  assert.match(normalized.ids[2][0], /^00000000-0000-4000-8000-/);
  assert.notEqual(normalized.ids[1][0], normalized.ids[2][0]);
});

test("clearing every editable cell also clears the hidden internal ID", () => {
  const definition = plain(context.EDITOR_V2_CATEGORY_DEFINITIONS[1]);
  const values = [
    ["", "", false, "", "rellena-producto-eliminado"],
  ];
  const normalized = context.normalizeEditorV2Ids_(values, definition, {}, () => {
    throw new Error("an empty row must not receive a new ID");
  });

  assert.equal(context.isEmptyEditorV2Row_(values[0], definition), true);
  assert.equal(normalized.changed, true);
  assert.equal(normalized.ids[0][0], "");
});

test("visible rows reject duplicate names, invalid prices and overlong copy", () => {
  const migration = migratedEditor();
  const classics = migration.categorySheets["Clásicas"];
  classics[2][0] = "  mozzarella  ";
  classics[2][1] = 12.5;
  classics[2][4] = "x".repeat(241);
  const validation = context.validateAndBuildEditorV2Draft_(
    migration.categorySheets,
    migration.localSheet,
  );
  const issues = plain(validation.issues);

  assert.equal(validation.ok, false);
  assert.ok(issues.some((issue) => issue.sheet === "Clásicas" && issue.column === 1
    && issue.message.includes("visible")));
  assert.ok(issues.some((issue) => issue.sheet === "Clásicas" && issue.column === 2
    && issue.message.includes("precio")));
  assert.ok(issues.some((issue) => issue.sheet === "Clásicas" && issue.column === 5
    && issue.message.includes("240")));
});

test("local state keeps a closed dropdown contract and a 160-character message", () => {
  const migration = migratedEditor();
  migration.localSheet[1][1] = "Pausado";
  migration.localSheet[2][1] = "x".repeat(161);
  const validation = context.validateAndBuildEditorV2Draft_(
    migration.categorySheets,
    migration.localSheet,
  );
  const paths = plain(validation.issues.map((issue) => issue.path));

  assert.equal(validation.ok, false);
  assert.ok(paths.includes("Local!B2"));
  assert.ok(paths.includes("Local!B3"));
});

test("editor errors use human sheet and row labels instead of cell notation", () => {
  const text = context.formatIssues_([
    { sheet: "Clásicas", row: 5, column: 2, path: "Clásicas!B5", message: "Falta el precio." },
  ]);
  assert.equal(text, "• Clásicas, fila 5: Falta el precio.");
  assert.equal(text.includes("!B5"), false);
});

test("row, column and tab structure changes dirty the draft while formatting does not", () => {
  for (const type of [
    "INSERT_ROW",
    "REMOVE_ROW",
    "INSERT_COLUMN",
    "REMOVE_COLUMN",
    "INSERT_GRID",
    "REMOVE_GRID",
    "OTHER",
  ]) {
    assert.equal(context.isDraftStructureChange_(type), true, type);
  }
  assert.equal(context.isDraftStructureChange_("FORMAT"), false);
  assert.equal(context.isDraftStructureChange_("EDIT"), false);
});

test("only one completely empty sheet qualifies for a fresh v2 bootstrap", () => {
  const makeSheet = (values) => ({
    getDataRange: () => ({
      getDisplayValues: () => values,
    }),
  });
  assert.equal(context.isBootstrapCandidate_({
    getSheets: () => [makeSheet([[""]])],
  }), true);
  assert.equal(context.isBootstrapCandidate_({
    getSheets: () => [makeSheet([["contenido"]])],
  }), false);
  assert.equal(context.isBootstrapCandidate_({
    getSheets: () => [makeSheet([[""]]), makeSheet([[""]])],
  }), false);
});

test("both legacy and v2 publication checkboxes remain valid during migration", () => {
  const makeEvent = (sheetName) => {
    const sheet = {
      getName: () => sheetName,
      getRange: () => ({ getValue: () => true }),
    };
    return {
      range: {
        getSheet: () => sheet,
        getRow: () => 2,
        getLastRow: () => 2,
        getColumn: () => 2,
        getLastColumn: () => 2,
      },
    };
  };

  assert.equal(context.isPublishEdit_(makeEvent("Publicacion")), true);
  assert.equal(context.isPublishEdit_(makeEvent("Publicar")), true);
});

test("the mobile editor uses locale-neutral numeric validation for prices", () => {
  const source = context.setupV2CategorySheet_.toString();

  assert.match(source, /requireNumberGreaterThan\(0\)/);
  assert.doesNotMatch(source, /requireFormulaSatisfied\([\s\S]*?MOD\(/);
});
