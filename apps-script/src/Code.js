/* eslint-disable no-undef -- Apps Script combines project files in one global scope. */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Il Figlio")
    .addItem("Preparar planilla", "setupProject")
    .addItem("Configurar Vercel", "configureProject")
    .addSeparator()
    .addItem("Validar borrador", "validateDraft")
    .addItem("Publicar cambios", "publishChanges")
    .addItem("Verificar publicación", "verifyPublishedRevision")
    .addToUi();
}

function doGet() {
  var contents = readServedSnapshotContents_()
    || JSON.stringify({ error: "snapshot_not_published" });

  return ContentService.createTextOutput(contents)
    .setMimeType(ContentService.MimeType.JSON);
}
