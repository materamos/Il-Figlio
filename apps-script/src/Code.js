/* eslint-disable no-undef -- Apps Script combines project files in one global scope. */

function onOpen() {
  try {
    var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    if (spreadsheet) ensureV2PublicationLayoutCurrent_(spreadsheet);
  } catch (error) {
    console.error("No se pudo actualizar el bloque de instrucciones: " + errorMessage_(error));
  }

  SpreadsheetApp.getUi()
    .createMenu("Il Figlio")
    .addItem("Publicar cambios", "publishChanges")
    .addSeparator()
    .addItem("Restaurar formato", "restoreEditorFormatting")
    .addToUi();
}

function doGet() {
  var contents = readServedSnapshotContents_()
    || JSON.stringify({ error: "snapshot_not_published" });

  return ContentService.createTextOutput(contents)
    .setMimeType(ContentService.MimeType.JSON);
}
