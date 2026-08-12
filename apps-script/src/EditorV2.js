/* eslint-disable no-unused-vars, no-undef -- Apps Script combines project files in one global scope. */

var EDITOR_V2_MIN_DATA_ROWS = 200;

function editorV2Headers_(definition) {
  return ["Producto"]
    .concat(definition.priceKinds.map(function (kind) {
      return EDITOR_V2_PRICE_LABELS[kind];
    }))
    .concat(["Mostrar", "Descripción", "_id"]);
}

function editorV2CategoryBySheetName_(sheetName) {
  return EDITOR_V2_CATEGORY_DEFINITIONS.find(function (definition) {
    return definition.sheetName === sheetName;
  }) || null;
}

function editorV2CategoryById_(categoryId) {
  return EDITOR_V2_CATEGORY_DEFINITIONS.find(function (definition) {
    return definition.categoryId === categoryId;
  }) || null;
}

function editorV2SheetNames_() {
  return [APP_CONFIG.editorTabs.publication, APP_CONFIG.editorTabs.local]
    .concat(EDITOR_V2_CATEGORY_DEFINITIONS.map(function (definition) {
      return definition.sheetName;
    }));
}

function legacySheetNames_() {
  return [APP_CONFIG.tabs.menu, APP_CONFIG.tabs.state, APP_CONFIG.tabs.publication];
}

function detectSheetSchemaFromNames_(sheetNames) {
  var names = Array.isArray(sheetNames) ? sheetNames : [];
  var hasAllV2 = editorV2SheetNames_().every(function (name) {
    return names.indexOf(name) !== -1;
  });
  var hasAllLegacy = legacySheetNames_().every(function (name) {
    return names.indexOf(name) !== -1;
  });
  var hasAnyV2 = editorV2SheetNames_().some(function (name) {
    return names.indexOf(name) !== -1;
  });
  var hasAnyKnown = editorV2SheetNames_().concat(legacySheetNames_()).some(function (name) {
    return names.indexOf(name) !== -1;
  });

  if (hasAllV2 && hasAllLegacy) return "dual";
  if (hasAllV2) return "v2";
  if (hasAllLegacy && !hasAnyV2) return "legacy";
  return hasAnyKnown ? "partial" : "unknown";
}

function detectSheetSchema_(spreadsheet) {
  var detected = detectSheetSchemaFromNames_(spreadsheet.getSheets().map(function (sheet) {
    return sheet.getName();
  }));
  if (detected === "dual") {
    var storedVersion = PropertiesService.getScriptProperties()
      .getProperty(SCRIPT_PROPERTY_KEYS.sheetSchemaVersion);
    if (storedVersion === String(APP_CONFIG.sheetSchemaVersion)) return "v2";
  }
  return detected;
}

function upgradeSheetExperience() {
  return withScriptLock_(function () {
    var spreadsheet = SpreadsheetApp.getActiveSpreadsheet() || getProjectSpreadsheet_();
    if (!spreadsheet) throw new Error("Abrí la planilla de Il Figlio antes de continuar.");

    spreadsheet.setSpreadsheetLocale(APP_CONFIG.spreadsheetLocale);
    spreadsheet.setSpreadsheetTimeZone(APP_CONFIG.timeZone);
    PropertiesService.getScriptProperties().setProperty(
      SCRIPT_PROPERTY_KEYS.spreadsheetId,
      spreadsheet.getId(),
    );

    var schema = detectSheetSchema_(spreadsheet);
    if (schema === "v2") {
      finishEditorV2Setup_(spreadsheet, false);
      spreadsheet.toast("El editor ya está preparado para usar desde el celular.", "Il Figlio", 5);
      return { ok: true, migrated: false, schemaVersion: APP_CONFIG.sheetSchemaVersion };
    }
    if (schema === "dual") return finishInterruptedV2Migration_(spreadsheet);
    if ((schema === "unknown" || schema === "partial") && isBootstrapCandidate_(spreadsheet)) {
      return bootstrapEditorV2_(spreadsheet);
    }
    if (schema !== "legacy") {
      throw new Error(
        "La estructura de pestañas está incompleta. No se modificó ningún dato. "
          + "Deben existir Carta, Estado y Publicacion, o bien el editor móvil completo.",
      );
    }

    return migrateLegacySheetsToV2_(spreadsheet);
  });
}

function migrateLegacySheetsToV2_(spreadsheet) {
  var migration = prepareV2MigrationData_(
    readSheetValues_(requiredSheet_(spreadsheet, APP_CONFIG.tabs.menu), MENU_HEADERS.length),
    readSheetValues_(requiredSheet_(spreadsheet, APP_CONFIG.tabs.state), STATE_HEADERS.length),
  );
  createLegacySheetBackup_(spreadsheet);

  var createdNames = [];
  var finalizationStarted = false;
  try {
    createV2Sheets_(spreadsheet, migration, createdNames);
    assertV2MatchesDraft_(spreadsheet, migration.legacyDraft);
    finalizationStarted = true;
    hideLegacySheets_(spreadsheet);
    finishEditorV2Setup_(spreadsheet, true);
  } catch (error) {
    if (!finalizationStarted) {
      createdNames.forEach(function (name) {
        var created = spreadsheet.getSheetByName(name);
        if (created) spreadsheet.deleteSheet(created);
      });
    }
    throw error;
  }

  spreadsheet.toast("Editor móvil preparado. Los productos y precios se conservaron.", "Il Figlio", 8);
  return {
    ok: true,
    migrated: true,
    schemaVersion: APP_CONFIG.sheetSchemaVersion,
    backupFileId: PropertiesService.getScriptProperties()
      .getProperty(SCRIPT_PROPERTY_KEYS.sheetV1BackupFileId),
  };
}

function finishInterruptedV2Migration_(spreadsheet) {
  var legacy = prepareV2MigrationData_(
    readSheetValues_(requiredSheet_(spreadsheet, APP_CONFIG.tabs.menu), MENU_HEADERS.length),
    readSheetValues_(requiredSheet_(spreadsheet, APP_CONFIG.tabs.state), STATE_HEADERS.length),
  );
  assertV2MatchesDraft_(spreadsheet, legacy.legacyDraft);
  createLegacySheetBackup_(spreadsheet);
  hideLegacySheets_(spreadsheet);
  finishEditorV2Setup_(spreadsheet, true);
  spreadsheet.toast("La migración pendiente quedó completada.", "Il Figlio", 6);
  return { ok: true, migrated: true, recovered: true, schemaVersion: 2 };
}

function prepareV2MigrationData_(legacyMenuValues, legacyStateValues) {
  var normalizedMenuValues = cloneRows_(legacyMenuValues);
  addMissingLegacyIdsInMemory_(normalizedMenuValues);
  var legacyValidation = validateAndBuildDraft_(normalizedMenuValues, legacyStateValues);
  if (!legacyValidation.ok) {
    throw new Error("La planilla actual tiene errores. Corregilos antes de preparar el editor móvil:\n"
      + formatIssues_(legacyValidation.issues));
  }

  var categorySheets = buildV2CategoryMatrices_(normalizedMenuValues);
  var localSheet = buildV2LocalMatrix_(legacyStateValues);
  var v2Validation = validateAndBuildEditorV2Draft_(categorySheets, localSheet);
  if (!v2Validation.ok) {
    throw new Error("No se pudo convertir la carta sin errores:\n" + formatIssues_(v2Validation.issues));
  }
  if (!draftsAreCanonicallyEqual_(legacyValidation.draft, v2Validation.draft)) {
    throw new Error(
      "La conversión no produce exactamente la misma carta. No se modificó ninguna pestaña.",
    );
  }

  return {
    categorySheets: categorySheets,
    localSheet: localSheet,
    legacyDraft: legacyValidation.draft,
  };
}

function isBootstrapCandidate_(spreadsheet) {
  var sheets = spreadsheet.getSheets();
  return sheets.length === 1 && isSheetEmpty_(sheets[0]);
}

function bootstrapEditorV2_(spreadsheet) {
  var migration = prepareV2MigrationData_(
    [MENU_HEADERS.slice()].concat(INITIAL_MENU_ROWS.map(function (row) { return row.slice(); })),
    [STATE_HEADERS.slice(), ["estado", "Abierto"], ["mensaje", ""]],
  );
  var previousSheets = spreadsheet.getSheets().slice();
  var createdNames = [];
  try {
    createV2Sheets_(spreadsheet, migration, createdNames);
    assertV2MatchesDraft_(spreadsheet, migration.legacyDraft);
  } catch (error) {
    createdNames.forEach(function (name) {
      var created = spreadsheet.getSheetByName(name);
      if (created) spreadsheet.deleteSheet(created);
    });
    throw error;
  }
  finishEditorV2Setup_(spreadsheet, true);
  previousSheets.forEach(function (sheet) { spreadsheet.deleteSheet(sheet); });
  spreadsheet.toast("Editor móvil preparado con la carta inicial.", "Il Figlio", 8);
  return { ok: true, migrated: false, bootstrapped: true, schemaVersion: 2 };
}

function addMissingLegacyIdsInMemory_(menuValues) {
  menuValues.slice(1).forEach(function (row) {
    var hasContentWithoutId = row.slice(1).some(function (value) { return !isBlank_(value); });
    if (!normalizeText_(row[0]) && hasContentWithoutId) row[0] = Utilities.getUuid();
  });
}

function buildV2CategoryMatrices_(legacyMenuValues) {
  var result = {};
  EDITOR_V2_CATEGORY_DEFINITIONS.forEach(function (editorDefinition) {
    var categoryDefinition = CATEGORY_DEFINITIONS.find(function (definition) {
      return definition.id === editorDefinition.categoryId;
    });
    var rows = legacyMenuValues.slice(1)
      .filter(function (row) {
        return !isEmptyMenuRow_(row)
          && normalizeText_(row[1]) === categoryDefinition.sheetLabel;
      })
      .sort(function (left, right) {
        return Number(left[2]) - Number(right[2]);
      })
      .map(function (row) {
        var values = [normalizeText_(row[3])];
        editorDefinition.priceKinds.forEach(function (kind) {
          values.push(row[PRICE_COLUMNS[kind] - 1]);
        });
        values.push(parseVisibility_(row[9]) === true);
        values.push(normalizeText_(row[4]));
        values.push(normalizeText_(row[0]));
        return values;
      });
    result[editorDefinition.sheetName] = [editorV2Headers_(editorDefinition)].concat(rows);
  });
  return result;
}

function buildV2LocalMatrix_(legacyStateValues) {
  var fields = {};
  legacyStateValues.slice(1).forEach(function (row) {
    fields[normalizeText_(row[0])] = row[1];
  });
  return [
    EDITOR_V2_LOCAL_HEADERS.slice(),
    ["Estado", fields.estado || "Abierto"],
    ["Mensaje para clientes (opcional)", fields.mensaje || ""],
  ];
}

function createV2Sheets_(spreadsheet, migration, createdNames) {
  var publication = spreadsheet.insertSheet(APP_CONFIG.editorTabs.publication);
  createdNames.push(APP_CONFIG.editorTabs.publication);
  setupV2PublicationSheet_(publication);

  var local = spreadsheet.insertSheet(APP_CONFIG.editorTabs.local);
  createdNames.push(APP_CONFIG.editorTabs.local);
  local.getRange(1, 1, migration.localSheet.length, 2).setValues(migration.localSheet);
  setupV2LocalSheet_(local);

  EDITOR_V2_CATEGORY_DEFINITIONS.forEach(function (definition) {
    var matrix = migration.categorySheets[definition.sheetName];
    var sheet = spreadsheet.insertSheet(definition.sheetName);
    createdNames.push(definition.sheetName);
    ensureMinimumRows_(sheet, EDITOR_V2_MIN_DATA_ROWS + 1);
    sheet.getRange(1, 1, matrix.length, matrix[0].length).setValues(matrix);
    setupV2CategorySheet_(sheet, definition);
  });
}

function createLegacySheetBackup_(spreadsheet) {
  var properties = PropertiesService.getScriptProperties();
  var existingFileId = properties.getProperty(SCRIPT_PROPERTY_KEYS.sheetV1BackupFileId);
  if (existingFileId) {
    try {
      DriveApp.getFileById(existingFileId).getName();
      return existingFileId;
    } catch (_error) {
      properties.deleteProperty(SCRIPT_PROPERTY_KEYS.sheetV1BackupFileId);
    }
  }
  var payload = {
    schema_version: 1,
    created_at: new Date().toISOString(),
    spreadsheet_id: spreadsheet.getId(),
    sheets: {},
  };
  legacySheetNames_().forEach(function (name) {
    var sheet = requiredSheet_(spreadsheet, name);
    payload.sheets[name] = sheet.getDataRange().getValues();
  });
  var timestamp = payload.created_at.replace(/[:.]/g, "-");
  var file = DriveApp.createFile(
    "il-figlio-sheet-v1-backup-" + timestamp + ".json",
    JSON.stringify(payload),
    MimeType.PLAIN_TEXT,
  );
  properties.setProperty(
    SCRIPT_PROPERTY_KEYS.sheetV1BackupFileId,
    file.getId(),
  );
  return file.getId();
}

function hideLegacySheets_(spreadsheet) {
  legacySheetNames_().forEach(function (name) {
    var sheet = spreadsheet.getSheetByName(name);
    if (!sheet) return;
    replaceWarningProtection_(
      sheet,
      "Il Figlio: respaldo anterior " + name,
      sheet.getDataRange(),
    );
    sheet.hideSheet();
  });
}

function finishEditorV2Setup_(spreadsheet, normalizeDashboard) {
  setupV2PublicationSheet_(requiredSheet_(spreadsheet, APP_CONFIG.editorTabs.publication));
  setupV2LocalSheet_(requiredSheet_(spreadsheet, APP_CONFIG.editorTabs.local));
  EDITOR_V2_CATEGORY_DEFINITIONS.forEach(function (definition) {
    setupV2CategorySheet_(requiredSheet_(spreadsheet, definition.sheetName), definition);
  });
  ensureEditorV2ItemIds_(spreadsheet);
  orderV2Sheets_(spreadsheet);
  hideLegacySheets_(spreadsheet);
  PropertiesService.getScriptProperties().setProperty(
    SCRIPT_PROPERTY_KEYS.sheetSchemaVersion,
    String(APP_CONFIG.sheetSchemaVersion),
  );
  initializePublicationProperties_();
  if (normalizeDashboard) normalizeEditorV2DashboardCopy_();
  installProjectTriggers_(spreadsheet);
  renderPublicationDashboard_();
}

function restoreEditorFormatting() {
  return withScriptLock_(function () {
    var spreadsheet = getProjectSpreadsheet_();
    if (detectSheetSchema_(spreadsheet) !== "v2") {
      throw new Error("Primero ejecutá Preparar editor móvil.");
    }
    setupV2PublicationSheet_(requiredSheet_(spreadsheet, APP_CONFIG.editorTabs.publication));
    setupV2LocalSheet_(requiredSheet_(spreadsheet, APP_CONFIG.editorTabs.local));
    EDITOR_V2_CATEGORY_DEFINITIONS.forEach(function (definition) {
      setupV2CategorySheet_(requiredSheet_(spreadsheet, definition.sheetName), definition);
    });
    ensureEditorV2ItemIds_(spreadsheet);
    renderPublicationDashboard_();
    spreadsheet.toast("Formato y controles restaurados.", "Il Figlio", 5);
    return { ok: true };
  });
}

function normalizeEditorV2DashboardCopy_() {
  var properties = PropertiesService.getScriptProperties();
  var pendingRevision = parseStoredPositiveInteger_(
    properties.getProperty(SCRIPT_PROPERTY_KEYS.pendingRevision),
  );
  var publishedRevision = parseStoredNonNegativeInteger_(
    properties.getProperty(SCRIPT_PROPERTY_KEYS.publishedRevision),
  );
  var draftDirty = properties.getProperty(SCRIPT_PROPERTY_KEYS.draftDirty) === "true";
  if (pendingRevision !== null) {
    setDashboardState_(
      "Publicando…",
      "La actualización puede tardar unos minutos. No hace falta volver a marcar la casilla.",
    );
    return;
  }
  if (publishedRevision > 0) {
    var published = buildPublishedDashboardState_(publishedRevision, draftDirty);
    setDashboardState_(published.status, published.detail);
    return;
  }
  if (draftDirty) {
    setDashboardState_("Hay cambios pendientes", "Cuando termines, marcá Publicar cambios.");
    return;
  }
  setDashboardState_("Todavía no publicado", "Prepará la carta y publicá la primera actualización.");
}

function orderV2Sheets_(spreadsheet) {
  editorV2SheetNames_().forEach(function (name, index) {
    var sheet = spreadsheet.getSheetByName(name);
    if (!sheet) return;
    spreadsheet.setActiveSheet(sheet);
    spreadsheet.moveActiveSheet(index + 1);
  });
  spreadsheet.setActiveSheet(requiredSheet_(spreadsheet, APP_CONFIG.editorTabs.publication));
}

function setupV2CategorySheet_(sheet, definition) {
  var headers = editorV2Headers_(definition);
  ensureMinimumRows_(sheet, EDITOR_V2_MIN_DATA_ROWS + 1);
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  var dataRows = Math.max(1, sheet.getMaxRows() - 1);
  var showColumn = 2 + definition.priceKinds.length;
  var descriptionColumn = showColumn + 1;
  var idColumn = descriptionColumn + 1;

  var nameRule = SpreadsheetApp.newDataValidation()
    .requireFormulaSatisfied("=LEN(A2)<=" + EDITOR_V2_FIELD_LIMITS.name)
    .setAllowInvalid(false)
    .setHelpText("Máximo " + EDITOR_V2_FIELD_LIMITS.name + " caracteres.")
    .build();
  var checkboxRule = SpreadsheetApp.newDataValidation()
    .requireCheckbox()
    .setAllowInvalid(false)
    .setHelpText("Marcá la casilla para mostrar el producto en el menú.")
    .build();
  var descriptionLetter = columnToLetter_(descriptionColumn);
  var descriptionRule = SpreadsheetApp.newDataValidation()
    .requireFormulaSatisfied("=LEN(" + descriptionLetter + "2)<=" + EDITOR_V2_FIELD_LIMITS.description)
    .setAllowInvalid(false)
    .setHelpText("Máximo " + EDITOR_V2_FIELD_LIMITS.description + " caracteres.")
    .build();

  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(1);
  sheet.setTabColor("#b80000");
  sheet.setRowHeight(1, 44);
  sheet.setRowHeights(2, dataRows, 48);
  sheet.getRange(1, 1, 1, headers.length)
    .setBackground("#b80000")
    .setFontColor("#ffffff")
    .setFontWeight("bold")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");
  sheet.getRange(2, 1, dataRows, headers.length)
    .setBackground("#fff9f7")
    .setFontColor("#171717")
    .setVerticalAlignment("middle");
  sheet.getRange(2, 1, dataRows, 1).setDataValidation(nameRule).setWrap(true);
  definition.priceKinds.forEach(function (_kind, index) {
    var column = index + 2;
    var priceRule = SpreadsheetApp.newDataValidation()
      .requireNumberGreaterThan(0)
      .setAllowInvalid(false)
      .setHelpText("Ingresá un precio mayor que cero. También se revisará antes de publicar.")
      .build();
    sheet.getRange(2, column, dataRows, 1)
      .setDataValidation(priceRule)
      .setNumberFormat("$ #,##0")
      .setHorizontalAlignment("right");
  });
  sheet.getRange(2, showColumn, dataRows, 1)
    .setDataValidation(checkboxRule)
    .setHorizontalAlignment("center");
  sheet.getRange(2, descriptionColumn, dataRows, 1)
    .setDataValidation(descriptionRule)
    .setWrap(true);

  sheet.setColumnWidth(1, 180);
  definition.priceKinds.forEach(function (_kind, index) {
    sheet.setColumnWidth(index + 2, 96);
  });
  sheet.setColumnWidth(showColumn, 80);
  sheet.setColumnWidth(descriptionColumn, 320);
  sheet.setColumnWidth(idColumn, 180);
  sheet.showColumns(1, headers.length);
  sheet.hideColumns(idColumn);
  if (sheet.getMaxColumns() > headers.length) {
    sheet.hideColumns(headers.length + 1, sheet.getMaxColumns() - headers.length);
  }

  var showLetter = columnToLetter_(showColumn);
  sheet.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied("=AND($A2<>\"\",$" + showLetter + "2=FALSE)")
      .setBackground("#f3efed")
      .setFontColor("#66615f")
      .setStrikethrough(true)
      .setRanges([sheet.getRange(2, 1, dataRows, descriptionColumn)])
      .build(),
  ]);
  replaceWarningProtection_(sheet, "Il Figlio: encabezado " + sheet.getName(), sheet.getRange(1, 1, 1, headers.length));
  replaceWarningProtection_(sheet, "Il Figlio: IDs " + sheet.getName(), sheet.getRange(2, idColumn, dataRows, 1));
}

function setupV2LocalSheet_(sheet) {
  ensureMinimumRows_(sheet, 3);
  sheet.getRange(1, 1, 1, 2).setValues([EDITOR_V2_LOCAL_HEADERS.slice()]);
  sheet.getRange("A2:A3").setValues([["Estado"], ["Mensaje para clientes (opcional)"]]);
  var statusRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(Object.keys(STATUS_BY_SHEET_LABEL), true)
    .setAllowInvalid(false)
    .setHelpText("Elegí Abierto, Cerrado o Agotado.")
    .build();
  var messageRule = SpreadsheetApp.newDataValidation()
    .requireFormulaSatisfied("=LEN(B3)<=" + EDITOR_V2_FIELD_LIMITS.message)
    .setAllowInvalid(false)
    .setHelpText("Este texto se muestra al inicio del menú. Máximo 160 caracteres.")
    .build();
  sheet.setFrozenRows(1);
  sheet.setTabColor("#b80000");
  sheet.setRowHeight(1, 44);
  sheet.setRowHeights(2, 2, 56);
  sheet.getRange("A1:B1").setBackground("#b80000").setFontColor("#ffffff").setFontWeight("bold");
  sheet.getRange("A2:B3").setBackground("#fff9f7").setFontColor("#171717").setVerticalAlignment("middle");
  sheet.getRange("A2:A3").setFontWeight("bold").setWrap(true);
  sheet.getRange("B2").setDataValidation(statusRule);
  sheet.getRange("B3").setDataValidation(messageRule).setWrap(true).setNote("Se muestra al inicio del menú.");
  sheet.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo("Abierto")
      .setBackground("#dcfce7")
      .setFontColor("#166534")
      .setRanges([sheet.getRange("B2")])
      .build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo("Cerrado")
      .setBackground("#ffe4e6")
      .setFontColor("#9f1239")
      .setRanges([sheet.getRange("B2")])
      .build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo("Agotado")
      .setBackground("#ffedd5")
      .setFontColor("#8a4b08")
      .setRanges([sheet.getRange("B2")])
      .build(),
  ]);
  sheet.setColumnWidth(1, 220);
  sheet.setColumnWidth(2, 360);
  if (sheet.getMaxColumns() > 2) sheet.hideColumns(3, sheet.getMaxColumns() - 2);
  replaceWarningProtection_(sheet, "Il Figlio: etiquetas Local", sheet.getRange("A1:A3"));
  replaceWarningProtection_(sheet, "Il Figlio: encabezado Local", sheet.getRange("B1"));
}

function setupV2PublicationSheet_(sheet) {
  ensureMinimumRows_(sheet, 17);
  sheet.getRange(1, 1, 1, 2).setValues([EDITOR_V2_PUBLICATION_LABELS[0].slice()]);
  sheet.getRange(2, 1, EDITOR_V2_PUBLICATION_LABELS.length - 1, 1)
    .setValues(EDITOR_V2_PUBLICATION_LABELS.slice(1).map(function (row) { return [row[0]]; }));
  var publishCell = sheet.getRange(EDITOR_V2_PUBLICATION_CELLS.publish);
  publishCell.setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireCheckbox()
      .setAllowInvalid(false)
      .setHelpText("Marcá una vez. La confirmación puede tardar unos minutos.")
      .build(),
  );
  if (publishCell.getValue() !== true && publishCell.getValue() !== false) publishCell.setValue(false);

  sheet.setFrozenRows(1);
  sheet.setTabColor("#b80000");
  sheet.setRowHeight(1, 44);
  sheet.setRowHeights(2, 5, 56);
  sheet.getRange("A1:B1").setBackground("#b80000").setFontColor("#ffffff").setFontWeight("bold");
  sheet.getRange("A2:B6").setBackground("#fff9f7").setFontColor("#171717").setVerticalAlignment("middle");
  sheet.getRange("A2:A11").setFontWeight("bold").setWrap(true);
  sheet.getRange("B2").setHorizontalAlignment("center");
  sheet.getRange("B3:B5").setWrap(true);
  sheet.getRange("A13:B17").setValues([
    ["Cómo actualizar el menú", ""],
    ["1", "Editá una categoría."],
    ["2", "Desmarcá Mostrar para ocultar un producto."],
    ["3", "Arrastrá la fila para cambiar el orden."],
    ["4", "Volvé aquí y marcá Publicar cambios."],
  ]).setWrap(true);
  sheet.getRange("A13:B13").setBackground("#b80000").setFontColor("#ffffff").setFontWeight("bold");
  sheet.getRange("A14:A17").setBackground("#f3efed").setFontWeight("bold").setHorizontalAlignment("center");
  sheet.getRange("B14:B17").setBackground("#fff9f7");
  sheet.setRowHeight(13, 44);
  sheet.setRowHeights(14, 4, 48);
  sheet.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo("Menú actualizado")
      .setBackground("#dcfce7")
      .setFontColor("#166534")
      .setRanges([sheet.getRange("B3")])
      .build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo("Hay cambios pendientes")
      .setBackground("#ffedd5")
      .setFontColor("#8a4b08")
      .setRanges([sheet.getRange("B3")])
      .build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextContains("Publicando")
      .setBackground("#e0f2fe")
      .setFontColor("#334155")
      .setRanges([sheet.getRange("B3")])
      .build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextContains("No se pudo")
      .setBackground("#ffe4e6")
      .setFontColor("#9f1239")
      .setRanges([sheet.getRange("B3")])
      .build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextContains("campos para corregir")
      .setBackground("#ffe4e6")
      .setFontColor("#9f1239")
      .setRanges([sheet.getRange("B3")])
      .build(),
  ]);
  sheet.setColumnWidth(1, 210);
  sheet.setColumnWidth(2, 360);
  if (sheet.getMaxColumns() > 2) sheet.hideColumns(3, sheet.getMaxColumns() - 2);
  sheet.hideRows(7, 5);
  replaceWarningProtection_(sheet, "Il Figlio: encabezado Publicar", sheet.getRange("A1:B1"));
  replaceWarningProtection_(sheet, "Il Figlio: etiquetas Publicar", sheet.getRange("A2:A11"));
  replaceWarningProtection_(sheet, "Il Figlio: estado Publicar", sheet.getRange("B3:B11"));
  replaceWarningProtection_(sheet, "Il Figlio: instrucciones Publicar", sheet.getRange("A13:B17"));
}

function ensureMinimumRows_(sheet, requiredRows) {
  if (sheet.getMaxRows() < requiredRows) {
    sheet.insertRowsAfter(sheet.getMaxRows(), requiredRows - sheet.getMaxRows());
  }
}

function validateAndBuildEditorV2Draft_(categoryValuesBySheet, localValues) {
  var issues = [];
  var parsedItems = [];
  EDITOR_V2_CATEGORY_DEFINITIONS.forEach(function (definition) {
    var values = categoryValuesBySheet[definition.sheetName];
    var headers = editorV2Headers_(definition);
    validateHeaders_(values && values[0], headers, definition.sheetName, issues);
    if (!values) return;
    parsedItems = parsedItems.concat(parseEditorV2Rows_(values.slice(1), definition, issues));
  });
  var business = parseEditorV2BusinessState_(localValues, issues);
  validateEditorV2Uniqueness_(parsedItems, issues);

  var categories = CATEGORY_DEFINITIONS.map(function (definition) {
    return {
      code: definition.id,
      title: definition.name,
      order_index: definition.orderIndex,
      price_kinds: definition.allowedPriceKinds.slice(),
      items: parsedItems.filter(function (item) {
        return item.visible && item.category_code === definition.id;
      }).map(function (item) {
        return {
          id: item.id,
          category_code: item.category_code,
          name: item.name,
          description: item.description,
          order_index: item.order_index,
          prices: item.prices,
        };
      }),
    };
  });

  return {
    ok: issues.length === 0,
    issues: issues,
    draft: { currency: "ARS", business: business, categories: categories },
  };
}

function parseEditorV2Rows_(rows, definition, issues) {
  var headers = editorV2Headers_(definition);
  var showIndex = 1 + definition.priceKinds.length;
  var descriptionIndex = showIndex + 1;
  var idIndex = descriptionIndex + 1;
  var orderIndex = 0;
  var items = [];

  rows.forEach(function (row, index) {
    if (isEmptyEditorV2Row_(row, definition)) return;
    orderIndex += 1;
    var sheetRow = index + 2;
    var visible = isBlank_(row[showIndex]) ? false : parseVisibility_(row[showIndex]);
    var id = normalizeText_(row[idIndex]);
    var name = normalizeText_(row[0]);
    var description = normalizeText_(row[descriptionIndex]);
    var prices = {};

    if (!STABLE_ITEM_ID_PATTERN.test(id)) {
      issues.push(issue_(definition.sheetName, sheetRow, idIndex + 1, "No se pudo asignar el identificador interno."));
    }
    if (visible === null) {
      issues.push(issue_(definition.sheetName, sheetRow, showIndex + 1, "Usá la casilla Mostrar."));
    }
    if (visible === true) {
      if (!name) issues.push(issue_(definition.sheetName, sheetRow, 1, "Escribí el nombre del producto."));
      if (name.length > EDITOR_V2_FIELD_LIMITS.name) {
        issues.push(issue_(definition.sheetName, sheetRow, 1, "El nombre puede tener hasta 80 caracteres."));
      }
      if (description.length > EDITOR_V2_FIELD_LIMITS.description) {
        issues.push(issue_(definition.sheetName, sheetRow, descriptionIndex + 1, "La descripción puede tener hasta 240 caracteres."));
      }
      definition.priceKinds.forEach(function (kind, priceIndex) {
        var amount = parsePositiveInteger_(row[priceIndex + 1]);
        if (amount === null) {
          issues.push(issue_(
            definition.sheetName,
            sheetRow,
            priceIndex + 2,
            "Ingresá el precio de " + EDITOR_V2_PRICE_LABELS[kind].toLocaleLowerCase("es-AR") + " sin puntos ni centavos.",
          ));
        } else {
          prices[kind] = amount;
        }
      });
    }

    items.push({
      id: id,
      category_code: definition.categoryId,
      name: name,
      description: description || null,
      order_index: orderIndex,
      prices: prices,
      visible: visible === true,
      sheetRow: sheetRow,
      sheetName: definition.sheetName,
      idColumn: idIndex + 1,
      nameColumn: 1,
      headers: headers,
    });
  });
  return items;
}

function parseEditorV2BusinessState_(values, issues) {
  var sheetName = APP_CONFIG.editorTabs.local;
  if (!values) {
    issues.push(issue_(sheetName, 1, 1, "Falta la pestaña Local."));
    return { status: "closed", message: "" };
  }
  validateHeaders_(values[0], EDITOR_V2_LOCAL_HEADERS, sheetName, issues);
  if (normalizeText_(values[1] && values[1][0]) !== "Estado") {
    issues.push(issue_(sheetName, 2, 1, "No cambies la etiqueta Estado."));
  }
  if (normalizeText_(values[2] && values[2][0]) !== "Mensaje para clientes (opcional)") {
    issues.push(issue_(sheetName, 3, 1, "No cambies la etiqueta del mensaje."));
  }
  var statusLabel = normalizeText_(values[1] && values[1][1]);
  var status = STATUS_BY_SHEET_LABEL[statusLabel];
  var message = normalizeText_(values[2] && values[2][1]);
  if (!status) issues.push(issue_(sheetName, 2, 2, "Elegí Abierto, Cerrado o Agotado."));
  if (message.length > EDITOR_V2_FIELD_LIMITS.message) {
    issues.push(issue_(sheetName, 3, 2, "El mensaje puede tener hasta 160 caracteres."));
  }
  return { status: status || "closed", message: message };
}

function validateEditorV2Uniqueness_(items, issues) {
  var seenIds = {};
  var seenNames = {};
  items.forEach(function (item) {
    if (item.id && seenIds[item.id]) {
      issues.push(issue_(item.sheetName, item.sheetRow, item.idColumn, "El identificador interno está duplicado."));
    } else if (item.id) {
      seenIds[item.id] = true;
    }
    if (!item.visible || !item.name) return;
    var nameKey = item.category_code + ":" + item.name.toLocaleLowerCase("es-AR");
    if (seenNames[nameKey]) {
      issues.push(issue_(item.sheetName, item.sheetRow, item.nameColumn, "Ya hay un producto visible con este nombre."));
    } else {
      seenNames[nameKey] = true;
    }
  });
}

function isEmptyEditorV2Row_(row, definition) {
  if (!row) return true;
  var showIndex = 1 + definition.priceKinds.length;
  var idIndex = editorV2Headers_(definition).length - 1;
  return row.every(function (value, index) {
    if (index === idIndex) return true;
    if (index === showIndex) return value !== true;
    return isBlank_(value);
  });
}

function readAndValidateEditorV2Draft_(spreadsheet) {
  ensureEditorV2ItemIds_(spreadsheet);
  var matrices = {};
  EDITOR_V2_CATEGORY_DEFINITIONS.forEach(function (definition) {
    matrices[definition.sheetName] = readSheetValues_(
      requiredSheet_(spreadsheet, definition.sheetName),
      editorV2Headers_(definition).length,
    );
  });
  var localValues = readSheetValues_(requiredSheet_(spreadsheet, APP_CONFIG.editorTabs.local), 2);
  return validateAndBuildEditorV2Draft_(matrices, localValues);
}

function ensureEditorV2ItemIds_(spreadsheet) {
  var seenIds = {};
  EDITOR_V2_CATEGORY_DEFINITIONS.forEach(function (definition) {
    var sheet = requiredSheet_(spreadsheet, definition.sheetName);
    var lastRow = Math.max(1, sheet.getLastRow());
    if (lastRow < 2) return;
    var headers = editorV2Headers_(definition);
    var idColumn = headers.length;
    var values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
    var normalized = normalizeEditorV2Ids_(values, definition, seenIds, function () {
      return Utilities.getUuid();
    });
    if (normalized.changed) {
      sheet.getRange(2, idColumn, normalized.ids.length, 1).setValues(normalized.ids);
    }
  });
}

function normalizeEditorV2Ids_(values, definition, seenIds, createId) {
  var idIndex = editorV2Headers_(definition).length - 1;
  var ids = values.map(function (row) { return [row[idIndex]]; });
  var changed = false;
  values.forEach(function (row, index) {
    if (isEmptyEditorV2Row_(row, definition)) {
      if (!isBlank_(row[idIndex])) {
        ids[index][0] = "";
        changed = true;
      }
      return;
    }
    var id = normalizeText_(row[idIndex]);
    if (!STABLE_ITEM_ID_PATTERN.test(id) || seenIds[id]) {
      id = createId();
      ids[index][0] = id;
      changed = true;
    }
    seenIds[id] = true;
  });
  return { ids: ids, changed: changed };
}

function readSheetValues_(sheet, columns) {
  var lastRow = Math.max(1, sheet.getLastRow());
  return sheet.getRange(1, 1, lastRow, columns).getValues();
}

function assertV2MatchesDraft_(spreadsheet, expectedDraft) {
  var actual = readAndValidateEditorV2Draft_(spreadsheet);
  if (!actual.ok) {
    throw new Error("El editor nuevo no superó la validación:\n" + formatIssues_(actual.issues));
  }
  if (!draftsAreCanonicallyEqual_(expectedDraft, actual.draft)) {
    throw new Error("La verificación final detectó una diferencia. Se conservaron las pestañas anteriores.");
  }
}

function draftsAreCanonicallyEqual_(left, right) {
  return JSON.stringify(buildCanonicalPayload_(left, 1))
    === JSON.stringify(buildCanonicalPayload_(right, 1));
}

function cloneRows_(rows) {
  return rows.map(function (row) { return row.slice(); });
}

function getPublicationSurface_(spreadsheet) {
  var v2Sheet = spreadsheet.getSheetByName(APP_CONFIG.editorTabs.publication);
  if (v2Sheet) return { sheet: v2Sheet, cells: EDITOR_V2_PUBLICATION_CELLS, schema: "v2" };
  var legacySheet = spreadsheet.getSheetByName(APP_CONFIG.tabs.publication);
  return legacySheet ? { sheet: legacySheet, cells: PUBLICATION_CELLS, schema: "legacy" } : null;
}

function isDraftEditSheetName_(sheetName) {
  return sheetName === APP_CONFIG.tabs.menu
    || sheetName === APP_CONFIG.tabs.state
    || sheetName === APP_CONFIG.editorTabs.local
    || Boolean(editorV2CategoryBySheetName_(sheetName));
}

function isDraftStructureChange_(changeType) {
  return [
    "INSERT_ROW",
    "REMOVE_ROW",
    "INSERT_COLUMN",
    "REMOVE_COLUMN",
    "INSERT_GRID",
    "REMOVE_GRID",
    "OTHER",
  ]
    .indexOf(changeType) !== -1;
}
