export type MenuCategoryId =
  | "classic"
  | "filled"
  | "gourmet"
  | "empanadas"
  | "extras";

export type MenuPriceKind =
  | "whole"
  | "slice"
  | "unit"
  | "portion";

/**
 * Integer amount expressed in Argentine pesos, not cents.
 */
export interface MenuPrice {
  kind: MenuPriceKind;
  amount: number;
}

export interface MenuCategoryDefinition {
  id: MenuCategoryId;
  name: string;
  orderIndex: number;
  allowedPriceKinds: readonly MenuPriceKind[];
}

export interface MenuItem {
  id: string;
  categoryId: MenuCategoryId;
  name: string;
  description?: string;
  orderIndex: number;
  prices: readonly MenuPrice[];
}

export interface MenuContentSnapshot {
  revision: number;
  currency: "ARS";
  categories: readonly MenuCategoryDefinition[];
  items: readonly MenuItem[];
}

export type BusinessStatus = "open" | "closed" | "sold_out";

export interface BusinessStatusSnapshot {
  status: BusinessStatus;
  message: string;
}

export interface PublishedMenuSnapshot {
  schemaVersion: 1;
  content: MenuContentSnapshot;
  businessStatus: BusinessStatusSnapshot;
  publishedAt: string;
  sourceHash: string;
}

export interface BusinessAddress {
  streetAddress: string;
  locality: string;
  display: string;
  countryCode: "AR";
}

export interface BusinessContact {
  phoneDisplay: string;
  whatsappE164: string;
  whatsappDefaultMessage: string;
  instagramHandle: string;
}

export interface BusinessRules {
  halfAndHalf: string;
}

export interface BusinessHours {
  display: string;
}

/** Only confirmed, stable business facts belong here. */
export interface BusinessProfile {
  name: string;
  description: string;
  address: BusinessAddress;
  contact: BusinessContact;
  hours: BusinessHours;
  rules: BusinessRules;
}

export interface InitialMenuFixture {
  business: BusinessProfile;
  content: MenuContentSnapshot;
  businessStatus: BusinessStatusSnapshot;
}

export interface MenuValidationIssue {
  path: string;
  message: string;
}
