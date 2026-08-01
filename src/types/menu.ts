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

export interface MenuItemAvailability {
  itemId: string;
  available: boolean;
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

/**
 * Only confirmed, stable business facts belong here. Runtime status and opening
 * hours deliberately live outside this contract because they are not confirmed.
 */
export interface BusinessProfile {
  name: string;
  address: BusinessAddress;
  contact: BusinessContact;
  rules: BusinessRules;
}

export interface InitialMenuFixture {
  business: BusinessProfile;
  content: MenuContentSnapshot;
  availability: readonly MenuItemAvailability[];
}

export interface MenuValidationIssue {
  path: string;
  message: string;
}
