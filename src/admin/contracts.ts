export const BUSINESS_STATUS_VALUES = [
  "accepting_orders",
  "paused",
  "sold_out",
  "closed",
] as const;

export const PRICE_KIND_VALUES = ["whole", "slice", "unit", "portion"] as const;

export type BusinessStatus = (typeof BUSINESS_STATUS_VALUES)[number];
export type PriceKind = (typeof PRICE_KIND_VALUES)[number];

export interface AdminApiConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  deployedRevision: number;
}

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface AdminAvailability {
  available: boolean;
  updatedAt: string | null;
}

export interface AdminMenuItem {
  id: string;
  categoryCode: string;
  name: string;
  description: string;
  orderIndex: number;
  version: number;
  archivedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  prices: Partial<Record<PriceKind, number>>;
  availability: AdminAvailability;
}

export interface AdminMenuCategory {
  code: string;
  title: string;
  orderIndex: number;
  priceKinds: PriceKind[];
  items: AdminMenuItem[];
}

export interface AdminBusinessState {
  status: BusinessStatus;
  message: string;
  updatedAt: string | null;
}

export interface AdminStaff {
  userId: string;
  email: string;
}

export interface AdminContentState {
  currentRevision: number;
  lastPublishRequestedRevision: number;
  lastPublishRequestedAt: string | null;
}

export interface PublishRequest {
  id: number | string;
  contentRevision: number;
  status: "queued" | "succeeded" | "failed" | "unknown";
  message: string;
  hookStatusCode: number | null;
  hookJobId: string | null;
  createdAt: string | null;
  completedAt: string | null;
}

export interface AdminOperationalState {
  schemaVersion: 1;
  authorized: boolean;
  staff: AdminStaff | null;
  content: AdminContentState | null;
  business: AdminBusinessState | null;
  categories: AdminMenuCategory[];
  latestPublishRequest: PublishRequest | null;
}

export interface RpcResult {
  ok: boolean;
  changed: boolean;
  requiresRedeploy: boolean;
  operation: string;
  message: string;
  revision: number | null;
  itemId?: string;
  version?: number;
  available?: boolean;
  updatedAt?: string | null;
  changedCount?: number;
  cooldownSecondsRemaining?: number;
}

export interface ItemFormValues {
  name: string;
  description: string;
  prices: Record<string, number>;
}

export interface ItemFormErrors {
  name?: string;
  description?: string;
  prices?: Partial<Record<PriceKind, string>>;
}

export type PublicationView =
  | "published"
  | "pending"
  | "requested"
  | "failed"
  | "unknown";

export const businessStatusLabels: Readonly<Record<BusinessStatus, string>> = {
  accepting_orders: "Tomando pedidos",
  paused: "Pedidos pausados",
  sold_out: "Producción agotada",
  closed: "Cerrado",
};

export const priceKindLabels: Readonly<Record<PriceKind, string>> = {
  whole: "Grande",
  slice: "Porción",
  unit: "Unidad",
  portion: "Porción",
};

const mutationMessages: Readonly<Record<string, string>> = {
  permission_denied: "No tenés permisos para realizar esta acción.",
  invalid_name: "Ingresá un nombre válido de hasta 80 caracteres.",
  invalid_description: "La descripción puede tener hasta 320 caracteres.",
  invalid_category: "La categoría seleccionada no es válida.",
  invalid_prices: "Revisá los precios requeridos para esta categoría.",
  menu_item_name_exists: "Ya existe un sabor con ese nombre en la categoría.",
  invalid_item_version: "No se pudo verificar la versión del sabor.",
  menu_item_not_found: "El sabor ya no existe. Actualizamos el panel.",
  stale_menu_item: "Otra edición cambió este sabor. Actualizamos el panel para evitar pisarla.",
  menu_item_created: "Sabor agregado. Publicá los cambios para verlo en el menú.",
  menu_item_updated: "Cambios guardados. Publicalos para actualizar el menú.",
  menu_item_unchanged: "No había cambios para guardar.",
  menu_item_already_archived: "El sabor ya estaba eliminado.",
  menu_item_archived: "Sabor eliminado. Quedó agotado hasta la próxima publicación.",
  menu_item_already_active: "El sabor ya estaba activo.",
  menu_item_restored_unavailable:
    "Sabor restaurado como agotado. Publicalo y habilitalo cuando corresponda.",
  invalid_availability: "La disponibilidad elegida no es válida.",
  archived_item_cannot_be_available: "Un sabor eliminado no puede marcarse disponible.",
  stale_availability: "La disponibilidad cambió en otro dispositivo. Actualizamos el panel.",
  availability_updated: "Disponibilidad actualizada.",
  availability_unchanged: "La disponibilidad ya tenía ese valor.",
  availability_reset: "Todos los sabores activos quedaron disponibles.",
  invalid_business_status: "Elegí un estado válido para el negocio.",
  invalid_business_message: "El mensaje puede tener hasta 160 caracteres.",
  stale_business_status: "El estado cambió en otro dispositivo. Actualizamos el panel.",
  business_status_updated: "Estado del negocio actualizado.",
  business_status_unchanged: "El negocio ya tenía ese estado.",
  publish_queued: "Publicación solicitada. Vercel ya está preparando el nuevo menú.",
  publish_already_queued: "Esta versión ya tiene una publicación en curso.",
  publish_cooldown: "Se publicó hace poco y el sistema está evitando solicitudes repetidas.",
  publish_failed: "No se pudo iniciar la publicación. Podés volver a intentarlo.",
  publish_state_uncertain:
    "El despliegue pudo iniciarse, pero no se confirmó el registro. Revisá Vercel antes de reintentar.",
  publish_not_configured: "La publicación todavía no está configurada.",
  no_changes_to_publish: "La carta publicada ya está al día.",
  cors_origin_not_allowed: "Este origen no está autorizado para publicar.",
  unauthorized: "La sesión expiró. Volvé a iniciar sesión.",
};

export function readAdminConfig(element: HTMLElement): AdminApiConfig | null {
  const supabaseUrl = (element.dataset.supabaseUrl ?? "").trim().replace(/\/$/, "");
  const supabaseAnonKey = (element.dataset.supabaseAnonKey ?? "").trim();
  const deployedRevision = Number(element.dataset.deployedRevision ?? "");

  if (
    !/^https?:\/\//.test(supabaseUrl)
    || !supabaseAnonKey
    || supabaseAnonKey.startsWith("replace-")
    || !Number.isSafeInteger(deployedRevision)
    || deployedRevision < 0
  ) {
    return null;
  }

  return { supabaseUrl, supabaseAnonKey, deployedRevision };
}

export function normalizeAdminState(value: unknown): AdminOperationalState {
  const record = asRecord(value);
  const schemaVersion = asInteger(record.schema_version, 0);

  if (schemaVersion !== 1) {
    throw new Error("El panel recibió una versión de datos incompatible.");
  }

  const authorized = record.authorized === true;
  const content = authorized ? normalizeContent(record.content) : null;
  const business = authorized ? normalizeBusiness(record.business) : null;
  const categories = authorized && Array.isArray(record.categories)
    ? record.categories.map(normalizeCategory)
    : [];
  const publish = asRecord(record.publish);

  return {
    schemaVersion: 1,
    authorized,
    staff: authorized ? normalizeStaff(record.staff) : null,
    content,
    business,
    categories,
    latestPublishRequest: normalizePublishRequest(publish.latest_request),
  };
}

export function normalizeRpcResult(value: unknown): RpcResult {
  const item = Array.isArray(value) ? value[0] : value;
  const record = asRecord(item);

  if (
    typeof record.ok !== "boolean"
    || typeof record.changed !== "boolean"
    || typeof record.requires_redeploy !== "boolean"
    || typeof record.operation !== "string"
    || typeof record.message !== "string"
  ) {
    throw new Error("El panel recibió una respuesta inesperada. Recargá e intentá de nuevo.");
  }

  return {
    ok: record.ok,
    changed: record.changed,
    requiresRedeploy: record.requires_redeploy,
    operation: record.operation,
    message: record.message,
    revision: nullableInteger(record.revision),
    itemId: optionalString(record.item_id),
    version: optionalInteger(record.version),
    available: typeof record.available === "boolean" ? record.available : undefined,
    updatedAt: nullableString(record.updated_at) ?? undefined,
    changedCount: optionalInteger(record.changed_count),
    cooldownSecondsRemaining: optionalInteger(record.cooldown_seconds_remaining),
  };
}

export function validateItemValues(
  values: ItemFormValues,
  priceKinds: readonly PriceKind[],
): ItemFormErrors {
  const errors: ItemFormErrors = {};
  const name = values.name.trim();
  const description = values.description.trim();

  if (!name || name.length > 80) {
    errors.name = "Ingresá un nombre de hasta 80 caracteres.";
  }
  if (description.length > 320) {
    errors.description = "Usá hasta 320 caracteres.";
  }

  for (const kind of priceKinds) {
    const amount = values.prices[kind];
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 10_000_000) {
      errors.prices ??= {};
      errors.prices[kind] = "Ingresá un importe entero mayor que cero.";
    }
  }

  return errors;
}

export function hasItemFormErrors(errors: ItemFormErrors): boolean {
  return Boolean(
    errors.name
      || errors.description
      || (errors.prices && Object.keys(errors.prices).length > 0),
  );
}

export function publicationView(
  state: AdminOperationalState,
  deployedRevision: number,
): PublicationView {
  const currentRevision = state.content?.currentRevision;
  if (typeof currentRevision !== "number") return "unknown";
  if (currentRevision <= deployedRevision) return "published";

  const latest = state.latestPublishRequest;
  if (latest?.contentRevision === currentRevision) {
    if (latest.status === "queued" || latest.status === "succeeded") return "requested";
    if (latest.status === "failed") return "failed";
  }
  return "pending";
}

/**
 * The deployed revision is the only proof that Vercel serves the current menu.
 * A queued request stays locked; a hook success remains retryable because it
 * only proves Vercel accepted the hook. Server-side cooldown is authoritative.
 */
export function canRequestPublication(
  state: AdminOperationalState,
  deployedRevision: number,
): boolean {
  const currentRevision = state.content?.currentRevision;
  if (typeof currentRevision !== "number" || currentRevision <= deployedRevision) return false;
  const latest = state.latestPublishRequest;
  return !(latest?.contentRevision === currentRevision && latest.status === "queued");
}

export function isPublicationRetry(
  state: AdminOperationalState,
  deployedRevision: number,
): boolean {
  const currentRevision = state.content?.currentRevision;
  const latest = state.latestPublishRequest;
  return typeof currentRevision === "number"
    && currentRevision > deployedRevision
    && latest?.contentRevision === currentRevision
    && (latest.status === "succeeded" || latest.status === "failed");
}

export function resultMessage(result: RpcResult): string {
  const base = mutationMessages[result.message]
    ?? result.message.replaceAll("_", " ");
  const seconds = result.cooldownSecondsRemaining;
  if (
    result.message === "publish_cooldown"
    && Number.isSafeInteger(seconds)
    && (seconds ?? -1) >= 0
  ) {
    return `${base} Esperá ${seconds} segundos.`;
  }
  return base;
}

export function formatArs(amount: number): string {
  return `$${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(amount)}`;
}

export function formatDateTime(value: string | null): string {
  if (!value) return "Sin registro";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin registro";
  return new Intl.DateTimeFormat("es-AR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function normalizeContent(value: unknown): AdminContentState | null {
  const record = asRecord(value);
  if (Object.keys(record).length === 0) return null;
  return {
    currentRevision: asInteger(record.current_revision, 0),
    lastPublishRequestedRevision: asInteger(record.last_publish_requested_revision, 0),
    lastPublishRequestedAt: nullableString(record.last_publish_requested_at),
  };
}

function normalizeBusiness(value: unknown): AdminBusinessState | null {
  const record = asRecord(value);
  if (Object.keys(record).length === 0) return null;
  const rawStatus = typeof record.status === "string" ? record.status : "closed";
  const status = BUSINESS_STATUS_VALUES.includes(rawStatus as BusinessStatus)
    ? rawStatus as BusinessStatus
    : "closed";
  return {
    status,
    message: nullableString(record.message) ?? "",
    updatedAt: nullableString(record.updated_at),
  };
}

function normalizeStaff(value: unknown): AdminStaff | null {
  const record = asRecord(value);
  const userId = optionalString(record.user_id);
  const email = optionalString(record.email);
  return userId || email ? { userId: userId ?? "", email: email ?? "" } : null;
}

function normalizeCategory(value: unknown): AdminMenuCategory {
  const record = asRecord(value);
  const rawKinds = Array.isArray(record.price_kinds) ? record.price_kinds : [];
  const priceKinds = rawKinds.filter(
    (kind): kind is PriceKind =>
      typeof kind === "string" && PRICE_KIND_VALUES.includes(kind as PriceKind),
  );
  return {
    code: optionalString(record.code) ?? "",
    title: optionalString(record.title) ?? "Categoría",
    orderIndex: asInteger(record.order_index, 0),
    priceKinds,
    items: Array.isArray(record.items) ? record.items.map(normalizeItem) : [],
  };
}

function normalizeItem(value: unknown): AdminMenuItem {
  const record = asRecord(value);
  const pricesRecord = asRecord(record.prices);
  const prices: Partial<Record<PriceKind, number>> = {};
  for (const kind of PRICE_KIND_VALUES) {
    const amount = nullableInteger(pricesRecord[kind]);
    if (amount !== null) prices[kind] = amount;
  }
  const availability = asRecord(record.availability);
  return {
    id: optionalString(record.id) ?? "",
    categoryCode: optionalString(record.category_code) ?? "",
    name: optionalString(record.name) ?? "Sabor sin nombre",
    description: nullableString(record.description) ?? "",
    orderIndex: asInteger(record.order_index, 0),
    version: Math.max(1, asInteger(record.version, 1)),
    archivedAt: nullableString(record.archived_at),
    createdAt: nullableString(record.created_at),
    updatedAt: nullableString(record.updated_at),
    prices,
    availability: {
      available: availability.available === true,
      updatedAt: nullableString(availability.updated_at),
    },
  };
}

function normalizePublishRequest(value: unknown): PublishRequest | null {
  const record = asRecord(value);
  if (Object.keys(record).length === 0) return null;
  const rawStatus = optionalString(record.status);
  const status = rawStatus === "queued" || rawStatus === "succeeded" || rawStatus === "failed"
    ? rawStatus
    : "unknown";
  return {
    id: typeof record.id === "string" || typeof record.id === "number" ? record.id : "",
    contentRevision: asInteger(record.content_revision, 0),
    status,
    message: optionalString(record.message) ?? "",
    hookStatusCode: nullableInteger(record.hook_status_code),
    hookJobId: nullableString(record.hook_job_id),
    createdAt: nullableString(record.created_at),
    completedAt: nullableString(record.completed_at),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function optionalString(value: unknown): string | undefined {
  return nullableString(value) ?? undefined;
}

function nullableInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function optionalInteger(value: unknown): number | undefined {
  return nullableInteger(value) ?? undefined;
}

function asInteger(value: unknown, fallback: number): number {
  return nullableInteger(value) ?? fallback;
}
