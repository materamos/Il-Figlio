import {
  MENU_CATEGORY_IDS,
  MENU_PRICE_KINDS,
  allowedPriceKindsByCategory,
  fixedMenuCategories,
} from "./menu-config.ts";
import type {
  InitialMenuFixture,
  MenuCategoryId,
  MenuContentSnapshot,
  MenuItem,
  MenuItemAvailability,
  MenuValidationIssue,
} from "../types/menu.ts";

const KEBAB_CASE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UUID_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const E164_NUMBER = /^[1-9]\d{7,14}$/;

const categoryIdSet = new Set<MenuCategoryId>(MENU_CATEGORY_IDS);
const priceKindSet = new Set(MENU_PRICE_KINDS);

export const isKebabCaseId = (value: string): boolean =>
  KEBAB_CASE_ID.test(value);

export const isStableMenuItemId = (value: string): boolean =>
  isKebabCaseId(value) || UUID_ID.test(value);

export const validateMenuContent = (
  content: MenuContentSnapshot,
): MenuValidationIssue[] => {
  const issues: MenuValidationIssue[] = [];

  if (!Number.isSafeInteger(content.revision) || content.revision < 1) {
    issues.push({
      path: "content.revision",
      message: "must be a positive safe integer",
    });
  }

  if (content.currency !== "ARS") {
    issues.push({ path: "content.currency", message: "must be ARS" });
  }

  validateCategories(content, issues);
  validateItems(content.items, issues);

  return issues;
};

export const validateMenuAvailability = (
  availability: readonly MenuItemAvailability[],
  items: readonly MenuItem[],
): MenuValidationIssue[] => {
  const issues: MenuValidationIssue[] = [];
  const itemIds = new Set(items.map((item) => item.id));
  const seenIds = new Set<string>();

  availability.forEach((entry, index) => {
    const path = `availability[${index}]`;

    if (seenIds.has(entry.itemId)) {
      issues.push({
        path: `${path}.itemId`,
        message: `duplicates availability for ${entry.itemId}`,
      });
    }
    seenIds.add(entry.itemId);

    if (!itemIds.has(entry.itemId)) {
      issues.push({
        path: `${path}.itemId`,
        message: `references unknown menu item ${entry.itemId}`,
      });
    }

    if (typeof entry.available !== "boolean") {
      issues.push({
        path: `${path}.available`,
        message: "must be a boolean",
      });
    }
  });

  for (const itemId of itemIds) {
    if (!seenIds.has(itemId)) {
      issues.push({
        path: "availability",
        message: `is missing menu item ${itemId}`,
      });
    }
  }

  return issues;
};

export const validateInitialMenuFixture = (
  fixture: InitialMenuFixture,
): MenuValidationIssue[] => {
  const issues = [
    ...validateMenuContent(fixture.content),
    ...validateMenuAvailability(fixture.availability, fixture.content.items),
  ];

  if (!fixture.business.name.trim()) {
    issues.push({ path: "business.name", message: "must not be empty" });
  }

  if (!fixture.business.address.display.trim()) {
    issues.push({
      path: "business.address.display",
      message: "must not be empty",
    });
  }

  if (!E164_NUMBER.test(fixture.business.contact.whatsappE164)) {
    issues.push({
      path: "business.contact.whatsappE164",
      message: "must contain an E.164 number without the plus sign",
    });
  }

  if (fixture.content.items.length !== 24) {
    issues.push({
      path: "content.items",
      message: `initial fixture must contain 24 products; received ${fixture.content.items.length}`,
    });
  }

  const expectedCounts: Readonly<Record<MenuCategoryId, number>> = {
    classic: 12,
    filled: 4,
    gourmet: 4,
    empanadas: 2,
    extras: 2,
  };

  for (const categoryId of MENU_CATEGORY_IDS) {
    const actualCount = fixture.content.items.filter(
      (item) => item.categoryId === categoryId,
    ).length;

    if (actualCount !== expectedCounts[categoryId]) {
      issues.push({
        path: "content.items",
        message: `${categoryId} must contain ${expectedCounts[categoryId]} products; received ${actualCount}`,
      });
    }
  }

  return issues;
};

export const assertValidMenuContent = <T extends MenuContentSnapshot>(
  content: T,
): T => {
  const issues = validateMenuContent(content);
  assertNoValidationIssues(issues);
  return content;
};

export const assertValidInitialMenuFixture = <T extends InitialMenuFixture>(
  fixture: T,
): T => {
  const issues = validateInitialMenuFixture(fixture);
  assertNoValidationIssues(issues);
  return fixture;
};

const assertNoValidationIssues = (issues: readonly MenuValidationIssue[]) => {
  if (issues.length === 0) return;

  throw new Error(
    `Invalid Il Figlio menu data:\n${issues
      .map((issue) => `- ${issue.path}: ${issue.message}`)
      .join("\n")}`,
  );
};

const validateCategories = (
  content: MenuContentSnapshot,
  issues: MenuValidationIssue[],
) => {
  const seenIds = new Set<string>();
  const seenOrderIndexes = new Set<number>();

  content.categories.forEach((category, index) => {
    const path = `content.categories[${index}]`;
    const expected = fixedMenuCategories[index];

    if (seenIds.has(category.id)) {
      issues.push({
        path: `${path}.id`,
        message: `duplicates category ${category.id}`,
      });
    }
    seenIds.add(category.id);

    if (seenOrderIndexes.has(category.orderIndex)) {
      issues.push({
        path: `${path}.orderIndex`,
        message: `duplicates order index ${category.orderIndex}`,
      });
    }
    seenOrderIndexes.add(category.orderIndex);

    if (!expected) {
      issues.push({ path, message: "is not a supported fixed category" });
      return;
    }

    if (
      category.id !== expected.id ||
      category.name !== expected.name ||
      category.orderIndex !== expected.orderIndex ||
      !sameValues(category.allowedPriceKinds, expected.allowedPriceKinds)
    ) {
      issues.push({
        path,
        message: `must match the fixed ${expected.id} category definition`,
      });
    }
  });

  if (content.categories.length !== fixedMenuCategories.length) {
    issues.push({
      path: "content.categories",
      message: `must contain exactly ${fixedMenuCategories.length} fixed categories`,
    });
  }
};

const validateItems = (
  items: readonly MenuItem[],
  issues: MenuValidationIssue[],
) => {
  const seenItemIds = new Set<string>();
  const seenOrderByCategory = new Set<string>();

  items.forEach((item, index) => {
    const path = `content.items[${index}]`;

    if (!isStableMenuItemId(item.id)) {
      issues.push({
        path: `${path}.id`,
        message: "must be a stable kebab-case or UUID identifier",
      });
    }

    if (seenItemIds.has(item.id)) {
      issues.push({ path: `${path}.id`, message: `duplicates ${item.id}` });
    }
    seenItemIds.add(item.id);

    if (!categoryIdSet.has(item.categoryId)) {
      issues.push({
        path: `${path}.categoryId`,
        message: `references unsupported category ${item.categoryId}`,
      });
      return;
    }

    validateText(item.name, `${path}.name`, issues);
    if (item.description !== undefined) {
      validateText(item.description, `${path}.description`, issues);
    }

    if (!Number.isSafeInteger(item.orderIndex) || item.orderIndex < 1) {
      issues.push({
        path: `${path}.orderIndex`,
        message: "must be a positive safe integer",
      });
    }

    const orderKey = `${item.categoryId}:${item.orderIndex}`;
    if (seenOrderByCategory.has(orderKey)) {
      issues.push({
        path: `${path}.orderIndex`,
        message: `duplicates order index ${item.orderIndex} in ${item.categoryId}`,
      });
    }
    seenOrderByCategory.add(orderKey);

    validatePrices(item, path, issues);
  });
};

const validatePrices = (
  item: MenuItem,
  itemPath: string,
  issues: MenuValidationIssue[],
) => {
  const allowedKinds = allowedPriceKindsByCategory[item.categoryId];
  const seenKinds = new Set<string>();

  item.prices.forEach((price, index) => {
    const path = `${itemPath}.prices[${index}]`;

    if (!priceKindSet.has(price.kind)) {
      issues.push({
        path: `${path}.kind`,
        message: `uses unsupported price kind ${price.kind}`,
      });
      return;
    }

    if (seenKinds.has(price.kind)) {
      issues.push({
        path: `${path}.kind`,
        message: `duplicates price kind ${price.kind}`,
      });
    }
    seenKinds.add(price.kind);

    if (!Number.isSafeInteger(price.amount) || price.amount <= 0) {
      issues.push({
        path: `${path}.amount`,
        message: "must be a positive integer amount in Argentine pesos",
      });
    }
  });

  if (!sameValues(item.prices.map((price) => price.kind), allowedKinds)) {
    issues.push({
      path: `${itemPath}.prices`,
      message: `${item.categoryId} requires exactly ${allowedKinds.join(", ")}`,
    });
  }
};

const validateText = (
  value: string,
  path: string,
  issues: MenuValidationIssue[],
) => {
  if (!value.trim()) {
    issues.push({ path, message: "must not be empty" });
  } else if (value !== value.trim()) {
    issues.push({ path, message: "must not have surrounding whitespace" });
  }
};

const sameValues = (
  actual: readonly string[],
  expected: readonly string[],
): boolean =>
  actual.length === expected.length &&
  actual.every((value, index) => value === expected[index]);
