/* eslint-disable no-unused-vars -- Apps Script combines project files in one global scope. */

function buildPublishedSnapshot_(draft, revision, publishedAt) {
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new Error("La revisión debe ser un entero positivo.");
  }

  var canonicalPayload = buildCanonicalPayload_(draft, revision);
  var canonicalJson = JSON.stringify(canonicalPayload);

  return {
    schema_version: 1,
    revision: revision,
    published_at: publishedAt,
    source_hash: sha256Hex_(canonicalJson),
    currency: canonicalPayload.currency,
    business: canonicalPayload.business,
    categories: canonicalPayload.categories,
  };
}

function buildCanonicalPayload_(draft, revision) {
  return {
    schema_version: 1,
    revision: revision,
    currency: "ARS",
    business: {
      status: draft.business.status,
      message: draft.business.message,
    },
    categories: draft.categories.map(function (category) {
      return {
        code: category.code,
        title: category.title,
        order_index: category.order_index,
        price_kinds: category.price_kinds.slice(),
        items: category.items.map(function (item) {
          return {
            id: item.id,
            category_code: item.category_code,
            name: item.name,
            description: item.description,
            order_index: item.order_index,
            prices: copyPricesInCanonicalOrder_(item.prices),
          };
        }),
      };
    }),
  };
}

function copyPricesInCanonicalOrder_(prices) {
  var result = {};
  ["whole", "slice", "unit", "portion"].forEach(function (kind) {
    if (Object.prototype.hasOwnProperty.call(prices, kind)) {
      result[kind] = prices[kind];
    }
  });
  return result;
}

function sha256Hex_(value) {
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    value,
    Utilities.Charset.UTF_8,
  );
  return bytesToHex_(bytes);
}

function bytesToHex_(bytes) {
  return bytes.map(function (byte) {
    return ((byte + 256) % 256).toString(16).padStart(2, "0");
  }).join("");
}

function matchesPublishedReceipt_(payload, expectedRevision, expectedHash) {
  return Boolean(
    payload
      && typeof payload === "object"
      && !Array.isArray(payload)
      && payload.schemaVersion === 1
      && payload.revision === expectedRevision
      && payload.sourceHash === expectedHash
      && typeof payload.builtAt === "string"
      && !Number.isNaN(Date.parse(payload.builtAt)),
  );
}
