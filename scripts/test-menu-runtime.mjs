import assert from "node:assert/strict";
import test from "node:test";

import { parseRuntimeState } from "../public/scripts/menu-runtime-state.js";

const validPayload = {
  schema_version: 1,
  business: {
    status: "accepting_orders",
    message: "Tomamos pedidos.",
    updated_at: "2026-08-01T00:00:00Z",
  },
  availability: [
    {
      item_id: "00000000-0000-4000-8000-000000000001",
      available: true,
      updated_at: "2026-08-01T00:00:00Z",
    },
  ],
};

test("the public runtime parser accepts the versioned Supabase contract", () => {
  assert.deepEqual(parseRuntimeState(validPayload), {
    availability: validPayload.availability,
    message: "Tomamos pedidos.",
    status: "accepting_orders",
  });
});

test("the public runtime parser accepts the wrapped PostgREST row shape", () => {
  assert.equal(
    parseRuntimeState([{ get_public_runtime_state: validPayload }]).status,
    "accepting_orders",
  );
});

test("invalid or incomplete runtime responses fail closed", () => {
  assert.throws(() => parseRuntimeState({}), /Invalid public runtime payload/);
  assert.throws(
    () => parseRuntimeState({
      ...validPayload,
      business: { ...validPayload.business, status: "unknown" },
    }),
    /Invalid public runtime payload/,
  );
  assert.throws(
    () => parseRuntimeState({ ...validPayload, availability: [{}] }),
    /Invalid public runtime payload/,
  );
});
