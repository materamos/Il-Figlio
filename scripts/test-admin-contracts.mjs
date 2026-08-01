import assert from "node:assert/strict";
import test from "node:test";

import {
  canRequestPublication,
  isPublicationRetry,
  normalizeAdminState,
  normalizeRpcResult,
  publicationView,
  readAdminConfig,
  resultMessage,
  validateItemValues,
} from "../src/admin/contracts.ts";

const baseState = {
  schema_version: 1,
  authorized: true,
  staff: {
    user_id: "11111111-1111-4111-8111-111111111111",
    email: "admin@example.com",
  },
  content: {
    current_revision: 4,
    last_publish_requested_revision: 3,
    last_publish_requested_at: "2026-08-01T12:00:00Z",
  },
  business: {
    status: "accepting_orders",
    message: null,
    updated_at: "2026-08-01T12:00:00Z",
  },
  categories: [
    {
      code: "classic",
      title: "Pizzas clásicas",
      order_index: 1,
      price_kinds: ["whole", "slice"],
      items: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          category_code: "classic",
          name: "Mozzarella <script>alert(1)</script>",
          description: null,
          order_index: 1,
          version: 2,
          archived_at: null,
          created_at: "2026-08-01T10:00:00Z",
          updated_at: "2026-08-01T11:00:00Z",
          prices: { whole: 14000, slice: 2500 },
          availability: { available: true, updated_at: null },
        },
      ],
    },
  ],
  publish: { latest_request: null },
};

test("normalizes the exact nested admin RPC shape and tolerates nullable fields", () => {
  const state = normalizeAdminState(baseState);

  assert.equal(state.authorized, true);
  assert.equal(state.staff?.email, "admin@example.com");
  assert.equal(state.content?.currentRevision, 4);
  assert.equal(state.business?.message, "");
  assert.equal(state.categories[0]?.priceKinds.join(","), "whole,slice");
  assert.equal(state.categories[0]?.items[0]?.description, "");
  assert.equal(state.categories[0]?.items[0]?.availability.updatedAt, null);
  assert.equal(
    state.categories[0]?.items[0]?.name,
    "Mozzarella <script>alert(1)</script>",
    "untrusted values stay data and are rendered later with textContent",
  );
});

test("unauthorized RPC state cannot leak staff, content, business, or categories", () => {
  const state = normalizeAdminState({
    ...baseState,
    authorized: false,
    staff: baseState.staff,
    content: baseState.content,
    business: baseState.business,
    categories: baseState.categories,
  });

  assert.equal(state.authorized, false);
  assert.equal(state.staff, null);
  assert.equal(state.content, null);
  assert.equal(state.business, null);
  assert.deepEqual(state.categories, []);
});

test("rejects unknown admin snapshot versions", () => {
  assert.throws(
    () => normalizeAdminState({ ...baseState, schema_version: 2 }),
    /versión de datos incompatible/,
  );
});

test("normalizes common mutation responses and cooldown feedback", () => {
  const result = normalizeRpcResult([{
    ok: false,
    changed: false,
    requires_redeploy: true,
    operation: "publish_menu_changes",
    message: "publish_cooldown",
    revision: 4,
    cooldown_seconds_remaining: 37,
  }]);

  assert.equal(result.requiresRedeploy, true);
  assert.equal(result.cooldownSecondsRemaining, 37);
  assert.match(resultMessage(result), /37 segundos/);
});

test("publication truth compares current content against embedded deployed revision", () => {
  const state = normalizeAdminState(baseState);
  assert.equal(publicationView(state, 4), "published");
  assert.equal(publicationView(state, 3), "pending");

  const queued = normalizeAdminState({
    ...baseState,
    publish: {
      latest_request: {
        id: 8,
        content_revision: 4,
        status: "queued",
        message: "publish_reserved",
        hook_status_code: null,
        hook_job_id: null,
        created_at: "2026-08-01T12:10:00Z",
        completed_at: null,
      },
    },
  });
  assert.equal(publicationView(queued, 3), "requested");
  assert.equal(canRequestPublication(queued, 3), false);

  const acceptedByHook = normalizeAdminState({
    ...baseState,
    publish: {
      latest_request: {
        id: 9,
        content_revision: 4,
        status: "succeeded",
        message: "publish_queued",
        hook_status_code: 201,
        hook_job_id: "job-id",
        created_at: "2026-08-01T12:10:00Z",
        completed_at: "2026-08-01T12:10:01Z",
      },
    },
  });
  assert.equal(publicationView(acceptedByHook, 3), "requested");
  assert.equal(canRequestPublication(acceptedByHook, 3), true);
  assert.equal(isPublicationRetry(acceptedByHook, 3), true);
});

test("item validation enforces category-specific integer ARS prices", () => {
  assert.deepEqual(
    validateItemValues(
      { name: "Mozzarella", description: "", prices: { whole: 14000, slice: 2500 } },
      ["whole", "slice"],
    ),
    {},
  );

  const errors = validateItemValues(
    { name: "", description: "x".repeat(321), prices: { whole: 0, slice: 2.5 } },
    ["whole", "slice"],
  );
  assert.ok(errors.name);
  assert.ok(errors.description);
  assert.ok(errors.prices?.whole);
  assert.ok(errors.prices?.slice);
});

test("configuration fallback rejects missing and placeholder browser values", () => {
  assert.equal(readAdminConfig({ dataset: {} }), null);
  assert.equal(readAdminConfig({
    dataset: {
      supabaseUrl: "http://127.0.0.1:54321",
      supabaseAnonKey: "replace-with-local-anon-key",
      deployedRevision: "1",
    },
  }), null);

  assert.deepEqual(readAdminConfig({
    dataset: {
      supabaseUrl: "https://project.supabase.co/",
      supabaseAnonKey: "safe-public-anon-key",
      deployedRevision: "4",
    },
  }), {
    supabaseUrl: "https://project.supabase.co",
    supabaseAnonKey: "safe-public-anon-key",
    deployedRevision: 4,
  });
});
