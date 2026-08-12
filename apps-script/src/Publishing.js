/* eslint-disable no-unused-vars, no-undef -- Apps Script combines project files in one global scope. */

function handlePublishEdit(event) {
  if (!event || !event.range) return;

  if (isPublishEdit_(event)) {
    event.range.getSheet().getRange(PUBLICATION_CELLS.publish).setValue(false);
    try {
      publishChanges();
    } catch (error) {
      setDashboardState_("Error de publicación", errorMessage_(error));
      renderPublicationDashboard_();
      throw error;
    }
    return;
  }

  var sheetName = event.range.getSheet().getName();
  if (sheetName === APP_CONFIG.tabs.menu || sheetName === APP_CONFIG.tabs.state) {
    return withScriptLock_(function () {
      markDraftDirty_();
    });
  }
}

function publishChanges() {
  return withScriptLock_(function () {
    var properties = PropertiesService.getScriptProperties();
    var pendingRevision = parseStoredPositiveInteger_(
      properties.getProperty(SCRIPT_PROPERTY_KEYS.pendingRevision),
    );

    if (pendingRevision !== null) {
      var pendingHash = properties.getProperty(SCRIPT_PROPERTY_KEYS.pendingHash);
      var availableSnapshot = readSnapshotContents_() || readLegacySnapshotContents_();
      if (!snapshotMatches_(availableSnapshot, pendingRevision, pendingHash)) {
        var recovery = recoverPendingSnapshot_(properties, pendingRevision, pendingHash);
        if (!recovery.ok) return recovery;
      } else if (!readSnapshotContents_()) {
        writeSnapshotChunks_(properties, availableSnapshot);
      }
      setDashboardState_(
        "Reintentando revisión " + pendingRevision,
        "La revisión pendiente se enviará otra vez; los cambios posteriores siguen como borrador.",
      );
      renderPublicationDashboard_();
      return requestDeployment_(pendingRevision, pendingHash);
    }

    setDashboardState_("Validando", "Revisando la carta completa antes de publicar.");
    renderPublicationDashboard_();

    var validation = readAndValidateDraft_();
    highlightValidationIssues_(validation.issues);
    if (!validation.ok) {
      setDashboardState_("Error de validación", formatIssues_(validation.issues));
      renderPublicationDashboard_();
      return { ok: false, reason: "validation", issues: validation.issues };
    }

    var publishedRevision = parseStoredNonNegativeInteger_(
      properties.getProperty(SCRIPT_PROPERTY_KEYS.publishedRevision),
    );
    var nextRevision = publishedRevision + 1;
    var requestedAt = new Date().toISOString();
    var snapshot = buildPublishedSnapshot_(validation.draft, nextRevision, requestedAt);
    writeSnapshotFile_(JSON.stringify(snapshot));

    properties.setProperties({
      PENDING_REVISION: String(nextRevision),
      PENDING_HASH: snapshot.source_hash,
      PENDING_REQUESTED_AT: requestedAt,
      DRAFT_DIRTY: "false",
    });
    setDashboardState_(
      "Despliegue solicitado",
      "Esperando que Vercel sirva la revisión " + nextRevision + ".",
    );
    renderPublicationDashboard_();
    return requestDeployment_(nextRevision, snapshot.source_hash);
  });
}

function verifyPublishedRevision() {
  return withScriptLock_(function () {
    var properties = PropertiesService.getScriptProperties();
    var pendingRevision = parseStoredPositiveInteger_(
      properties.getProperty(SCRIPT_PROPERTY_KEYS.pendingRevision),
    );
    var pendingHash = properties.getProperty(SCRIPT_PROPERTY_KEYS.pendingHash);
    if (pendingRevision === null || !pendingHash) {
      renderPublicationDashboard_();
      return { ok: true, state: "idle" };
    }

    var siteUrl = properties.getProperty(SCRIPT_PROPERTY_KEYS.publicSiteUrl);
    if (!siteUrl) {
      setDashboardState_("Configuración incompleta", "Falta PUBLIC_SITE_URL en Script Properties.");
      renderPublicationDashboard_();
      return { ok: false, state: "configuration" };
    }

    var receiptUrl = siteUrl.replace(/\/$/, "")
      + "/publication.json?expected=" + encodeURIComponent(pendingHash)
      + "&checked=" + Date.now();
    var response;
    try {
      response = UrlFetchApp.fetch(receiptUrl, {
        method: "get",
        followRedirects: true,
        muteHttpExceptions: true,
        headers: { "Cache-Control": "no-cache" },
      });
    } catch (error) {
      return keepPublicationPending_(properties, pendingRevision, errorMessage_(error));
    }

    if (response.getResponseCode() >= 200 && response.getResponseCode() < 300) {
      var payload = parseJsonOrNull_(response.getContentText());
      if (matchesPublishedReceipt_(payload, pendingRevision, pendingHash)) {
        properties.setProperties({
          PUBLISHED_REVISION: String(pendingRevision),
          PUBLISHED_HASH: pendingHash,
          PUBLISHED_AT: payload.builtAt,
        });
        properties.deleteProperty(SCRIPT_PROPERTY_KEYS.pendingRevision);
        properties.deleteProperty(SCRIPT_PROPERTY_KEYS.pendingHash);
        properties.deleteProperty(SCRIPT_PROPERTY_KEYS.pendingRequestedAt);
        var dashboard = buildPublishedDashboardState_(
          pendingRevision,
          properties.getProperty(SCRIPT_PROPERTY_KEYS.draftDirty) === "true",
        );
        setDashboardState_(dashboard.status, dashboard.detail);
        renderPublicationDashboard_();
        return { ok: true, state: "published", revision: pendingRevision };
      }
    }

    return keepPublicationPending_(
      properties,
      pendingRevision,
      "El sitio todavía no sirve la revisión y el hash esperados.",
    );
  });
}

function buildPublishedDashboardState_(revision, draftDirty) {
  if (draftDirty) {
    return {
      status: "Cambios sin publicar",
      detail: "La revisión " + revision
        + " está publicada, pero hay cambios posteriores que siguen en borrador.",
    };
  }

  return {
    status: "Publicado — revisión " + revision,
    detail: "La revisión y el hash coinciden con el sitio público.",
  };
}

function requestDeployment_(revision, sourceHash) {
  var properties = PropertiesService.getScriptProperties();
  var hookUrl = properties.getProperty(SCRIPT_PROPERTY_KEYS.deployHookUrl);
  if (!hookUrl) {
    setDashboardState_(
      "Configuración incompleta",
      "Falta VERCEL_DEPLOY_HOOK_URL. La revisión " + revision + " quedó preparada para reintentar.",
    );
    renderPublicationDashboard_();
    return { ok: false, reason: "configuration", revision: revision };
  }

  var requestedAt = new Date().toISOString();
  properties.setProperty(SCRIPT_PROPERTY_KEYS.pendingRequestedAt, requestedAt);
  var response;
  try {
    response = UrlFetchApp.fetch(hookUrl, {
      method: "post",
      followRedirects: true,
      muteHttpExceptions: true,
      headers: { "User-Agent": "il-figlio-sheets-publisher/1" },
    });
  } catch (error) {
    setDashboardState_(
      "Error al solicitar despliegue",
      "La revisión " + revision + " quedó preparada. Volvé a marcar Publicar para reintentar. "
        + errorMessage_(error),
    );
    renderPublicationDashboard_();
    return { ok: false, reason: "request", revision: revision };
  }

  var statusCode = response.getResponseCode();
  if (statusCode < 200 || statusCode >= 300) {
    setDashboardState_(
      "Error al solicitar despliegue",
      "Vercel respondió HTTP " + statusCode + ". La revisión " + revision
        + " quedó preparada para reintentar.",
    );
    renderPublicationDashboard_();
    return { ok: false, reason: "hook", statusCode: statusCode, revision: revision };
  }

  setDashboardState_(
    "Despliegue solicitado",
    "Vercel aceptó la revisión " + revision + ". La confirmación se actualizará automáticamente.",
  );
  renderPublicationDashboard_();
  return { ok: true, revision: revision, sourceHash: sourceHash };
}

function keepPublicationPending_(properties, revision, reason) {
  var requestedAt = properties.getProperty(SCRIPT_PROPERTY_KEYS.pendingRequestedAt);
  var elapsed = requestedAt ? Date.now() - Date.parse(requestedAt) : 0;
  var timedOut = Number.isFinite(elapsed) && elapsed >= APP_CONFIG.publicationTimeoutMs;

  if (timedOut) {
    setDashboardState_(
      "Revisión " + revision + " sin confirmar",
      reason + " Marcá Publicar para reintentar el mismo snapshot.",
    );
  } else {
    setDashboardState_(
      "Esperando revisión " + revision,
      reason + " La verificación se repetirá automáticamente.",
    );
  }
  renderPublicationDashboard_();
  return { ok: false, state: timedOut ? "unconfirmed" : "pending", revision: revision };
}

function writeSnapshotFile_(contents) {
  if (!contents) throw new Error("El snapshot publicado no puede estar vacío.");

  var properties = PropertiesService.getScriptProperties();
  var fileId = properties.getProperty(SCRIPT_PROPERTY_KEYS.snapshotFileId);
  if (fileId) {
    DriveApp.getFileById(fileId).setContent(contents);
  } else {
    var file = DriveApp.createFile(
      APP_CONFIG.snapshotFileName,
      contents,
      MimeType.PLAIN_TEXT,
    );
    fileId = file.getId();
    properties.setProperty(SCRIPT_PROPERTY_KEYS.snapshotFileId, fileId);
  }

  writeSnapshotChunks_(properties, contents);
  return fileId;
}

function recoverPendingSnapshot_(properties, revision, expectedHash) {
  var backupContents = readSnapshotBackup_(properties);
  if (snapshotMatches_(backupContents, revision, expectedHash)) {
    writeSnapshotChunks_(properties, backupContents);
    return { ok: true, revision: revision, source: "drive" };
  }

  var validation = readAndValidateDraft_();
  highlightValidationIssues_(validation.issues);
  if (!validation.ok) {
    setDashboardState_(
      "No se pudo recuperar la revisión " + revision,
      "El snapshot no está disponible y el borrador actual tiene errores de validación.",
    );
    renderPublicationDashboard_();
    return { ok: false, reason: "pending_snapshot_validation", issues: validation.issues };
  }

  var publishedAt = properties.getProperty(SCRIPT_PROPERTY_KEYS.pendingRequestedAt)
    || new Date().toISOString();
  var snapshot = buildPublishedSnapshot_(validation.draft, revision, publishedAt);
  if (snapshot.source_hash !== expectedHash) {
    setDashboardState_(
      "No se pudo recuperar la revisión " + revision,
      "El borrador cambió después de preparar esa revisión. Corregí los cambios antes de reintentar.",
    );
    renderPublicationDashboard_();
    return { ok: false, reason: "pending_snapshot_mismatch", revision: revision };
  }

  writeSnapshotFile_(JSON.stringify(snapshot));
  return { ok: true, revision: revision };
}

function snapshotMatches_(contents, revision, sourceHash) {
  var snapshot = contents ? parseJsonOrNull_(contents) : null;
  if (!(
    snapshot
      && snapshot.schema_version === 1
      && snapshot.revision === revision
      && snapshot.currency === "ARS"
      && typeof snapshot.published_at === "string"
      && !Number.isNaN(Date.parse(snapshot.published_at))
      && snapshot.source_hash === sourceHash
  )) return false;

  try {
    var canonical = buildCanonicalPayload_({
      business: snapshot.business,
      categories: snapshot.categories,
    }, snapshot.revision);
    return sha256Hex_(JSON.stringify(canonical)) === sourceHash;
  } catch (_error) {
    return false;
  }
}

function writeSnapshotChunks_(properties, contents) {
  var chunks = encodeSnapshotChunks_(contents);
  var activeSlot = properties.getProperty(SCRIPT_PROPERTY_KEYS.snapshotActiveSlot);
  var targetSlot = activeSlot === "A" ? "B" : "A";
  var prefix = snapshotSlotPrefix_(targetSlot);
  var previousMeta = parseSnapshotMeta_(properties.getProperty(prefix + "META"));
  var values = {};
  values[prefix + "META"] = JSON.stringify({
    v: 1,
    count: chunks.length,
    encodedLength: chunks.join("").length,
    contentHash: sha256Hex_(contents),
  });
  chunks.forEach(function (chunk, index) {
    values[prefix + "CHUNK_" + index] = chunk;
  });
  properties.setProperties(values);

  if (readSnapshotSlot_(properties, targetSlot) !== contents) {
    throw new Error("No se pudo verificar la copia privada del snapshot.");
  }

  var previousCount = previousMeta ? previousMeta.count : 0;
  try {
    for (var index = chunks.length; index < previousCount; index += 1) {
      properties.deleteProperty(prefix + "CHUNK_" + index);
    }
    if (SNAPSHOT_SLOTS.indexOf(activeSlot) !== -1) {
      deleteLegacySnapshotChunks_(properties);
    }
  } catch (_error) {
    // Stale chunks are not referenced by the verified metadata.
  }

  properties.setProperty(SCRIPT_PROPERTY_KEYS.snapshotActiveSlot, targetSlot);
}

function readSnapshotContents_() {
  var values = PropertiesService.getScriptProperties().getProperties();
  return readSnapshotContentsFromProperties_(values);
}

function readLegacySnapshotContents_() {
  var values = PropertiesService.getScriptProperties().getProperties();
  return readLegacySnapshotContentsFromProperties_(values);
}

function readServedSnapshotContents_() {
  var values = PropertiesService.getScriptProperties().getProperties();
  return readSnapshotContentsFromProperties_(values)
    || readLegacySnapshotContentsFromProperties_(values);
}

function readSnapshotContentsFromProperties_(properties) {
  var activeSlot = getSnapshotProperty_(
    properties,
    SCRIPT_PROPERTY_KEYS.snapshotActiveSlot,
  );
  if (SNAPSHOT_SLOTS.indexOf(activeSlot) === -1) return null;
  return readSnapshotSlot_(properties, activeSlot);
}

function readLegacySnapshotContentsFromProperties_(properties) {
  var count = parseStoredPositiveInteger_(
    getSnapshotProperty_(properties, "SNAPSHOT_CHUNK_COUNT"),
  );
  var maxChunks = Math.ceil(
    APP_CONFIG.snapshotMaxEncodedChars / APP_CONFIG.snapshotChunkSize,
  );
  if (count === null || count > maxChunks) return null;

  var chunks = [];
  for (var index = 0; index < count; index += 1) {
    var chunk = getSnapshotProperty_(properties, "SNAPSHOT_CHUNK_" + index);
    if (!chunk) return null;
    chunks.push(chunk);
  }

  var contents = decodeSnapshotChunks_(chunks);
  var snapshot = contents ? parseJsonOrNull_(contents) : null;
  return snapshot
    && snapshotMatches_(contents, snapshot.revision, snapshot.source_hash)
    ? contents
    : null;
}

function readSnapshotSlot_(properties, slot) {
  var prefix = snapshotSlotPrefix_(slot);
  var meta = parseSnapshotMeta_(getSnapshotProperty_(properties, prefix + "META"));
  var maxChunks = Math.ceil(
    APP_CONFIG.snapshotMaxEncodedChars / APP_CONFIG.snapshotChunkSize,
  );
  if (
    !meta
      || meta.count > maxChunks
      || meta.encodedLength > APP_CONFIG.snapshotMaxEncodedChars
  ) return null;

  var chunks = [];
  for (var index = 0; index < meta.count; index += 1) {
    var chunk = getSnapshotProperty_(properties, prefix + "CHUNK_" + index);
    if (!chunk || chunk.length > APP_CONFIG.snapshotChunkSize) return null;
    chunks.push(chunk);
  }
  var encoded = chunks.join("");
  if (encoded.length !== meta.encodedLength) return null;
  var contents = decodeSnapshotChunks_(chunks);
  return contents && sha256Hex_(contents) === meta.contentHash ? contents : null;
}

function getSnapshotProperty_(properties, key) {
  if (properties && typeof properties.getProperty === "function") {
    return properties.getProperty(key);
  }
  return properties && Object.prototype.hasOwnProperty.call(properties, key)
    ? properties[key]
    : null;
}

function parseSnapshotMeta_(value) {
  var meta = value ? parseJsonOrNull_(value) : null;
  return meta
    && meta.v === 1
    && Number.isSafeInteger(meta.count)
    && meta.count > 0
    && Number.isSafeInteger(meta.encodedLength)
    && meta.encodedLength > 0
    && typeof meta.contentHash === "string"
    && /^[0-9a-f]{64}$/.test(meta.contentHash)
    ? meta
    : null;
}

function snapshotSlotPrefix_(slot) {
  if (SNAPSHOT_SLOTS.indexOf(slot) === -1) {
    throw new Error("Slot de snapshot inválido.");
  }
  return "SNAPSHOT_" + slot + "_";
}

function readSnapshotBackup_(properties) {
  var fileId = properties.getProperty(SCRIPT_PROPERTY_KEYS.snapshotFileId);
  if (!fileId) return null;
  try {
    return DriveApp.getFileById(fileId).getBlob().getDataAsString("UTF-8") || null;
  } catch (_error) {
    return null;
  }
}

function deleteLegacySnapshotChunks_(properties) {
  var count = parseStoredPositiveInteger_(properties.getProperty("SNAPSHOT_CHUNK_COUNT"));
  var maxChunks = Math.ceil(
    APP_CONFIG.snapshotMaxEncodedChars / APP_CONFIG.snapshotChunkSize,
  );
  if (count !== null && count <= maxChunks) {
    for (var index = 0; index < count; index += 1) {
      properties.deleteProperty("SNAPSHOT_CHUNK_" + index);
    }
  }
  properties.deleteProperty("SNAPSHOT_CHUNK_COUNT");
}

function encodeSnapshotChunks_(contents) {
  var encoded = Utilities.base64Encode(contents, Utilities.Charset.UTF_8);
  if (encoded.length > APP_CONFIG.snapshotMaxEncodedChars) {
    throw new Error("El snapshot supera el límite de almacenamiento del publicador.");
  }

  var chunks = [];
  for (var offset = 0; offset < encoded.length; offset += APP_CONFIG.snapshotChunkSize) {
    chunks.push(encoded.slice(offset, offset + APP_CONFIG.snapshotChunkSize));
  }
  return chunks;
}

function decodeSnapshotChunks_(chunks) {
  try {
    var encoded = chunks.join("");
    return Utilities.newBlob(Utilities.base64Decode(encoded))
      .getDataAsString("UTF-8");
  } catch (_error) {
    return null;
  }
}

function isPublishEdit_(event) {
  var range = event && event.range;
  if (!range || range.getSheet().getName() !== APP_CONFIG.tabs.publication) return false;

  var targetRow = 2;
  var targetColumn = 2;
  var coversTarget = range.getRow() <= targetRow
    && range.getLastRow() >= targetRow
    && range.getColumn() <= targetColumn
    && range.getLastColumn() >= targetColumn;
  return coversTarget
    && range.getSheet().getRange(PUBLICATION_CELLS.publish).getValue() === true;
}

function parseStoredPositiveInteger_(value) {
  var parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseStoredNonNegativeInteger_(value) {
  var parsed = Number(value || 0);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function parseJsonOrNull_(value) {
  try {
    return JSON.parse(value);
  } catch (_error) {
    return null;
  }
}

function errorMessage_(error) {
  return error && typeof error.message === "string" ? error.message : String(error);
}
