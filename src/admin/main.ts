import { AdminApiError, createAdminApi } from "./api.ts";
import {
  businessStatusLabels,
  canRequestPublication,
  formatArs,
  formatDateTime,
  hasItemFormErrors,
  isPublicationRetry,
  priceKindLabels,
  publicationView,
  readAdminConfig,
  resultMessage,
  validateItemValues,
  type AdminMenuCategory,
  type AdminMenuItem,
  type AdminOperationalState,
  type BusinessStatus,
  type ItemFormErrors,
  type ItemFormValues,
  type PriceKind,
  type RpcResult,
} from "./contracts.ts";
import { createSessionManager } from "./session.ts";

type MessageTone = "info" | "success" | "warning" | "error";

export function startAdminApp(): void {
  const rootElement = document.querySelector<HTMLElement>("[data-admin-root]");
  if (!rootElement) return;
  const root: HTMLElement = rootElement;

  const views = new Map(
    Array.from(root.querySelectorAll<HTMLElement>("[data-view]")).map((view) => [
      view.dataset.view ?? "",
      view,
    ]),
  );
  const liveRegion = requiredElement<HTMLElement>(root, "[data-admin-live]");
  const validatedConfig = readAdminConfig(root);
  let state: AdminOperationalState | null = null;
  let createFormInitialized = false;

  root.addEventListener("input", handleInput);
  root.addEventListener("change", handleChange);
  root.addEventListener("focusout", handleFieldBlur);
  root.addEventListener("click", (event) => void handleClick(event));
  root.addEventListener("submit", (event) => void handleSubmit(event));

  if (!validatedConfig) {
    showView("configuration");
    return;
  }

  const config = validatedConfig;
  const api = createAdminApi(config);
  const session = createSessionManager(api);

  void start();

  async function start(): Promise<void> {
    try {
      const initial = await session.start();
      if (initial.recovery) {
        showView("set-password");
        announce("Definí una nueva contraseña para recuperar el acceso.", "info");
        return;
      }
      if (!initial.session) {
        showView("login");
        return;
      }
      await loadDashboard();
    } catch (error) {
      handleError(error);
      if (!state && views.get("loading")?.hidden === false) {
        showView("login");
      }
    }
  }

  async function handleSubmit(event: SubmitEvent): Promise<void> {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.matches("[data-form]")) return;
    event.preventDefault();

    switch (form.dataset.form) {
      case "login":
        await submitLogin(form);
        break;
      case "recovery-request":
        await submitRecovery(form);
        break;
      case "set-password":
        await submitPassword(form, true);
        break;
      case "change-password":
        await submitPassword(form, false);
        break;
      case "business-status":
        await submitBusinessStatus(form);
        break;
      case "create-item":
        await submitCreateItem(form);
        break;
      case "edit-item":
        await submitEditItem(form);
        break;
      default:
        break;
    }
  }

  async function handleClick(event: MouseEvent): Promise<void> {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const showViewButton = target.closest<HTMLButtonElement>("[data-show-view]");
    if (showViewButton) {
      showView(showViewButton.dataset.showView ?? "login");
      clearAnnouncement();
      return;
    }

    const button = target.closest<HTMLButtonElement>("[data-action]");
    if (!button || button.disabled) return;

    switch (button.dataset.action) {
      case "logout":
        await submitLogout(button);
        break;
      case "reset-availability":
        await submitResetAvailability(button);
        break;
      case "sold-out":
        await submitQuickSoldOut(button);
        break;
      case "archive-item":
        await submitArchiveItem(button);
        break;
      case "restore-item":
        await submitRestoreItem(button);
        break;
      case "publish":
        await submitPublication(button);
        break;
      default:
        break;
    }
  }

  function handleChange(event: Event): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement || input instanceof HTMLSelectElement)) return;

    if (input.matches("[data-create-category]")) {
      renderCreatePriceFields(input.value);
      return;
    }
    if (input instanceof HTMLInputElement && input.matches('[data-action="availability"]')) {
      void submitAvailability(input);
    }
  }

  function handleInput(event: Event): void {
    const input = event.target;
    if (!(input instanceof HTMLTextAreaElement)) return;
    const counter = root.querySelector<HTMLElement>(`[data-counter-for="${input.id}"]`);
    if (counter) counter.textContent = `${input.value.length}/${input.maxLength}`;
    if (input.getAttribute("aria-invalid") === "true") validateField(input);
  }

  function handleFieldBlur(event: FocusEvent): void {
    const field = event.target;
    if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) return;
    if (field.closest('[data-form="create-item"], [data-form="edit-item"]')) {
      validateField(field);
    }
  }

  async function submitLogin(form: HTMLFormElement): Promise<void> {
    clearFormErrors(form);
    const email = formString(form, "email");
    const password = formString(form, "password");
    if (!email || !emailInput(form, "email")?.checkValidity()) {
      setFieldError(form, "email", "Ingresá un email válido.");
    }
    if (!password) setFieldError(form, "password", "Ingresá tu contraseña.");
    if (focusFirstInvalid(form)) return;

    try {
      await runBusy(form, async () => {
        await session.signIn(email, password);
      });
      form.reset();
      await loadDashboard();
      announce("Sesión iniciada.", "success");
    } catch (error) {
      handleError(error);
    }
  }

  async function submitRecovery(form: HTMLFormElement): Promise<void> {
    clearFormErrors(form);
    const email = formString(form, "email");
    if (!email || !emailInput(form, "email")?.checkValidity()) {
      setFieldError(form, "email", "Ingresá un email válido.");
      focusFirstInvalid(form);
      return;
    }

    try {
      await runBusy(form, async () => {
        const redirectUrl = new URL("/admin/", window.location.origin).toString();
        await api.requestPasswordRecovery(email, redirectUrl);
      });
      form.reset();
      showView("login");
      announce(
        "Si el email corresponde al usuario autorizado, recibirás un enlace para recuperar el acceso.",
        "success",
      );
    } catch (error) {
      handleError(error);
    }
  }

  async function submitPassword(form: HTMLFormElement, recovery: boolean): Promise<void> {
    clearFormErrors(form);
    const password = formString(form, "password");
    const confirmation = formString(form, "password_confirmation");
    if (password.length < 10) {
      setFieldError(form, "password", "Usá al menos 10 caracteres.");
    }
    if (!confirmation || password !== confirmation) {
      setFieldError(form, "password_confirmation", "Las contraseñas no coinciden.");
    }
    if (focusFirstInvalid(form)) return;

    try {
      await runBusy(form, async () => {
        const authSession = await session.requireSession();
        await api.updatePassword(authSession, password);
      });
      form.reset();
      if (recovery) await loadDashboard();
      announce("Contraseña actualizada.", "success");
    } catch (error) {
      handleError(error);
    }
  }

  async function submitBusinessStatus(form: HTMLFormElement): Promise<void> {
    if (!state?.business) return;
    clearFormErrors(form);
    const status = formString(form, "status") as BusinessStatus;
    const message = formString(form, "message");
    if (message.length > 160) {
      setFieldError(form, "message", "Usá hasta 160 caracteres.");
      focusFirstInvalid(form);
      return;
    }

    try {
      const result = await runBusy(form, async () => mutate("set_business_status", {
        p_status: status,
        p_message: message || null,
        p_expected_updated_at: state?.business?.updatedAt ?? null,
      }));
      await handleMutationResult(result, { refresh: "operations" });
    } catch (error) {
      handleError(error);
    }
  }

  async function submitQuickSoldOut(button: HTMLButtonElement): Promise<void> {
    if (!state?.business) return;
    if (!window.confirm("¿Marcar la producción como agotada? El aviso será inmediato.")) return;
    try {
      const result = await runBusy(button, async () => mutate("set_business_status", {
        p_status: "sold_out",
        p_message: state?.business?.message || null,
        p_expected_updated_at: state?.business?.updatedAt ?? null,
      }));
      await handleMutationResult(result, { refresh: "operations" });
    } catch (error) {
      handleError(error);
    }
  }

  async function submitAvailability(input: HTMLInputElement): Promise<void> {
    const item = findItem(input.dataset.itemId);
    if (!item) return;
    const previous = !input.checked;
    input.disabled = true;
    input.closest<HTMLElement>(".admin-availability-row")?.setAttribute("aria-busy", "true");
    updateAvailabilityLabel(input);

    try {
      const result = await mutate("set_item_availability", {
        p_item_id: item.id,
        p_available: input.checked,
        p_expected_updated_at: item.availability.updatedAt,
      });
      if (!result.ok) {
        input.checked = previous;
        updateAvailabilityLabel(input);
        await handleMutationResult(result, { refresh: "availability" });
        return;
      }
      item.availability.available = result.available ?? input.checked;
      item.availability.updatedAt = result.updatedAt ?? item.availability.updatedAt;
      announce(resultMessage(result), "success");
    } catch (error) {
      input.checked = previous;
      updateAvailabilityLabel(input);
      handleError(error);
    } finally {
      input.disabled = false;
      input.closest<HTMLElement>(".admin-availability-row")?.removeAttribute("aria-busy");
    }
  }

  async function submitResetAvailability(button: HTMLButtonElement): Promise<void> {
    if (!window.confirm("¿Marcar todos los sabores activos como disponibles?")) return;
    try {
      const result = await runBusy(button, async () => mutate("reset_all_availability", {}),
        root.querySelector<HTMLElement>("[data-availability-list]"));
      await handleMutationResult(result, { refresh: "availability" });
    } catch (error) {
      handleError(error);
    }
  }

  async function submitCreateItem(form: HTMLFormElement): Promise<void> {
    const category = findCategory(formString(form, "category_code"));
    if (!category) {
      announce("Elegí una categoría válida.", "error");
      return;
    }
    const values = readItemForm(form, category.priceKinds);
    if (!validateItemForm(form, values, category.priceKinds)) return;

    try {
      const result = await runBusy(form, async () => mutate("create_menu_item", {
        p_category_code: category.code,
        p_name: values.name.trim(),
        p_description: values.description.trim() || null,
        p_prices: values.prices,
      }), root.querySelector<HTMLElement>("[data-menu-editor]"));
      if (result.ok) {
        form.reset();
        const categorySelect = form.elements.namedItem("category_code");
        if (categorySelect instanceof HTMLSelectElement) {
          renderCreatePriceFields(categorySelect.value);
        }
      }
      await handleMutationResult(result, { refresh: "editor", focus: "create" });
    } catch (error) {
      handleError(error);
    }
  }

  async function submitEditItem(form: HTMLFormElement): Promise<void> {
    const item = findItem(form.dataset.itemId);
    const category = item ? findCategory(item.categoryCode) : null;
    if (!item || !category) {
      announce("El sabor ya no está disponible. Actualizá el panel.", "error");
      return;
    }
    const values = readItemForm(form, category.priceKinds);
    if (!validateItemForm(form, values, category.priceKinds)) return;

    try {
      const result = await runBusy(form, async () => mutate("update_menu_item", {
        p_item_id: item.id,
        p_expected_version: item.version,
        p_name: values.name.trim(),
        p_description: values.description.trim() || null,
        p_prices: values.prices,
      }), root.querySelector<HTMLElement>("[data-menu-editor]"));
      await handleMutationResult(result, { refresh: "editor", focus: `item:${item.id}` });
    } catch (error) {
      handleError(error);
    }
  }

  async function submitArchiveItem(button: HTMLButtonElement): Promise<void> {
    const item = findItem(button.dataset.itemId);
    if (!item) return;
    if (!window.confirm(`¿Eliminar “${item.name}” de la carta? Podrás restaurarlo después.`)) return;

    try {
      const result = await runBusy(button, async () => mutate("archive_menu_item", {
        p_item_id: item.id,
        p_expected_version: item.version,
      }), root.querySelector<HTMLElement>("[data-menu-editor]"));
      await handleMutationResult(result, { refresh: "editor", focus: "archived" });
    } catch (error) {
      handleError(error);
    }
  }

  async function submitRestoreItem(button: HTMLButtonElement): Promise<void> {
    const item = findItem(button.dataset.itemId);
    if (!item) return;
    try {
      const result = await runBusy(button, async () => mutate("restore_menu_item", {
        p_item_id: item.id,
        p_expected_version: item.version,
      }), root.querySelector<HTMLElement>("[data-archived-list]"));
      await handleMutationResult(result, { refresh: "editor", focus: `item:${item.id}` });
    } catch (error) {
      handleError(error);
    }
  }

  async function submitPublication(button: HTMLButtonElement): Promise<void> {
    if (!state?.content || state.content.currentRevision <= config.deployedRevision) {
      announce("La carta publicada ya está al día.", "info");
      return;
    }
    if (!window.confirm("¿Publicar ahora los cambios editoriales en el menú?")) return;

    try {
      const result = await runBusy(button, async () => {
        const authSession = await session.requireSession();
        return api.publish(authSession);
      });
      announce(
        resultMessage(result),
        result.ok ? (result.changed ? "success" : "warning") : "error",
      );
      await refreshState();
      renderPublication();
      renderSummary();
    } catch (error) {
      handleError(error);
    }
  }

  async function submitLogout(button: HTMLButtonElement): Promise<void> {
    await runBusy(button, async () => session.logout());
    state = null;
    createFormInitialized = false;
    showView("login");
    announce("Sesión cerrada.", "success");
  }

  async function mutate(name: string, body: Record<string, unknown>): Promise<RpcResult> {
    const authSession = await session.requireSession();
    return api.mutate(authSession, name, body);
  }

  async function handleMutationResult(
    result: RpcResult,
    options: { refresh: "operations" | "availability" | "editor"; focus?: string },
  ): Promise<void> {
    announce(resultMessage(result), result.ok ? (result.changed ? "success" : "info") : "error");

    if (!result.ok && !shouldRefreshAfterResult(result)) return;
    await refreshState();

    if (options.refresh === "operations") {
      renderBusiness();
      renderSummary();
    } else if (options.refresh === "availability") {
      renderAvailability();
    } else {
      renderAvailability();
      renderEditor();
      renderPublication();
      renderSummary();
      focusEditorTarget(options.focus);
    }
  }

  async function loadDashboard(): Promise<void> {
    try {
      await refreshState();
      if (!state?.authorized) {
        showView("unauthorized");
        return;
      }
      renderDashboard();
      showView("dashboard", false);
    } catch (error) {
      if (error instanceof AdminApiError && error.kind === "auth") session.clear();
      throw error;
    }
  }

  async function refreshState(): Promise<void> {
    const authSession = await session.requireSession();
    state = await api.loadState(authSession);
  }

  function renderDashboard(): void {
    renderSummary();
    renderBusiness();
    renderPublication();
    renderAvailability();
    renderCreateForm();
    renderEditor();
    const email = state?.staff?.email || "Usuario autorizado";
    setText("[data-staff-email]", email);
    setText("[data-account-email]", email);
  }

  function renderSummary(): void {
    if (!state) return;
    const businessSummary = requiredElement<HTMLElement>(root, "[data-business-summary]");
    const publicationSummary = requiredElement<HTMLElement>(root, "[data-publication-summary]");
    const businessStatus = state.business?.status ?? "closed";
    businessSummary.textContent = businessStatusLabels[businessStatus];
    businessSummary.dataset.tone = businessTone(businessStatus);

    const view = publicationView(state, config.deployedRevision);
    publicationSummary.textContent = publicationSummaryText(view);
    publicationSummary.dataset.tone = publicationTone(view);
  }

  function renderBusiness(): void {
    const business = state?.business;
    const form = root.querySelector<HTMLFormElement>('[data-form="business-status"]');
    if (!business || !form) return;
    const status = form.elements.namedItem("status");
    const message = form.elements.namedItem("message");
    if (status instanceof HTMLSelectElement) status.value = business.status;
    if (message instanceof HTMLTextAreaElement) {
      message.value = business.message;
      updateCounter(message);
    }
  }

  function renderPublication(): void {
    if (!state) return;
    const view = publicationView(state, config.deployedRevision);
    const copy = requiredElement<HTMLElement>(root, "[data-publication-copy]");
    const [title, description] = publicationCopy(view);
    const strong = document.createElement("strong");
    const paragraph = document.createElement("p");
    strong.textContent = title;
    paragraph.textContent = description;
    copy.replaceChildren(strong, paragraph);
    copy.dataset.tone = publicationTone(view);

    setText("[data-current-revision]", state.content ? String(state.content.currentRevision) : "—");
    setText("[data-last-publish]", formatDateTime(state.latestPublishRequest?.createdAt ?? null));
    const publishButton = requiredElement<HTMLButtonElement>(root, '[data-action="publish"]');
    publishButton.disabled = !canRequestPublication(state, config.deployedRevision);
    if (view === "requested" && !publishButton.disabled) {
      publishButton.textContent = "Volver a publicar";
    } else if (view === "requested") {
      publishButton.textContent = "Publicación en curso";
    } else if (isPublicationRetry(state, config.deployedRevision)) {
      publishButton.textContent = "Volver a publicar";
    } else {
      publishButton.textContent = "Publicar cambios";
    }
  }

  function renderAvailability(): void {
    const container = requiredElement<HTMLElement>(root, "[data-availability-list]");
    const fragment = document.createDocumentFragment();
    let itemCount = 0;

    for (const category of state?.categories ?? []) {
      const activeItems = category.items.filter((item) => !item.archivedAt);
      if (activeItems.length === 0) continue;
      itemCount += activeItems.length;
      const group = createCategoryGroup(category, activeItems.length);
      for (const item of activeItems) group.append(createAvailabilityRow(item));
      fragment.append(group);
    }

    container.replaceChildren(
      itemCount > 0 ? fragment : createEmpty("Todavía no hay sabores activos."),
    );
  }

  function renderCreateForm(): void {
    const select = root.querySelector<HTMLSelectElement>("[data-create-category]");
    if (!select || createFormInitialized) return;
    select.replaceChildren(
      ...(state?.categories ?? []).map((category) => {
        const option = document.createElement("option");
        option.value = category.code;
        option.textContent = category.title;
        return option;
      }),
    );
    createFormInitialized = true;
    renderCreatePriceFields(select.value);
  }

  function renderCreatePriceFields(categoryCode: string): void {
    const container = root.querySelector<HTMLElement>("[data-create-prices]");
    const category = findCategory(categoryCode);
    if (!container || !category) return;
    container.replaceChildren(
      ...category.priceKinds.map((kind) => createPriceField("create", kind)),
    );
  }

  function renderEditor(): void {
    const editor = requiredElement<HTMLElement>(root, "[data-menu-editor]");
    const archived = requiredElement<HTMLElement>(root, "[data-archived-list]");
    const editorFragment = document.createDocumentFragment();
    const archivedFragment = document.createDocumentFragment();
    let activeCount = 0;
    let archivedCount = 0;

    for (const category of state?.categories ?? []) {
      const activeItems = category.items.filter((item) => !item.archivedAt);
      if (activeItems.length > 0) {
        activeCount += activeItems.length;
        const group = createCategoryGroup(category, activeItems.length);
        for (const item of activeItems) group.append(createItemEditor(item, category));
        editorFragment.append(group);
      }

      for (const item of category.items.filter((entry) => Boolean(entry.archivedAt))) {
        archivedCount += 1;
        archivedFragment.append(createArchivedRow(item, category));
      }
    }

    editor.replaceChildren(activeCount > 0 ? editorFragment : createEmpty("Todavía no hay sabores activos."));
    archived.replaceChildren(
      archivedCount > 0 ? archivedFragment : createEmpty("No hay sabores eliminados."),
    );
  }

  function createCategoryGroup(category: AdminMenuCategory, count: number): HTMLElement {
    const group = document.createElement("section");
    group.className = "admin-category-group";
    const heading = document.createElement("div");
    heading.className = "admin-category-group__heading";
    const title = document.createElement("h3");
    title.textContent = category.title;
    const total = document.createElement("span");
    total.textContent = `${count} ${count === 1 ? "sabor" : "sabores"}`;
    heading.append(title, total);
    group.append(heading);
    return group;
  }

  function createAvailabilityRow(item: AdminMenuItem): HTMLElement {
    const row = document.createElement("div");
    row.className = "admin-availability-row";
    const name = document.createElement("span");
    name.className = "admin-availability-row__name";
    const strong = document.createElement("strong");
    const small = document.createElement("small");
    strong.textContent = item.name;
    small.textContent = item.description || "Sin descripción";
    name.append(strong, small);

    const label = document.createElement("label");
    label.className = "admin-checkbox-label";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = item.availability.available;
    checkbox.dataset.action = "availability";
    checkbox.dataset.itemId = item.id;
    checkbox.dataset.itemName = item.name;
    checkbox.setAttribute("aria-label", `${item.name}: disponible`);
    const status = document.createElement("span");
    status.dataset.availabilityLabel = "";
    label.append(checkbox, status);
    row.append(name, label);
    updateAvailabilityLabel(checkbox);
    return row;
  }

  function createItemEditor(item: AdminMenuItem, category: AdminMenuCategory): HTMLElement {
    const details = document.createElement("details");
    details.className = "admin-menu-item";
    details.dataset.editorItem = item.id;

    const summary = document.createElement("summary");
    const name = document.createElement("span");
    const prices = document.createElement("small");
    name.textContent = item.name;
    prices.className = "price-figures";
    prices.textContent = category.priceKinds
      .map((kind) => `${priceKindLabels[kind]} ${formatArs(item.prices[kind] ?? 0)}`)
      .join(" · ");
    summary.append(name, prices);

    const form = document.createElement("form");
    form.className = "admin-form admin-item-form";
    form.dataset.form = "edit-item";
    form.dataset.itemId = item.id;
    form.noValidate = true;
    form.append(
      createTextField(`item-${item.id}-name`, "Nombre", "name", item.name, 80, true),
      createTextareaField(
        `item-${item.id}-description`,
        "Descripción (opcional)",
        "description",
        item.description,
        320,
      ),
      createPriceFieldset(item.id, category.priceKinds, item.prices),
    );

    const actions = document.createElement("div");
    actions.className = "admin-item-actions";
    const save = createButton("Guardar cambios", "admin-button admin-button--primary", "submit");
    save.dataset.busyLabel = "Guardando…";
    const archive = createButton("Eliminar sabor", "admin-button admin-button--danger", "button");
    archive.dataset.action = "archive-item";
    archive.dataset.itemId = item.id;
    archive.dataset.busyLabel = "Eliminando…";
    actions.append(save, archive);
    form.append(actions);
    details.append(summary, form);
    return details;
  }

  function createArchivedRow(item: AdminMenuItem, category: AdminMenuCategory): HTMLElement {
    const row = document.createElement("div");
    row.className = "admin-archived-row";
    const copy = document.createElement("div");
    const name = document.createElement("strong");
    const detail = document.createElement("p");
    name.textContent = item.name;
    detail.className = "admin-muted";
    detail.textContent = `${category.title} · Eliminado ${formatDateTime(item.archivedAt)}`;
    copy.append(name, detail);
    const restore = createButton("Restaurar", "admin-button admin-button--secondary", "button");
    restore.dataset.action = "restore-item";
    restore.dataset.itemId = item.id;
    restore.dataset.busyLabel = "Restaurando…";
    row.append(copy, restore);
    return row;
  }

  function createPriceFieldset(
    itemId: string,
    kinds: readonly PriceKind[],
    prices: Partial<Record<PriceKind, number>>,
  ): HTMLFieldSetElement {
    const fieldset = document.createElement("fieldset");
    fieldset.className = "admin-prices";
    const legend = document.createElement("legend");
    legend.textContent = "Precios";
    const hint = document.createElement("p");
    hint.className = "admin-field__hint";
    hint.textContent = "Importes enteros en pesos argentinos, sin puntos ni signo $.";
    const fields = document.createElement("div");
    fields.className = "admin-price-fields";
    for (const kind of kinds) fields.append(createPriceField(itemId, kind, prices[kind]));
    fieldset.append(legend, hint, fields);
    return fieldset;
  }

  function createPriceField(prefix: string, kind: PriceKind, amount?: number): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "admin-price-field";
    const id = `${prefix}-price-${kind}`;
    const label = document.createElement("label");
    label.htmlFor = id;
    label.textContent = priceKindLabels[kind];
    const input = document.createElement("input");
    input.id = id;
    input.name = `price_${kind}`;
    input.type = "text";
    input.inputMode = "numeric";
    input.pattern = "[0-9]+";
    input.autocomplete = "off";
    input.required = true;
    input.value = typeof amount === "number" ? String(amount) : "";
    input.className = "price-figures";
    const error = document.createElement("p");
    error.id = `${id}-error`;
    error.className = "admin-field__error";
    error.dataset.errorFor = `price_${kind}`;
    input.setAttribute("aria-describedby", error.id);
    wrapper.append(label, input, error);
    return wrapper;
  }

  function createTextField(
    id: string,
    labelText: string,
    name: string,
    value: string,
    maxLength: number,
    required: boolean,
  ): HTMLElement {
    const field = document.createElement("div");
    field.className = "admin-field";
    const label = document.createElement("label");
    label.htmlFor = id;
    label.textContent = labelText;
    const input = document.createElement("input");
    input.id = id;
    input.name = name;
    input.type = "text";
    input.maxLength = maxLength;
    input.required = required;
    input.value = value;
    const error = document.createElement("p");
    error.id = `${id}-error`;
    error.className = "admin-field__error";
    error.dataset.errorFor = name;
    input.setAttribute("aria-describedby", error.id);
    field.append(label, input, error);
    return field;
  }

  function createTextareaField(
    id: string,
    labelText: string,
    name: string,
    value: string,
    maxLength: number,
  ): HTMLElement {
    const field = document.createElement("div");
    field.className = "admin-field";
    const label = document.createElement("label");
    label.htmlFor = id;
    label.textContent = labelText;
    const textarea = document.createElement("textarea");
    textarea.id = id;
    textarea.name = name;
    textarea.rows = 3;
    textarea.maxLength = maxLength;
    textarea.value = value;
    const meta = document.createElement("div");
    meta.className = "admin-field__meta";
    const error = document.createElement("p");
    error.id = `${id}-error`;
    error.className = "admin-field__error";
    error.dataset.errorFor = name;
    textarea.setAttribute("aria-describedby", error.id);
    const counter = document.createElement("span");
    counter.dataset.counterFor = id;
    counter.textContent = `${value.length}/${maxLength}`;
    meta.append(error, counter);
    field.append(label, textarea, meta);
    return field;
  }

  function validateItemForm(
    form: HTMLFormElement,
    values: ItemFormValues,
    priceKinds: readonly PriceKind[],
  ): boolean {
    clearFormErrors(form);
    const errors = validateItemValues(values, priceKinds);
    applyItemErrors(form, errors);
    if (hasItemFormErrors(errors)) {
      focusFirstInvalid(form);
      return false;
    }
    return true;
  }

  function validateField(field: HTMLInputElement | HTMLTextAreaElement): void {
    const form = field.form;
    if (!form) return;
    const itemId = form.dataset.itemId;
    const category = itemId
      ? findCategory(findItem(itemId)?.categoryCode)
      : findCategory(formString(form, "category_code"));
    if (!category) return;
    const values = readItemForm(form, category.priceKinds);
    const errors = validateItemValues(values, category.priceKinds);
    const fieldName = field.name;
    if (fieldName === "name") setFieldError(form, fieldName, errors.name ?? "");
    else if (fieldName === "description") {
      setFieldError(form, fieldName, errors.description ?? "");
    } else if (fieldName.startsWith("price_")) {
      const kind = fieldName.replace("price_", "") as PriceKind;
      setFieldError(form, fieldName, errors.prices?.[kind] ?? "");
    }
  }

  function readItemForm(form: HTMLFormElement, kinds: readonly PriceKind[]): ItemFormValues {
    return {
      name: formString(form, "name"),
      description: formString(form, "description"),
      prices: Object.fromEntries(
        kinds.map((kind) => [kind, Number(formString(form, `price_${kind}`))]),
      ),
    };
  }

  function applyItemErrors(form: HTMLFormElement, errors: ItemFormErrors): void {
    setFieldError(form, "name", errors.name ?? "");
    setFieldError(form, "description", errors.description ?? "");
    for (const kind of Object.keys(errors.prices ?? {}) as PriceKind[]) {
      setFieldError(form, `price_${kind}`, errors.prices?.[kind] ?? "");
    }
  }

  function setFieldError(form: HTMLFormElement, fieldName: string, message: string): void {
    const field = form.elements.namedItem(fieldName);
    if (field instanceof HTMLElement) {
      if (message) field.setAttribute("aria-invalid", "true");
      else field.removeAttribute("aria-invalid");
    }
    const error = Array.from(form.querySelectorAll<HTMLElement>("[data-error-for]"))
      .find((element) => element.dataset.errorFor === fieldName);
    if (error) error.textContent = message;
  }

  function clearFormErrors(form: HTMLFormElement): void {
    for (const field of form.querySelectorAll<HTMLElement>("[aria-invalid]")) {
      field.removeAttribute("aria-invalid");
    }
    for (const error of form.querySelectorAll<HTMLElement>("[data-error-for]")) {
      error.textContent = "";
    }
  }

  function focusFirstInvalid(form: HTMLFormElement): boolean {
    const field = form.querySelector<HTMLElement>('[aria-invalid="true"]');
    field?.focus();
    return Boolean(field);
  }

  async function runBusy<T>(
    control: HTMLElement,
    action: () => Promise<T>,
    relatedScope?: HTMLElement | null,
  ): Promise<T> {
    const button = control instanceof HTMLButtonElement
      ? control
      : control.querySelector<HTMLButtonElement>('button[type="submit"]');
    const originalButtonText = button?.textContent ?? "";
    const busyContainers = [...new Set([control, relatedScope].filter(Boolean) as HTMLElement[])];
    const controls = [...new Set(busyContainers.flatMap((container) => [
      ...(container.matches("input, button, select, textarea")
        ? [container as HTMLInputElement | HTMLButtonElement | HTMLSelectElement | HTMLTextAreaElement]
        : []),
      ...container.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement | HTMLTextAreaElement>(
        "input, button, select, textarea",
      ),
    ]))];
    for (const container of busyContainers) container.setAttribute("aria-busy", "true");
    for (const item of controls) item.disabled = true;
    if (button?.dataset.busyLabel) button.textContent = button.dataset.busyLabel;

    try {
      return await action();
    } finally {
      for (const container of busyContainers) container.removeAttribute("aria-busy");
      for (const item of controls) item.disabled = false;
      if (button) button.textContent = originalButtonText;
    }
  }

  function showView(name: string, focus = true): void {
    for (const [viewName, view] of views) view.hidden = viewName !== name;
    if (!focus) return;
    window.requestAnimationFrame(() => {
      views.get(name)?.querySelector<HTMLElement>("input, button, select, textarea, a")?.focus();
    });
  }

  function announce(message: string, tone: MessageTone): void {
    liveRegion.textContent = message;
    liveRegion.dataset.tone = tone;
    if (tone === "error") liveRegion.setAttribute("role", "alert");
    else liveRegion.removeAttribute("role");
  }

  function clearAnnouncement(): void {
    liveRegion.textContent = "";
    delete liveRegion.dataset.tone;
    liveRegion.removeAttribute("role");
  }

  function handleError(error: unknown): void {
    const message = error instanceof Error
      ? error.message
      : "Ocurrió un error inesperado. Intentá de nuevo.";
    announce(message, "error");
    if (error instanceof AdminApiError && error.kind === "auth") {
      session.clear();
      state = null;
      showView("login");
    } else if (message.startsWith("La sesión expiró")) {
      session.clear();
      state = null;
      showView("login");
    }
  }

  function findItem(itemId: string | undefined): AdminMenuItem | null {
    if (!itemId) return null;
    for (const category of state?.categories ?? []) {
      const item = category.items.find((entry) => entry.id === itemId);
      if (item) return item;
    }
    return null;
  }

  function findCategory(categoryCode: string | undefined): AdminMenuCategory | null {
    if (!categoryCode) return null;
    return state?.categories.find((category) => category.code === categoryCode) ?? null;
  }

  function focusEditorTarget(focus: string | undefined): void {
    if (!focus) return;
    if (focus === "create") {
      const panel = root.querySelector<HTMLDetailsElement>("[data-create-panel]");
      if (panel) panel.open = true;
      panel?.querySelector<HTMLElement>("input, select")?.focus();
      return;
    }
    if (focus === "archived") {
      root.querySelector<HTMLButtonElement>('[data-archived-list] [data-action="restore-item"]')?.focus();
      return;
    }
    if (focus.startsWith("item:")) {
      const details = Array.from(root.querySelectorAll<HTMLDetailsElement>("[data-editor-item]"))
        .find((entry) => entry.dataset.editorItem === focus.slice(5));
      if (details) details.open = true;
      details?.querySelector<HTMLElement>("summary")?.focus();
    }
  }

  function setText(selector: string, text: string): void {
    const element = root.querySelector<HTMLElement>(selector);
    if (element) element.textContent = text;
  }
}

function requiredElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing admin element: ${selector}`);
  return element;
}

function createButton(text: string, className: string, type: "button" | "submit"): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = type;
  button.className = className;
  button.textContent = text;
  return button;
}

function createEmpty(message: string): HTMLElement {
  const paragraph = document.createElement("p");
  paragraph.className = "admin-empty";
  paragraph.textContent = message;
  return paragraph;
}

function formString(form: HTMLFormElement, name: string): string {
  const value = new FormData(form).get(name);
  return typeof value === "string" ? value : "";
}

function emailInput(form: HTMLFormElement, name: string): HTMLInputElement | null {
  const input = form.elements.namedItem(name);
  return input instanceof HTMLInputElement ? input : null;
}

function updateCounter(textarea: HTMLTextAreaElement): void {
  const counter = document.querySelector<HTMLElement>(`[data-counter-for="${textarea.id}"]`);
  if (counter) counter.textContent = `${textarea.value.length}/${textarea.maxLength}`;
}

function updateAvailabilityLabel(input: HTMLInputElement): void {
  const label = input.closest("label")?.querySelector<HTMLElement>("[data-availability-label]");
  if (label) label.textContent = input.checked ? "Disponible" : "Agotado";
  input.setAttribute(
    "aria-label",
    `${input.dataset.itemName ?? "Sabor"}: ${input.checked ? "disponible" : "agotado"}`,
  );
}

function shouldRefreshAfterResult(result: RpcResult): boolean {
  return result.message.startsWith("stale_")
    || result.message === "menu_item_not_found"
    || result.message === "menu_item_archived";
}

function businessTone(status: BusinessStatus): MessageTone {
  if (status === "accepting_orders") return "success";
  if (status === "paused") return "warning";
  if (status === "sold_out") return "error";
  return "info";
}

function publicationSummaryText(view: ReturnType<typeof publicationView>): string {
  return {
    published: "Publicada",
    pending: "Cambios pendientes",
    requested: "Publicación solicitada",
    failed: "Publicación fallida",
    unknown: "Sin datos",
  }[view];
}

function publicationTone(view: ReturnType<typeof publicationView>): MessageTone {
  if (view === "published") return "success";
  if (view === "pending" || view === "requested") return "warning";
  if (view === "failed") return "error";
  return "info";
}

function publicationCopy(view: ReturnType<typeof publicationView>): [string, string] {
  return {
    published: [
      "La carta está publicada",
      "Los sabores, descripciones y precios coinciden con esta versión del panel.",
    ],
    pending: [
      "Hay cambios pendientes",
      "Guardaste cambios editoriales. Solicitá una publicación para llevarlos al menú público.",
    ],
    requested: [
      "Publicación solicitada",
      "Vercel recibió una solicitud, pero la versión publicada sigue siendo la confirmación final. Si no se actualiza, podés volver a publicar; el servidor controla la espera segura.",
    ],
    failed: [
      "La publicación anterior falló",
      "Los cambios siguen guardados y podés volver a solicitar la publicación.",
    ],
    unknown: [
      "No pudimos comparar versiones",
      "Actualizá el panel antes de publicar cambios.",
    ],
  }[view] as [string, string];
}
