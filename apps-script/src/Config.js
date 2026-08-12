/* eslint-disable no-unused-vars -- Apps Script combines project files in one global scope. */

var APP_CONFIG = Object.freeze({
  spreadsheetLocale: "es_AR",
  timeZone: "America/Argentina/Buenos_Aires",
  snapshotFileName: "published-menu.json",
  snapshotChunkSize: 7000,
  snapshotMaxEncodedChars: 420000,
  publicationTimeoutMs: 15 * 60 * 1000,
  tabs: Object.freeze({
    menu: "Carta",
    state: "Estado",
    publication: "Publicacion",
  }),
});

var MENU_HEADERS = Object.freeze([
  "id",
  "categoria",
  "orden",
  "nombre",
  "descripcion",
  "precio_entera",
  "precio_porcion",
  "precio_unidad",
  "precio_extra",
  "visible",
]);

var STATE_HEADERS = Object.freeze(["campo", "valor"]);

var CATEGORY_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: "classic",
    sheetLabel: "Clásicas",
    name: "Pizzas clásicas",
    orderIndex: 10,
    allowedPriceKinds: Object.freeze(["whole", "slice"]),
  }),
  Object.freeze({
    id: "filled",
    sheetLabel: "Rellenas",
    name: "Pizzas rellenas",
    orderIndex: 20,
    allowedPriceKinds: Object.freeze(["whole"]),
  }),
  Object.freeze({
    id: "gourmet",
    sheetLabel: "Gourmet",
    name: "Pizzas gourmet",
    orderIndex: 30,
    allowedPriceKinds: Object.freeze(["whole"]),
  }),
  Object.freeze({
    id: "empanadas",
    sheetLabel: "Empanadas",
    name: "Empanadas",
    orderIndex: 40,
    allowedPriceKinds: Object.freeze(["unit"]),
  }),
  Object.freeze({
    id: "extras",
    sheetLabel: "Extras",
    name: "Extras",
    orderIndex: 50,
    allowedPriceKinds: Object.freeze(["portion"]),
  }),
]);

var PRICE_COLUMNS = Object.freeze({
  whole: 6,
  slice: 7,
  unit: 8,
  portion: 9,
});

var STATUS_BY_SHEET_LABEL = Object.freeze({
  Abierto: "open",
  Cerrado: "closed",
  Agotado: "sold_out",
});

var SCRIPT_PROPERTY_KEYS = Object.freeze({
  spreadsheetId: "SPREADSHEET_ID",
  snapshotFileId: "SNAPSHOT_FILE_ID",
  snapshotChunkCount: "SNAPSHOT_CHUNK_COUNT",
  deployHookUrl: "VERCEL_DEPLOY_HOOK_URL",
  publicSiteUrl: "PUBLIC_SITE_URL",
  publishedRevision: "PUBLISHED_REVISION",
  publishedHash: "PUBLISHED_HASH",
  publishedAt: "PUBLISHED_AT",
  pendingRevision: "PENDING_REVISION",
  pendingHash: "PENDING_HASH",
  pendingRequestedAt: "PENDING_REQUESTED_AT",
  dashboardStatus: "DASHBOARD_STATUS",
  dashboardDetail: "DASHBOARD_DETAIL",
  draftDirty: "DRAFT_DIRTY",
});

var SNAPSHOT_CHUNK_KEY_PREFIX = "SNAPSHOT_CHUNK_";

var PUBLICATION_CELLS = Object.freeze({
  publish: "B2",
  status: "B3",
  publishedRevision: "B4",
  pendingRevision: "B5",
  publishedAt: "B6",
  detail: "B7",
  siteUrl: "B8",
  publishedHash: "B9",
  pendingHash: "B10",
  pendingRequestedAt: "B11",
});

var PUBLICATION_LABELS = Object.freeze([
  ["campo", "valor"],
  ["Publicar cambios", false],
  ["Estado", "Sin publicar"],
  ["Revisión publicada", 0],
  ["Revisión pendiente", "—"],
  ["Última publicación", "—"],
  ["Detalle", "La carta todavía no fue publicada."],
  ["Sitio público", ""],
  ["Hash publicado", ""],
  ["Hash pendiente", ""],
  ["Solicitud iniciada", ""],
]);
