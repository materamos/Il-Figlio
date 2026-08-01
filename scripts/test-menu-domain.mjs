import assert from "node:assert/strict";
import test from "node:test";

import {
  MENU_CATEGORY_IDS,
  assertValidInitialMenuFixture,
  isStableMenuItemId,
  validateInitialMenuFixture,
  validateMenuContent,
} from "../src/domain/index.ts";
import {
  ilFiglioBusiness,
  initialMenuFixture,
  initialMenuItems,
} from "../src/data/index.ts";

test("the canonical fixture satisfies the complete menu contract", () => {
  assert.equal(assertValidInitialMenuFixture(initialMenuFixture), initialMenuFixture);
  assert.deepEqual(validateInitialMenuFixture(initialMenuFixture), []);
  assert.equal(initialMenuItems.length, 24);

  const counts = Object.fromEntries(
    MENU_CATEGORY_IDS.map((categoryId) => [
      categoryId,
      initialMenuItems.filter((item) => item.categoryId === categoryId).length,
    ]),
  );

  assert.deepEqual(counts, {
    classic: 12,
    filled: 4,
    gourmet: 4,
    empanadas: 2,
    extras: 2,
  });
});

test("production UUIDs and fixture slugs are both stable item identifiers", () => {
  assert.equal(isStableMenuItemId("clasica-mozzarella"), true);
  assert.equal(isStableMenuItemId("b3a76f4d-0d2c-4ba4-8eb8-f7b654599c36"), true);
  assert.equal(isStableMenuItemId("Not stable"), false);

  const databaseShaped = structuredClone(initialMenuFixture.content);
  databaseShaped.items[0].id = "b3a76f4d-0d2c-4ba4-8eb8-f7b654599c36";
  assert.deepEqual(validateMenuContent(databaseShaped), []);
});

test("confirmed contact and ordering facts remain stable", () => {
  assert.equal(ilFiglioBusiness.name, "Il Figlio");
  assert.equal(
    ilFiglioBusiness.address.display,
    "Diego Armando Maradona 1519, Lanús Oeste",
  );
  assert.equal(ilFiglioBusiness.contact.phoneDisplay, "11 4409-7322");
  assert.equal(ilFiglioBusiness.contact.whatsappE164, "5491144097322");
  assert.equal(ilFiglioBusiness.contact.instagramHandle, "ilfigliopizza");
  assert.equal(ilFiglioBusiness.description, "Pizza al molde, masas de larga fermentación.");
  assert.equal(ilFiglioBusiness.hours.display, "Viernes a domingo desde las 19:00");
  assert.match(ilFiglioBusiness.rules.halfAndHalf, /más cara/);
  assert.equal("status" in ilFiglioBusiness, false);
});

test("source prices and category-specific pricing shapes are preserved", () => {
  const byId = new Map(initialMenuItems.map((item) => [item.id, item]));

  assert.deepEqual(byId.get("clasica-mozzarella")?.prices, [
    { kind: "whole", amount: 14_000 },
    { kind: "slice", amount: 2_500 },
  ]);
  assert.deepEqual(byId.get("clasica-napolitana-especial")?.prices, [
    { kind: "whole", amount: 19_000 },
    { kind: "slice", amount: 4_000 },
  ]);
  assert.deepEqual(byId.get("rellena-fugazzetta-completa")?.prices, [
    { kind: "whole", amount: 30_000 },
  ]);
  assert.deepEqual(byId.get("gourmet-cbo")?.prices, [
    { kind: "whole", amount: 28_000 },
  ]);
  assert.deepEqual(byId.get("empanada-carne")?.prices, [
    { kind: "unit", amount: 2_800 },
  ]);
  assert.deepEqual(byId.get("empanada-jamon-y-queso")?.prices, [
    { kind: "unit", amount: 2_800 },
  ]);
  assert.deepEqual(byId.get("faina")?.prices, [
    { kind: "portion", amount: 1_200 },
  ]);
  assert.deepEqual(byId.get("faina-provolone")?.prices, [
    { kind: "portion", amount: 2_000 },
  ]);
});

test("the validator rejects malformed identifiers and pricing", () => {
  const malformed = structuredClone(initialMenuFixture.content);
  malformed.items[0].id = "Not kebab case";
  malformed.items[0].prices[0].amount = -1;
  malformed.items[1].prices = [{ kind: "whole", amount: 11_000 }];

  const issues = validateMenuContent(malformed);
  assert.ok(issues.some((issue) => issue.path.endsWith(".id")));
  assert.ok(issues.some((issue) => issue.path.endsWith(".amount")));
  assert.ok(
    issues.some(
      (issue) =>
        issue.path.endsWith(".prices") && issue.message.includes("whole, slice"),
    ),
  );
});

test("availability covers every product exactly once", () => {
  assert.equal(initialMenuFixture.availability.length, initialMenuItems.length);
  assert.equal(
    new Set(initialMenuFixture.availability.map((entry) => entry.itemId)).size,
    initialMenuItems.length,
  );
  assert.ok(
    initialMenuFixture.availability.every(
      (entry) => typeof entry.available === "boolean",
    ),
  );
});
