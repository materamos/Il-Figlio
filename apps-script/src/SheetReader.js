/* eslint-disable no-unused-vars, no-undef -- Apps Script combines project files in one global scope. */

function setupProject() {
  return withScriptLock_(function () {
    var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    if (!spreadsheet) {
      throw new Error("Abrí la planilla vinculada antes de ejecutar setupProject.");
    }

    spreadsheet.setSpreadsheetLocale(APP_CONFIG.spreadsheetLocale);
    spreadsheet.setSpreadsheetTimeZone(APP_CONFIG.timeZone);
    PropertiesService.getScriptProperties().setProperty(
      SCRIPT_PROPERTY_KEYS.spreadsheetId,
      spreadsheet.getId(),
    );

    var sheets = ensureRequiredSheets_(spreadsheet);
    setupMenuSheet_(sheets.menu);
    setupStateSheet_(sheets.state);
    setupPublicationSheet_(sheets.publication);
    initializePublicationProperties_();
    installProjectTriggers_(spreadsheet);
    renderPublicationDashboard_();
    spreadsheet.toast("Planilla y triggers preparados.", "Il Figlio", 5);
    return { ok: true, spreadsheetId: spreadsheet.getId() };
  });
}

function configureProject() {
  var ui = SpreadsheetApp.getUi();
  var hookResponse = ui.prompt(
    "Configurar publicación",
    "Pegá el Deploy Hook de Vercel. Se guardará en Script Properties, no en la planilla.",
    ui.ButtonSet.OK_CANCEL,
  );
  if (hookResponse.getSelectedButton() !== ui.Button.OK) return;

  var hookUrl = normalizeText_(hookResponse.getResponseText());
  validateDeployHookUrl_(hookUrl);

  var siteResponse = ui.prompt(
    "Configurar publicación",
    "Pegá la URL pública del sitio, por ejemplo https://ilfiglio.example.",
    ui.ButtonSet.OK_CANCEL,
  );
  if (siteResponse.getSelectedButton() !== ui.Button.OK) return;

  var siteUrl = normalizeText_(siteResponse.getResponseText()).replace(/\/$/, "");
  validatePublicSiteUrl_(siteUrl);

  PropertiesService.getScriptProperties().setProperties({
    VERCEL_DEPLOY_HOOK_URL: hookUrl,
    PUBLIC_SITE_URL: siteUrl,
  });
  renderPublicationDashboard_();
  ui.alert("Configuración guardada en Script Properties.");
}

function validateDraft() {
  return withScriptLock_(function () {
    var result = readAndValidateDraft_();
    highlightValidationIssues_(result.issues);
    if (result.ok) {
      setDashboardState_("Borrador válido", "La carta está lista para publicar.");
    } else {
      setDashboardState_("Error de validación", formatIssues_(result.issues));
    }
    renderPublicationDashboard_();
    return result;
  });
}

function ensureRequiredSheets_(spreadsheet) {
  var names = Object.keys(APP_CONFIG.tabs).map(function (key) {
    return APP_CONFIG.tabs[key];
  });
  var existing = spreadsheet.getSheets();
  var menuSheet = spreadsheet.getSheetByName(APP_CONFIG.tabs.menu);

  if (!menuSheet && existing.length === 1 && isSheetEmpty_(existing[0])) {
    existing[0].setName(APP_CONFIG.tabs.menu);
    menuSheet = existing[0];
  }
  if (!menuSheet) menuSheet = spreadsheet.insertSheet(APP_CONFIG.tabs.menu);

  var stateSheet = spreadsheet.getSheetByName(APP_CONFIG.tabs.state)
    || spreadsheet.insertSheet(APP_CONFIG.tabs.state);
  var publicationSheet = spreadsheet.getSheetByName(APP_CONFIG.tabs.publication)
    || spreadsheet.insertSheet(APP_CONFIG.tabs.publication);

  var unexpected = spreadsheet.getSheets().filter(function (sheet) {
    return names.indexOf(sheet.getName()) === -1;
  });
  if (unexpected.length > 0) {
    throw new Error(
      "La planilla debe tener únicamente Carta, Estado y Publicacion. Pestañas inesperadas: "
        + unexpected.map(function (sheet) { return sheet.getName(); }).join(", "),
    );
  }

  return { menu: menuSheet, state: stateSheet, publication: publicationSheet };
}

function setupMenuSheet_(sheet) {
  if (isSheetEmpty_(sheet)) {
    sheet.getRange(1, 1, 1, MENU_HEADERS.length).setValues([MENU_HEADERS]);
    sheet.getRange(2, 1, INITIAL_MENU_ROWS.length, MENU_HEADERS.length)
      .setValues(INITIAL_MENU_ROWS.map(function (row) { return row.slice(); }));
  }
  assertSheetHeaders_(sheet, MENU_HEADERS);

  var dataRows = Math.max(1, sheet.getMaxRows() - 1);
  var categoryRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(CATEGORY_DEFINITIONS.map(function (definition) {
      return definition.sheetLabel;
    }), true)
    .setAllowInvalid(false)
    .build();
  var positiveNumberRule = SpreadsheetApp.newDataValidation()
    .requireNumberGreaterThan(0)
    .setAllowInvalid(false)
    .build();
  var visibilityRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(["Sí", "No"], true)
    .setAllowInvalid(false)
    .build();

  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, MENU_HEADERS.length)
    .setBackground("#1f2937")
    .setFontColor("#ffffff")
    .setFontWeight("bold");
  sheet.getRange(2, 2, dataRows, 1).setDataValidation(categoryRule);
  sheet.getRange(2, 3, dataRows, 1).setDataValidation(positiveNumberRule);
  sheet.getRange(2, 6, dataRows, 4)
    .setDataValidation(positiveNumberRule)
    .setNumberFormat("$ #,##0");
  sheet.getRange(2, 10, dataRows, 1).setDataValidation(visibilityRule);
  sheet.setColumnWidth(1, 250);
  sheet.setColumnWidth(2, 130);
  sheet.setColumnWidth(3, 70);
  sheet.setColumnWidth(4, 220);
  sheet.setColumnWidth(5, 480);
  sheet.setColumnWidths(6, 4, 125);
  sheet.setColumnWidth(10, 90);
  sheet.getRange(1, 1, sheet.getMaxRows(), MENU_HEADERS.length).setVerticalAlignment("middle");
  sheet.getRange(2, 5, dataRows, 1).setWrap(true);
  replaceWarningProtection_(sheet, "Il Figlio: IDs", sheet.getRange(2, 1, dataRows, 1));
}

function setupStateSheet_(sheet) {
  if (isSheetEmpty_(sheet)) {
    sheet.getRange(1, 1, 3, 2).setValues([
      STATE_HEADERS.slice(),
      ["estado", "Abierto"],
      ["mensaje", ""],
    ]);
  }
  assertSheetHeaders_(sheet, STATE_HEADERS);

  var statusRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(Object.keys(STATUS_BY_SHEET_LABEL), true)
    .setAllowInvalid(false)
    .build();
  var messageRule = SpreadsheetApp.newDataValidation()
    .requireFormulaSatisfied("=LEN(B3)<=160")
    .setAllowInvalid(false)
    .build();

  sheet.setFrozenRows(1);
  sheet.getRange("A1:B1")
    .setBackground("#1f2937")
    .setFontColor("#ffffff")
    .setFontWeight("bold");
  sheet.getRange("B2").setDataValidation(statusRule);
  sheet.getRange("B3").setDataValidation(messageRule).setWrap(true);
  sheet.setColumnWidth(1, 180);
  sheet.setColumnWidth(2, 480);
}

function setupPublicationSheet_(sheet) {
  if (isSheetEmpty_(sheet)) {
    sheet.getRange(1, 1, PUBLICATION_LABELS.length, 2)
      .setValues(PUBLICATION_LABELS.map(function (row) { return row.slice(); }));
  }
  assertSheetHeaders_(sheet, STATE_HEADERS);

  sheet.setFrozenRows(1);
  sheet.getRange("A1:B1")
    .setBackground("#1f2937")
    .setFontColor("#ffffff")
    .setFontWeight("bold");
  sheet.getRange(PUBLICATION_CELLS.publish).insertCheckboxes().setValue(false);
  sheet.getRange("A2:A11").setFontWeight("bold");
  sheet.getRange(PUBLICATION_CELLS.detail).setWrap(true);
  sheet.setColumnWidth(1, 190);
  sheet.setColumnWidth(2, 560);
  sheet.hideRows(9, 3);
  replaceWarningProtection_(sheet, "Il Figlio: estado de publicación", sheet.getRange("A3:B11"));
}

function readAndValidateDraft_() {
  var spreadsheet = getProjectSpreadsheet_();
  var menuSheet = requiredSheet_(spreadsheet, APP_CONFIG.tabs.menu);
  var stateSheet = requiredSheet_(spreadsheet, APP_CONFIG.tabs.state);
  ensureMissingItemIds_(menuSheet);

  var menuLastRow = Math.max(1, menuSheet.getLastRow());
  var stateLastRow = Math.max(3, stateSheet.getLastRow());
  var menuValues = menuSheet.getRange(1, 1, menuLastRow, MENU_HEADERS.length).getValues();
  var stateValues = stateSheet.getRange(1, 1, stateLastRow, STATE_HEADERS.length).getValues();
  return validateAndBuildDraft_(menuValues, stateValues);
}

function ensureMissingItemIds_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  var range = sheet.getRange(2, 1, lastRow - 1, MENU_HEADERS.length);
  var values = range.getValues();
  var idsChanged = false;

  values.forEach(function (row) {
    var hasContentWithoutId = row.slice(1).some(function (value) { return !isBlank_(value); });
    if (!normalizeText_(row[0]) && hasContentWithoutId) {
      row[0] = Utilities.getUuid();
      idsChanged = true;
    }
  });

  if (idsChanged) range.setValues(values);
}

function highlightValidationIssues_(issues) {
  var spreadsheet = getProjectSpreadsheet_();
  [APP_CONFIG.tabs.menu, APP_CONFIG.tabs.state].forEach(function (sheetName) {
    var sheet = requiredSheet_(spreadsheet, sheetName);
    var columns = sheetName === APP_CONFIG.tabs.menu ? MENU_HEADERS.length : STATE_HEADERS.length;
    var rows = Math.max(1, sheet.getLastRow() - 1);
    sheet.getRange(2, 1, rows, columns).setBackground(null).clearNote();
  });

  issues.forEach(function (issue) {
    requiredSheet_(spreadsheet, issue.sheet)
      .getRange(issue.row, issue.column)
      .setBackground("#fce8e6")
      .setNote(issue.message);
  });
}

function initializePublicationProperties_() {
  var properties = PropertiesService.getScriptProperties();
  var defaults = {};
  if (!properties.getProperty(SCRIPT_PROPERTY_KEYS.publishedRevision)) {
    defaults.PUBLISHED_REVISION = "0";
  }
  if (!properties.getProperty(SCRIPT_PROPERTY_KEYS.dashboardStatus)) {
    defaults.DASHBOARD_STATUS = "Sin publicar";
  }
  if (!properties.getProperty(SCRIPT_PROPERTY_KEYS.dashboardDetail)) {
    defaults.DASHBOARD_DETAIL = "Configurá Vercel y publicá la primera revisión.";
  }
  if (!properties.getProperty(SCRIPT_PROPERTY_KEYS.draftDirty)) {
    defaults.DRAFT_DIRTY = "false";
  }
  if (Object.keys(defaults).length > 0) properties.setProperties(defaults);
}

function renderPublicationDashboard_() {
  var properties = PropertiesService.getScriptProperties();
  var sheet = requiredSheet_(getProjectSpreadsheet_(), APP_CONFIG.tabs.publication);
  var publishedRevision = properties.getProperty(SCRIPT_PROPERTY_KEYS.publishedRevision) || "0";
  var pendingRevision = properties.getProperty(SCRIPT_PROPERTY_KEYS.pendingRevision) || "—";

  sheet.getRange(PUBLICATION_CELLS.status)
    .setValue(properties.getProperty(SCRIPT_PROPERTY_KEYS.dashboardStatus) || "Sin publicar");
  sheet.getRange(PUBLICATION_CELLS.publishedRevision).setValue(Number(publishedRevision));
  sheet.getRange(PUBLICATION_CELLS.pendingRevision).setValue(pendingRevision);
  sheet.getRange(PUBLICATION_CELLS.publishedAt)
    .setValue(properties.getProperty(SCRIPT_PROPERTY_KEYS.publishedAt) || "—");
  sheet.getRange(PUBLICATION_CELLS.detail)
    .setValue(properties.getProperty(SCRIPT_PROPERTY_KEYS.dashboardDetail) || "");
  sheet.getRange(PUBLICATION_CELLS.siteUrl)
    .setValue(properties.getProperty(SCRIPT_PROPERTY_KEYS.publicSiteUrl) || "");
  sheet.getRange(PUBLICATION_CELLS.publishedHash)
    .setValue(properties.getProperty(SCRIPT_PROPERTY_KEYS.publishedHash) || "");
  sheet.getRange(PUBLICATION_CELLS.pendingHash)
    .setValue(properties.getProperty(SCRIPT_PROPERTY_KEYS.pendingHash) || "");
  sheet.getRange(PUBLICATION_CELLS.pendingRequestedAt)
    .setValue(properties.getProperty(SCRIPT_PROPERTY_KEYS.pendingRequestedAt) || "");
}

function setDashboardState_(status, detail) {
  PropertiesService.getScriptProperties().setProperties({
    DASHBOARD_STATUS: status,
    DASHBOARD_DETAIL: detail,
  });
}

function markDraftDirty_() {
  var properties = PropertiesService.getScriptProperties();
  properties.setProperty(SCRIPT_PROPERTY_KEYS.draftDirty, "true");
  var pendingRevision = properties.getProperty(SCRIPT_PROPERTY_KEYS.pendingRevision);
  if (pendingRevision) {
    setDashboardState_(
      "Revisión " + pendingRevision + " pendiente",
      "Los cambios nuevos quedan en borrador hasta confirmar esa revisión.",
    );
  } else {
    setDashboardState_("Cambios sin publicar", "Validá o publicá la nueva versión de la carta.");
  }
  renderPublicationDashboard_();
}

function formatIssues_(issues) {
  return issues.map(function (issue) {
    return "• " + issue.path + ": " + issue.message;
  }).join("\n");
}

function installProjectTriggers_(spreadsheet) {
  var handlerNames = ["handlePublishEdit", "verifyPublishedRevision"];
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (handlerNames.indexOf(trigger.getHandlerFunction()) !== -1) {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp.newTrigger("handlePublishEdit")
    .forSpreadsheet(spreadsheet)
    .onEdit()
    .create();
  ScriptApp.newTrigger("verifyPublishedRevision")
    .timeBased()
    .everyMinutes(5)
    .create();
}

function getProjectSpreadsheet_() {
  var properties = PropertiesService.getScriptProperties();
  var spreadsheetId = properties.getProperty(SCRIPT_PROPERTY_KEYS.spreadsheetId);
  if (spreadsheetId) return SpreadsheetApp.openById(spreadsheetId);

  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) throw new Error("Falta SPREADSHEET_ID. Ejecutá setupProject una vez.");
  properties.setProperty(SCRIPT_PROPERTY_KEYS.spreadsheetId, active.getId());
  return active;
}

function withScriptLock_(operation) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    throw new Error("Ya hay otra operación de publicación en curso.");
  }
  try {
    return operation();
  } finally {
    lock.releaseLock();
  }
}

function assertSheetHeaders_(sheet, expected) {
  var actual = sheet.getRange(1, 1, 1, expected.length).getValues()[0];
  var matches = expected.every(function (header, index) {
    return normalizeText_(actual[index]) === header;
  });
  if (!matches) {
    throw new Error("Los encabezados de " + sheet.getName() + " no coinciden con el contrato esperado.");
  }
}

function replaceWarningProtection_(sheet, description, range) {
  sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach(function (protection) {
    if (protection.getDescription() === description) protection.remove();
  });
  range.protect().setDescription(description).setWarningOnly(true);
}

function requiredSheet_(spreadsheet, name) {
  var sheet = spreadsheet.getSheetByName(name);
  if (!sheet) throw new Error("Falta la pestaña obligatoria " + name + ".");
  return sheet;
}

function isSheetEmpty_(sheet) {
  return sheet.getDataRange().getDisplayValues().every(function (row) {
    return row.every(function (value) { return value.trim() === ""; });
  });
}

function validateDeployHookUrl_(rawUrl) {
  var match = /^https:\/\/api\.vercel\.com\/v1\/integrations\/deploy\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)?(?:\?.*)?$/.test(rawUrl);
  if (!match) throw new Error("El Deploy Hook debe ser una URL HTTPS válida de api.vercel.com.");
}

function validatePublicSiteUrl_(rawUrl) {
  if (!/^https:\/\/[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?(?::[0-9]+)?\/?$/.test(rawUrl)) {
    throw new Error("La URL pública debe ser el origen HTTPS del sitio, sin ruta, query ni fragmento.");
  }
}
