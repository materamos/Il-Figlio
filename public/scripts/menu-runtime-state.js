const normalizeRuntimePayload = (value) => {
  const row = Array.isArray(value) && value.length === 1 ? value[0] : value;
  return row?.get_public_runtime_state ?? row?.state ?? row;
};

export const parseRuntimeState = (rawPayload) => {
  const payload = normalizeRuntimePayload(rawPayload);
  const business = payload?.business;
  const availability = payload?.availability;
  const status = business?.status;
  const message = business?.message ?? "";

  const validAvailability = Array.isArray(availability)
    && availability.every((entry) =>
      entry
      && typeof entry === "object"
      && typeof entry.item_id === "string"
      && typeof entry.available === "boolean"
    );
  const validStatus = ["accepting_orders", "paused", "sold_out", "closed"]
    .includes(status);

  if (
    !payload
    || typeof payload !== "object"
    || Array.isArray(payload)
    || payload.schema_version !== 1
    || !business
    || typeof business !== "object"
    || !validStatus
    || (message !== "" && typeof message !== "string")
    || !validAvailability
  ) {
    throw new Error("Invalid public runtime payload");
  }

  return { availability, message, status };
};

const menuPage = typeof document === "undefined"
  ? null
  : document.querySelector("[data-menu-page]");

if (menuPage) {
  const statusRoot = menuPage.querySelector("[data-business-status]");
  const statusLabel = menuPage.querySelector("[data-business-status-label]");
  const statusDetail = menuPage.querySelector("[data-business-status-detail]");
  const whatsappLinks = menuPage.querySelectorAll("[data-whatsapp-link]");
  const supabaseUrl = menuPage.dataset.supabaseUrl?.replace(/\/$/, "");
  const supabaseAnonKey = menuPage.dataset.supabaseAnonKey;
  const openingHours = menuPage.dataset.openingHours;

  const setStatus = ({ label, detail, tone = "neutral", ordering = true }) => {
    if (statusRoot instanceof HTMLElement) statusRoot.dataset.tone = tone;
    if (statusLabel instanceof HTMLElement) statusLabel.textContent = label;
    if (statusDetail instanceof HTMLElement) statusDetail.textContent = detail;

    whatsappLinks.forEach((link) => {
      if (!(link instanceof HTMLAnchorElement)) return;
      const defaultLabel = link.dataset.defaultLabel;
      const unavailableLabel = link.dataset.unavailableLabel;
      if (!defaultLabel || !unavailableLabel) return;
      const text = link.querySelector("[data-whatsapp-label]");
      if (text instanceof HTMLElement) {
        text.textContent = ordering ? defaultLabel : unavailableLabel;
      }
    });
  };

  const applyAvailability = (entries) => {
    if (!Array.isArray(entries)) return;

    for (const entry of entries) {
      const itemId = entry?.item_id ?? entry?.itemId;
      const available = entry?.available ?? entry?.is_available;
      if (typeof itemId !== "string" || typeof available !== "boolean") continue;

      const item = menuPage.querySelector(`[data-menu-item][data-item-id="${CSS.escape(itemId)}"]`);
      if (!(item instanceof HTMLElement)) continue;

      item.dataset.availability = available ? "available" : "unavailable";
      const label = item.querySelector("[data-availability-label]");
      if (label instanceof HTMLElement) {
        label.textContent = "Agotada";
        label.hidden = available;
      }
    }
  };

  const markAllUnavailable = () => {
    menuPage.querySelectorAll("[data-menu-item]").forEach((item) => {
      if (!(item instanceof HTMLElement)) return;
      item.dataset.availability = "unavailable";
      const label = item.querySelector("[data-availability-label]");
      if (label instanceof HTMLElement) {
        label.textContent = "Agotada";
        label.hidden = false;
      }
    });
  };

  const renderRuntimeState = (rawPayload) => {
    const { availability, message, status } = parseRuntimeState(rawPayload);

    applyAvailability(availability);

    if (status === "sold_out") markAllUnavailable();

    const statuses = {
      accepting_orders: {
        label: "Estamos tomando pedidos",
        detail: message || "Consultá tiempos y modalidad de entrega por WhatsApp.",
        tone: "available",
        ordering: true,
      },
      paused: {
        label: "Pedidos pausados",
        detail: message || "Escribinos para consultar cuándo retomamos.",
        tone: "unavailable",
        ordering: false,
      },
      sold_out: {
        label: "Producción agotada por hoy",
        detail: message || "Podés escribirnos para consultar el próximo día de apertura.",
        tone: "unavailable",
        ordering: false,
      },
      closed: {
        label: "Ahora estamos cerrados",
        detail: message || `${openingHours}. Consultanos por WhatsApp.`,
        tone: "neutral",
        ordering: false,
      },
    };

    setStatus(statuses[status]);
  };

  const loadRuntimeState = async () => {
    if (!supabaseUrl || !supabaseAnonKey) {
      setStatus({
        label: "Disponibilidad a confirmar",
        detail: "La actualización en vivo todavía no está configurada. Consultanos por WhatsApp.",
        tone: "neutral",
        ordering: false,
      });
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 6000);

    try {
      const response = await fetch(`${supabaseUrl}/rest/v1/rpc/get_public_runtime_state`, {
        method: "POST",
        headers: {
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${supabaseAnonKey}`,
          "Content-Type": "application/json",
        },
        body: "{}",
        signal: controller.signal,
      });

      if (!response.ok) throw new Error(`Runtime state returned ${response.status}`);
      renderRuntimeState(await response.json());
    } catch {
      setStatus({
        label: "No pudimos actualizar la disponibilidad",
        detail: "Confirmá productos y tiempos por WhatsApp antes de pedir.",
        tone: "error",
        ordering: false,
      });
    } finally {
      window.clearTimeout(timeout);
    }
  };

  loadRuntimeState();
}
