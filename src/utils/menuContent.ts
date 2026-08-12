import { createHash } from "node:crypto";

import { initialMenuFixture } from "../data/index.ts";
import {
  MENU_CATEGORY_IDS,
  MENU_PRICE_KINDS,
} from "../domain/menu-config.ts";
import {
  assertValidMenuContent,
  validateBusinessStatus,
} from "../domain/menu-validation.ts";
import type {
  BusinessStatus,
  BusinessStatusSnapshot,
  MenuCategoryDefinition,
  MenuCategoryId,
  MenuContentSnapshot,
  MenuItem,
  MenuPrice,
  MenuPriceKind,
  PublishedMenuSnapshot,
} from "../types/menu.ts";

const SNAPSHOT_SCHEMA_VERSION = 1;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BYTES = 512 * 1024;
const FIXTURE_PUBLISHED_AT = "2026-08-01T00:00:00.000Z";
const SHA_256_HEX = /^[0-9a-f]{64}$/;

type DatabasePriceMap = Partial<Record<MenuPriceKind, number>>;

interface DatabaseItem {
  id: string;
  category_code: string;
  name: string;
  description: string | null;
  order_index: number;
  prices: DatabasePriceMap;
}

interface DatabaseCategory {
  code: string;
  title: string;
  order_index: number;
  price_kinds: string[];
  items: DatabaseItem[];
}

interface CanonicalSnapshotPayload {
  schema_version: 1;
  revision: number;
  currency: "ARS";
  business: {
    status: BusinessStatus;
    message: string;
  };
  categories: DatabaseCategory[];
}

interface FetchSnapshotOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
}

let configuredSnapshotPromise: Promise<PublishedMenuSnapshot> | undefined;

/**
 * Loads one immutable snapshot for the complete Astro build. All generated
 * routes share this promise so a build cannot mix menu revisions.
 */
export const loadPublishedMenu = (): Promise<PublishedMenuSnapshot> => {
  configuredSnapshotPromise ??= loadConfiguredSnapshot();
  return configuredSnapshotPromise;
};

export const fetchPublishedMenuSnapshot = async (
  snapshotUrl: string,
  options: FetchSnapshotOptions = {},
): Promise<PublishedMenuSnapshot> => {
  const url = parseSnapshotUrl(snapshotUrl);
  url.searchParams.set("_build", String(Date.now()));

  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      redirect: "follow",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Menu snapshot request returned HTTP ${response.status}.`);
    }

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("application/json")) {
      throw new Error("Menu snapshot response must use application/json.");
    }

    const body = await readLimitedResponseBody(response, maxBytes);
    let rawSnapshot: unknown;
    try {
      rawSnapshot = JSON.parse(body);
    } catch (error) {
      throw new Error("Menu snapshot response is not valid JSON.", { cause: error });
    }

    return parsePublishedMenuSnapshot(rawSnapshot);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Menu snapshot request timed out after ${timeoutMs}ms.`, {
        cause: error,
      });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

export const parsePublishedMenuSnapshot = (
  rawSnapshot: unknown,
): PublishedMenuSnapshot => {
  const snapshot = requireRecord(rawSnapshot, "snapshot");
  const schemaVersion = requireSafeInteger(snapshot.schema_version, "snapshot.schema_version");
  if (schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
    throw new Error(`Unsupported menu snapshot schema version: ${schemaVersion}`);
  }

  const revision = requireSafeInteger(snapshot.revision, "snapshot.revision");
  if (revision < 1) {
    throw new Error("snapshot.revision must be a positive safe integer.");
  }
  if (snapshot.currency !== "ARS") {
    throw new Error("snapshot.currency must be ARS.");
  }

  const publishedAt = requireString(snapshot.published_at, "snapshot.published_at");
  if (!isIsoDateTime(publishedAt)) {
    throw new Error("snapshot.published_at must be an ISO-8601 timestamp.");
  }

  const business = parseBusinessStatus(snapshot.business);
  const categories = requireArray(snapshot.categories, "snapshot.categories")
    .map((category, index) => parseCategory(category, index));
  const canonicalPayload: CanonicalSnapshotPayload = {
    schema_version: 1,
    revision,
    currency: "ARS",
    business: {
      status: business.status,
      message: business.message,
    },
    categories,
  };

  const sourceHash = requireString(snapshot.source_hash, "snapshot.source_hash");
  if (!SHA_256_HEX.test(sourceHash)) {
    throw new Error("snapshot.source_hash must be a lowercase SHA-256 hex digest.");
  }
  const computedHash = computeSnapshotSourceHash(canonicalPayload);
  if (sourceHash !== computedHash) {
    throw new Error("Menu snapshot source_hash does not match its canonical payload.");
  }

  const content = mapSnapshotContent(canonicalPayload);
  const businessIssues = validateBusinessStatus(business);
  if (businessIssues.length > 0) {
    throw new Error(
      `Invalid Il Figlio business status:\n${businessIssues
        .map((issue) => `- ${issue.path}: ${issue.message}`)
        .join("\n")}`,
    );
  }

  return {
    schemaVersion: 1,
    content,
    businessStatus: business,
    publishedAt,
    sourceHash,
  };
};

export const computeSnapshotSourceHash = (payload: unknown): string =>
  createHash("sha256").update(JSON.stringify(payload), "utf8").digest("hex");

const loadConfiguredSnapshot = async (): Promise<PublishedMenuSnapshot> => {
  const source = (import.meta.env.MENU_DATA_SOURCE ?? "fixture").trim().toLowerCase();

  if (source === "fixture") {
    return createFixturePublishedSnapshot();
  }
  if (source !== "google_snapshot") {
    throw new Error(`Unsupported MENU_DATA_SOURCE: ${source}`);
  }

  const snapshotUrl = import.meta.env.MENU_SNAPSHOT_URL?.trim();
  if (!snapshotUrl) {
    throw new Error(
      "MENU_SNAPSHOT_URL is required when MENU_DATA_SOURCE=google_snapshot.",
    );
  }

  return fetchPublishedMenuSnapshot(snapshotUrl);
};

const createFixturePublishedSnapshot = (): PublishedMenuSnapshot => {
  const { businessStatus, content } = initialMenuFixture;
  const canonicalPayload = contentToCanonicalPayload(content, businessStatus);

  return parsePublishedMenuSnapshot({
    ...canonicalPayload,
    published_at: FIXTURE_PUBLISHED_AT,
    source_hash: computeSnapshotSourceHash(canonicalPayload),
  });
};

const contentToCanonicalPayload = (
  content: MenuContentSnapshot,
  businessStatus: BusinessStatusSnapshot,
): CanonicalSnapshotPayload => ({
  schema_version: 1,
  revision: content.revision,
  currency: "ARS",
  business: {
    status: businessStatus.status,
    message: businessStatus.message,
  },
  categories: content.categories.map((category) => ({
    code: category.id,
    title: category.name,
    order_index: category.orderIndex,
    price_kinds: [...category.allowedPriceKinds],
    items: content.items
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

const mapSnapshotContent = (
  snapshot: CanonicalSnapshotPayload,
): MenuContentSnapshot => {
  const categories: MenuCategoryDefinition[] = snapshot.categories.map((category) => ({
    id: assertCategoryId(category.code),
    name: category.title,
    orderIndex: category.order_index,
    allowedPriceKinds: category.price_kinds.map(assertPriceKind),
  }));

  const items: MenuItem[] = snapshot.categories.flatMap((category) =>
    category.items.map((item) => ({
      id: item.id,
      categoryId: assertCategoryId(item.category_code),
      name: item.name,
      description: item.description ?? undefined,
      orderIndex: item.order_index,
      prices: mapPrices(item.prices),
    })),
  );

  return assertValidMenuContent({
    revision: snapshot.revision,
    currency: "ARS",
    categories,
    items,
  });
};

const parseBusinessStatus = (value: unknown): BusinessStatusSnapshot => {
  const business = requireRecord(value, "snapshot.business");
  return {
    status: requireString(business.status, "snapshot.business.status") as BusinessStatus,
    message: requireString(business.message, "snapshot.business.message", true),
  };
};

const parseCategory = (value: unknown, index: number): DatabaseCategory => {
  const path = `snapshot.categories[${index}]`;
  const category = requireRecord(value, path);
  const code = requireString(category.code, `${path}.code`);
  const items = requireArray(category.items, `${path}.items`)
    .map((item, itemIndex) => parseItem(item, code, `${path}.items[${itemIndex}]`));

  return {
    code,
    title: requireString(category.title, `${path}.title`),
    order_index: requireSafeInteger(category.order_index, `${path}.order_index`),
    price_kinds: requireArray(category.price_kinds, `${path}.price_kinds`)
      .map((kind, kindIndex) => requireString(kind, `${path}.price_kinds[${kindIndex}]`)),
    items,
  };
};

const parseItem = (
  value: unknown,
  parentCategoryCode: string,
  path: string,
): DatabaseItem => {
  const item = requireRecord(value, path);
  const categoryCode = requireString(item.category_code, `${path}.category_code`);
  if (categoryCode !== parentCategoryCode) {
    throw new Error(`${path}.category_code must match its parent category.`);
  }

  const description = item.description;
  if (description !== null && typeof description !== "string") {
    throw new Error(`${path}.description must be a string or null.`);
  }

  return {
    id: requireString(item.id, `${path}.id`),
    category_code: categoryCode,
    name: requireString(item.name, `${path}.name`),
    description,
    order_index: requireSafeInteger(item.order_index, `${path}.order_index`),
    prices: parsePriceMap(item.prices, `${path}.prices`),
  };
};

const parsePriceMap = (value: unknown, path: string): DatabasePriceMap => {
  const record = requireRecord(value, path);
  const prices: DatabasePriceMap = {};

  for (const kind of Object.keys(record)) {
    if (!(MENU_PRICE_KINDS as readonly string[]).includes(kind)) {
      throw new Error(`${path} contains unsupported price kind ${kind}.`);
    }
  }

  for (const kind of MENU_PRICE_KINDS) {
    if (Object.prototype.hasOwnProperty.call(record, kind)) {
      prices[kind] = requireSafeInteger(record[kind], `${path}.${kind}`);
    }
  }

  return prices;
};

const mapPrices = (priceMap: DatabasePriceMap): MenuPrice[] =>
  MENU_PRICE_KINDS.flatMap((kind) => {
    const amount = priceMap[kind];
    return typeof amount === "number" ? [{ kind, amount }] : [];
  });

const assertCategoryId = (value: string): MenuCategoryId => {
  if ((MENU_CATEGORY_IDS as readonly string[]).includes(value)) {
    return value as MenuCategoryId;
  }
  throw new Error(`Unsupported menu category: ${value}`);
};

const assertPriceKind = (value: string): MenuPriceKind => {
  if ((MENU_PRICE_KINDS as readonly string[]).includes(value)) {
    return value as MenuPriceKind;
  }
  throw new Error(`Unsupported menu price kind: ${value}`);
};

const parseSnapshotUrl = (value: string): URL => {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new Error("MENU_SNAPSHOT_URL must be a valid URL.", { cause: error });
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("MENU_SNAPSHOT_URL must use HTTP or HTTPS.");
  }
  return url;
};

const readLimitedResponseBody = async (
  response: Response,
  maxBytes: number,
): Promise<string> => {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error("Menu snapshot byte limit must be a positive safe integer.");
  }

  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error(`Menu snapshot exceeds the ${maxBytes}-byte limit.`);
  }

  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let totalBytes = 0;
  let text = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw new Error(`Menu snapshot exceeds the ${maxBytes}-byte limit.`);
    }
    text += decoder.decode(value, { stream: true });
  }

  return text + decoder.decode();
};

const requireRecord = (value: unknown, path: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
};

const requireArray = (value: unknown, path: string): unknown[] => {
  if (!Array.isArray(value)) {
    throw new Error(`${path} must be an array.`);
  }
  return value;
};

const requireString = (
  value: unknown,
  path: string,
  allowEmpty = false,
): string => {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0)) {
    throw new Error(`${path} must be ${allowEmpty ? "a string" : "a non-empty string"}.`);
  }
  return value;
};

const requireSafeInteger = (value: unknown, path: string): number => {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${path} must be a safe integer.`);
  }
  return value as number;
};

const isIsoDateTime = (value: string): boolean => {
  const timestamp = Date.parse(value);
  return value === value.trim()
    && !Number.isNaN(timestamp)
    && new Date(timestamp).toISOString() === value;
};
