import { fixedMenuCategories } from "../domain/menu-config.ts";
import { assertValidInitialMenuFixture } from "../domain/menu-validation.ts";
import type {
  BusinessProfile,
  InitialMenuFixture,
  MenuItem,
  MenuPrice,
} from "../types/menu.ts";

const classicPrices = (large: number, slice: number): readonly MenuPrice[] => [
  { kind: "whole", amount: large },
  { kind: "slice", amount: slice },
];

const wholePrice = (amount: number): readonly MenuPrice[] => [
  { kind: "whole", amount },
];

const unitPrice = (amount: number): readonly MenuPrice[] => [
  { kind: "unit", amount },
];

const portionPrice = (amount: number): readonly MenuPrice[] => [
  { kind: "portion", amount },
];

export const ilFiglioBusiness = {
  name: "Il Figlio",
  description: "Pizza al molde, masas de larga fermentación.",
  address: {
    streetAddress: "Diego Armando Maradona 1519",
    locality: "Lanús Oeste",
    display: "Diego Armando Maradona 1519, Lanús Oeste",
    countryCode: "AR",
  },
  contact: {
    phoneDisplay: "11 4409-7322",
    whatsappE164: "5491144097322",
    whatsappDefaultMessage: "Hola, quiero hacer un pedido en Il Figlio.",
    instagramHandle: "ilfigliopizza",
  },
  hours: {
    display: "Viernes a domingo desde las 19:00",
  },
  rules: {
    halfAndHalf:
      "Las pizzas mitad y mitad se cobran en base a la variedad más cara.",
  },
} as const satisfies BusinessProfile;

export const initialMenuItems = [
  {
    id: "clasica-mozzarella",
    categoryId: "classic",
    name: "Mozzarella",
    description:
      "Salsa de tomate, mozzarella, orégano o albahaca y aceitunas.",
    orderIndex: 1,
    prices: classicPrices(14_000, 2_500),
  },
  {
    id: "clasica-fugazza",
    categoryId: "classic",
    name: "Fugazza",
    description:
      "Cebolla, queso parmesano, orégano, aceite de oliva y aceitunas.",
    orderIndex: 2,
    prices: classicPrices(11_000, 1_500),
  },
  {
    id: "clasica-fugazza-con-mozzarella",
    categoryId: "classic",
    name: "Fugazza con mozzarella",
    description:
      "Mozzarella, cebolla, queso parmesano, orégano, aceite de oliva y aceitunas.",
    orderIndex: 3,
    prices: classicPrices(15_000, 3_000),
  },
  {
    id: "clasica-jamon",
    categoryId: "classic",
    name: "Jamón",
    description:
      "Salsa de tomate, mozzarella, jamón cocido, orégano y aceitunas.",
    orderIndex: 4,
    prices: classicPrices(17_000, 3_500),
  },
  {
    id: "clasica-jamon-y-morrones",
    categoryId: "classic",
    name: "Jamón y morrones",
    description:
      "Salsa de tomate, mozzarella, jamón cocido, morrones, orégano y aceitunas.",
    orderIndex: 5,
    prices: classicPrices(19_000, 4_000),
  },
  {
    id: "clasica-napolitana",
    categoryId: "classic",
    name: "Napolitana",
    description:
      "Salsa de tomate, mozzarella, rodajas de tomate, queso parmesano, provenzal y aceitunas.",
    orderIndex: 6,
    prices: classicPrices(17_000, 3_500),
  },
  {
    id: "clasica-napolitana-especial",
    categoryId: "classic",
    name: "Napolitana especial",
    description:
      "Salsa de tomate, mozzarella, jamón cocido, rodajas de tomate, queso parmesano, provenzal y aceitunas.",
    orderIndex: 7,
    prices: classicPrices(19_000, 4_000),
  },
  {
    id: "clasica-provolone",
    categoryId: "classic",
    name: "Provolone",
    description:
      "Salsa de tomate, mozzarella, queso provolone, orégano y aceitunas.",
    orderIndex: 8,
    prices: classicPrices(20_000, 4_000),
  },
  {
    id: "clasica-provolone-con-jamon",
    categoryId: "classic",
    name: "Provolone con jamón",
    description:
      "Salsa de tomate, mozzarella, jamón cocido, queso provolone, orégano y aceitunas.",
    orderIndex: 9,
    prices: classicPrices(22_000, 4_500),
  },
  {
    id: "clasica-roquefort",
    categoryId: "classic",
    name: "Roquefort",
    description:
      "Salsa de tomate, mozzarella, queso roquefort y aceitunas.",
    orderIndex: 10,
    prices: classicPrices(20_000, 3_500),
  },
  {
    id: "clasica-peperoni",
    categoryId: "classic",
    name: "Peperoni",
    description:
      "Salsa de tomate, mozzarella, queso parmesano y peperoni.",
    orderIndex: 11,
    prices: classicPrices(20_000, 4_000),
  },
  {
    id: "clasica-aglio-e-olio",
    categoryId: "classic",
    name: "Aglio e olio",
    description:
      "Salsa de tomate, ajo picado, aceite de oliva, orégano y aceitunas.",
    orderIndex: 12,
    prices: classicPrices(9_000, 1_500),
  },
  {
    id: "rellena-fugazzeta",
    categoryId: "filled",
    name: "Fugazzeta",
    description:
      "Mozzarella, cebolla, queso parmesano, orégano, aceite de oliva y aceitunas.",
    orderIndex: 1,
    prices: wholePrice(24_000),
  },
  {
    id: "rellena-fugazzetta-con-jamon",
    categoryId: "filled",
    name: "Fugazzetta con jamón",
    description:
      "Mozzarella, jamón cocido, cebolla, queso parmesano, orégano, aceite de oliva y aceitunas.",
    orderIndex: 2,
    prices: wholePrice(27_000),
  },
  {
    id: "rellena-fugazzetta-provolone",
    categoryId: "filled",
    name: "Fugazzetta provolone",
    description:
      "Mozzarella, queso provolone, cebolla, orégano, aceite de oliva y aceitunas.",
    orderIndex: 3,
    prices: wholePrice(27_000),
  },
  {
    id: "rellena-fugazzetta-completa",
    categoryId: "filled",
    name: "Fugazzetta completa",
    description:
      "Mozzarella, jamón cocido, morrones, cebolla, queso parmesano, orégano, aceite de oliva y aceitunas.",
    orderIndex: 4,
    prices: wholePrice(30_000),
  },
  {
    id: "gourmet-jamon-crudo",
    categoryId: "gourmet",
    name: "Jamón crudo",
    description:
      "Salsa de tomate, mozzarella, jamón crudo, orégano y aceitunas.",
    orderIndex: 1,
    prices: wholePrice(21_000),
  },
  {
    id: "gourmet-cuatro-quesos",
    categoryId: "gourmet",
    name: "Cuatro quesos",
    description:
      "Salsa de tomate, mozzarella, provolone, roquefort, parmesano, orégano y aceitunas.",
    orderIndex: 2,
    prices: wholePrice(24_000),
  },
  {
    id: "gourmet-panceta-y-champignons",
    categoryId: "gourmet",
    name: "Panceta y champignons",
    description:
      "Salsa de tomate, mozzarella, champignons, bacon (panceta) y aceitunas.",
    orderIndex: 3,
    prices: wholePrice(28_000),
  },
  {
    id: "gourmet-cbo",
    categoryId: "gourmet",
    name: "C.B.O",
    description:
      "Cheddar, bacon (panceta), base de cebolla o tomate y aceitunas.",
    orderIndex: 4,
    prices: wholePrice(28_000),
  },
  {
    id: "empanada-carne",
    categoryId: "empanadas",
    name: "Carne",
    orderIndex: 1,
    prices: unitPrice(2_800),
  },
  {
    id: "empanada-jamon-y-queso",
    categoryId: "empanadas",
    name: "Jamón y queso",
    orderIndex: 2,
    prices: unitPrice(2_800),
  },
  {
    id: "faina",
    categoryId: "extras",
    name: "Fainá",
    orderIndex: 1,
    prices: portionPrice(1_200),
  },
  {
    id: "faina-provolone",
    categoryId: "extras",
    name: "Fainá provolone",
    orderIndex: 2,
    prices: portionPrice(2_000),
  },
] as const satisfies readonly MenuItem[];

const fixtureDraft = {
  business: ilFiglioBusiness,
  content: {
    revision: 1,
    currency: "ARS",
    categories: fixedMenuCategories,
    items: initialMenuItems,
  },
  businessStatus: {
    status: "closed",
    message: "",
  },
} satisfies InitialMenuFixture;

export const initialMenuFixture = assertValidInitialMenuFixture(fixtureDraft);
export const initialMenuContent = initialMenuFixture.content;
