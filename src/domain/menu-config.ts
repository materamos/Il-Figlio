import type {
  MenuCategoryDefinition,
  MenuCategoryId,
  MenuPriceKind,
} from "../types/menu.ts";

export const MENU_CATEGORY_IDS = [
  "classic",
  "filled",
  "gourmet",
  "empanadas",
  "extras",
] as const satisfies readonly MenuCategoryId[];

export const MENU_PRICE_KINDS = [
  "whole",
  "slice",
  "unit",
  "portion",
] as const satisfies readonly MenuPriceKind[];

export const fixedMenuCategories = [
  {
    id: "classic",
    name: "Pizzas clásicas",
    orderIndex: 10,
    allowedPriceKinds: ["whole", "slice"],
  },
  {
    id: "filled",
    name: "Pizzas rellenas",
    orderIndex: 20,
    allowedPriceKinds: ["whole"],
  },
  {
    id: "gourmet",
    name: "Pizzas gourmet",
    orderIndex: 30,
    allowedPriceKinds: ["whole"],
  },
  {
    id: "empanadas",
    name: "Empanadas",
    orderIndex: 40,
    allowedPriceKinds: ["unit"],
  },
  {
    id: "extras",
    name: "Extras",
    orderIndex: 50,
    allowedPriceKinds: ["portion"],
  },
] as const satisfies readonly MenuCategoryDefinition[];

export const priceKindLabels = {
  whole: "Grande",
  slice: "Porción",
  unit: "Unidad",
  portion: "Porción",
} as const satisfies Readonly<Record<MenuPriceKind, string>>;

export const allowedPriceKindsByCategory = {
  classic: fixedMenuCategories[0].allowedPriceKinds,
  filled: fixedMenuCategories[1].allowedPriceKinds,
  gourmet: fixedMenuCategories[2].allowedPriceKinds,
  empanadas: fixedMenuCategories[3].allowedPriceKinds,
  extras: fixedMenuCategories[4].allowedPriceKinds,
} as const satisfies Readonly<
  Record<MenuCategoryId, readonly MenuPriceKind[]>
>;
