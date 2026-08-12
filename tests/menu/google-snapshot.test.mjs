import assert from "node:assert/strict";
import test from "node:test";

import { initialMenuFixture } from "../../src/data/index.ts";
import {
  computeSnapshotSourceHash,
  fetchPublishedMenuSnapshot,
  parsePublishedMenuSnapshot,
} from "../../src/utils/menuContent.ts";

const buildCanonicalPayload = () => ({
  schema_version: 1,
  revision: initialMenuFixture.content.revision,
  currency: "ARS",
  business: {
    status: initialMenuFixture.businessStatus.status,
    message: initialMenuFixture.businessStatus.message,
  },
  categories: initialMenuFixture.content.categories.map((category) => ({
    code: category.id,
    title: category.name,
    order_index: category.orderIndex,
    price_kinds: [...category.allowedPriceKinds],
    items: initialMenuFixture.content.items
      .filter((item) => item.categoryId === category.id)
      .map((item) => ({
        id: item.id,
        category_code: item.categoryId,
        name: item.name,
        description: item.description ?? null,
        order_index: item.orderIndex,
        prices: Object.fromEntries(
          item.prices.map((price) => [price.kind, price.amount]),
        ),
      })),
  })),
});

const buildWireSnapshot = () => {
  const payload = buildCanonicalPayload();
  return {
    ...payload,
    published_at: "2026-08-11T12:00:00.000Z",
    source_hash: computeSnapshotSourceHash(payload),
  };
};

test("maps the canonical Google snapshot into the existing menu domain", () => {
  const wire = buildWireSnapshot();
  const snapshot = parsePublishedMenuSnapshot(wire);

  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.content.revision, 1);
  assert.equal(snapshot.content.currency, "ARS");
  assert.equal(snapshot.content.items.length, 24);
  assert.deepEqual(snapshot.businessStatus, { status: "closed", message: "" });
  assert.equal(snapshot.publishedAt, wire.published_at);
  assert.equal(snapshot.sourceHash, wire.source_hash);
});

test("rejects tampering, unsupported versions, and cross-category rows", () => {
  const tampered = buildWireSnapshot();
  tampered.categories[0].items[0].name = "Contenido alterado";
  assert.throws(
    () => parsePublishedMenuSnapshot(tampered),
    /source_hash does not match/,
  );

  const unsupported = buildWireSnapshot();
  unsupported.schema_version = 2;
  assert.throws(
    () => parsePublishedMenuSnapshot(unsupported),
    /Unsupported menu snapshot schema version/,
  );

  const misplaced = buildWireSnapshot();
  misplaced.categories[0].items[0].category_code = "gourmet";
  const misplacedPayload = {
    schema_version: misplaced.schema_version,
    revision: misplaced.revision,
    currency: misplaced.currency,
    business: misplaced.business,
    categories: misplaced.categories,
  };
  misplaced.source_hash = computeSnapshotSourceHash(misplacedPayload);
  assert.throws(
    () => parsePublishedMenuSnapshot(misplaced),
    /must match its parent category/,
  );
});

test("rejects invalid publication metadata and business status", () => {
  const invalidDate = buildWireSnapshot();
  invalidDate.published_at = "not-a-date";
  assert.throws(() => parsePublishedMenuSnapshot(invalidDate), /ISO-8601/);

  const invalidBusiness = buildWireSnapshot();
  invalidBusiness.business.status = "paused";
  const invalidPayload = {
    schema_version: invalidBusiness.schema_version,
    revision: invalidBusiness.revision,
    currency: invalidBusiness.currency,
    business: invalidBusiness.business,
    categories: invalidBusiness.categories,
  };
  invalidBusiness.source_hash = computeSnapshotSourceHash(invalidPayload);
  assert.throws(
    () => parsePublishedMenuSnapshot(invalidBusiness),
    /businessStatus.status/,
  );
});

test("fetches JSON with a cache buster and validates the response", async () => {
  const wire = buildWireSnapshot();
  const requests = [];
  const result = await fetchPublishedMenuSnapshot(
    "https://script.google.com/macros/s/example/exec",
    {
      fetchImpl: async (url, init) => {
        requests.push({ url, init });
        return new Response(JSON.stringify(wire), {
          status: 200,
          headers: { "Content-Type": "application/json; charset=utf-8" },
        });
      },
    },
  );

  assert.equal(result.content.items.length, 24);
  assert.equal(requests.length, 1);
  assert.match(requests[0].url.toString(), /[?&]_build=\d+/);
  assert.equal(requests[0].init.cache, "no-store");
  assert.equal(requests[0].init.redirect, "follow");
});

test("fails on HTTP errors, non-JSON responses, oversized bodies, and timeouts", async () => {
  await assert.rejects(
    () => fetchPublishedMenuSnapshot("https://example.test/menu", {
      fetchImpl: async () => new Response("unavailable", { status: 503 }),
    }),
    /HTTP 503/,
  );

  await assert.rejects(
    () => fetchPublishedMenuSnapshot("https://example.test/menu", {
      fetchImpl: async () => new Response("{}", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      }),
    }),
    /application\/json/,
  );

  await assert.rejects(
    () => fetchPublishedMenuSnapshot("https://example.test/menu", {
      maxBytes: 10,
      fetchImpl: async () => new Response("01234567890", {
        status: 200,
        headers: {
          "Content-Length": "11",
          "Content-Type": "application/json",
        },
      }),
    }),
    /10-byte limit/,
  );

  await assert.rejects(
    () => fetchPublishedMenuSnapshot("https://example.test/menu", {
      timeoutMs: 5,
      fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      }),
    }),
    /timed out after 5ms/,
  );
});
