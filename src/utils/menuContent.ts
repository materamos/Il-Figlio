import type {
  MenuCategoryDefinition,
  MenuCategoryId,
  MenuContentSnapshot,
  MenuItem,
  MenuPrice,
  MenuPriceKind,
} from "../types/menu";
import { initialMenuContent } from "../data";
import {
  MENU_CATEGORY_IDS,
  MENU_PRICE_KINDS,
} from "../domain/menu-config";
import { assertValidMenuContent } from "../domain/menu-validation";

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

interface DatabaseSnapshot {
  schema_version: number;
  revision: number;
  categories: DatabaseCategory[];
}

export const loadMenuContent = async (): Promise<MenuContentSnapshot> => {
  const source = import.meta.env.MENU_DATA_SOURCE ?? "fixture";

  if (source === "fixture") return initialMenuContent;
  if (source !== "supabase") {
    throw new Error(`Unsupported MENU_DATA_SOURCE: ${source}`);
  }

  const databaseUrl = import.meta.env.SUPABASE_DB_URL;
  if (!databaseUrl) {
    throw new Error("SUPABASE_DB_URL is required when MENU_DATA_SOURCE=supabase.");
  }

  const { default: postgres } = await import("postgres");
  const sql = postgres(databaseUrl, {
    max: 1,
    idle_timeout: 5,
    connect_timeout: 10,
    prepare: false,
  });

  try {
    const rows = await sql<{ snapshot: DatabaseSnapshot }[]>`
      select public.get_build_menu_snapshot() as snapshot
    `;
    const snapshot = rows[0]?.snapshot;
    if (!snapshot) throw new Error("Supabase returned an empty menu snapshot.");
    return mapDatabaseSnapshot(snapshot);
  } finally {
    await sql.end({ timeout: 2 });
  }
};

const mapDatabaseSnapshot = (snapshot: DatabaseSnapshot): MenuContentSnapshot => {
  if (snapshot.schema_version !== 1) {
    throw new Error(`Unsupported menu snapshot schema version: ${snapshot.schema_version}`);
  }

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
  throw new Error(`Unsupported price kind: ${value}`);
};
