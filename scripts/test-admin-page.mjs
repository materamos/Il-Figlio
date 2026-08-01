import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../src/pages/admin/index.astro", import.meta.url), "utf8");
const css = await readFile(new URL("../src/styles/admin.css", import.meta.url), "utf8");
const main = await readFile(new URL("../src/admin/main.ts", import.meta.url), "utf8");

test("admin page includes all definitive surfaces and safe fallback states", () => {
  for (const requiredMarker of [
    'data-view="configuration"',
    'data-view="login"',
    'data-view="recovery-request"',
    'data-view="set-password"',
    'data-view="unauthorized"',
    'data-view="dashboard"',
    'id="estado"',
    'id="disponibilidad"',
    'id="carta"',
    'id="publicacion"',
    'id="cuenta"',
  ]) {
    assert.ok(page.includes(requiredMarker), `missing ${requiredMarker}`);
  }
  assert.match(page, /noindex, nofollow, noarchive/);
  assert.match(page, /data-deployed-revision=\{String\(menuContent\.revision\)\}/);
});

test("forms expose labels, busy text, live feedback and confirmation paths", () => {
  assert.doesNotMatch(page, /placeholder="Email|placeholder="Contraseña/);
  assert.match(page, /aria-live="polite"/);
  assert.match(page, /data-busy-label=/);
  assert.match(page, /al menos 10 caracteres/);
  assert.equal((page.match(/minlength="10"/g) ?? []).length, 4);
  assert.match(main, /window\.confirm\(/);
  assert.match(main, /textContent = item\.name/);
  assert.doesNotMatch(main, /innerHTML/);
});

test("admin interaction styles preserve 44px controls and responsive mobile layout", () => {
  assert.match(css, /min-height:\s*2\.75rem/);
  assert.match(css, /@media \(min-width:\s*48rem\)/);
  assert.match(css, /@media \(min-width:\s*64rem\)/);
  assert.match(css, /@media \(max-width:\s*29rem\)/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.doesNotMatch(css, /backdrop-filter/);
  assert.doesNotMatch(css, /overflow-x:\s*auto/);
});

test("async work disables controls and never replaces editor content inside runBusy", () => {
  const runBusyStart = main.indexOf("async function runBusy");
  const runBusyEnd = main.indexOf("function showView", runBusyStart);
  const runBusy = main.slice(runBusyStart, runBusyEnd);
  assert.match(runBusy, /item\.disabled = true/);
  assert.doesNotMatch(runBusy, /replaceChildren|innerHTML|renderEditor/);
});

test("startup network failures leave a usable login instead of a permanent loader", () => {
  const startupCatch = main.slice(
    main.indexOf("async function start"),
    main.indexOf("async function handleSubmit"),
  );
  assert.match(startupCatch, /views\.get\("loading"\)\?\.hidden === false/);
  assert.match(startupCatch, /showView\("login"\)/);
});
