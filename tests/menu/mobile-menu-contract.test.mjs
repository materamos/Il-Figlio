import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const readSource = (relativePath) => readFile(path.join(root, relativePath), "utf8");

test("the mobile carta keeps WhatsApp in the sticky header and prices self-labelled", async () => {
  const [carta, menuItem, menuCss] = await Promise.all([
    readSource("src/pages/carta/index.astro"),
    readSource("src/components/MenuItemRow.astro"),
    readSource("src/styles/menu.css"),
  ]);

  assert.match(carta, /class="menu-header__whatsapp"/);
  assert.match(carta, /class="menu-whatsapp-button"/);
  assert.match(menuItem, /class="sr-only menu-item__price-label"/);
  assert.match(menuCss, /\.menu-whatsapp-button\s*{[\s\S]*?display: none;/);
  assert.match(
    menuCss,
    /@media \(min-width: 80rem\)[\s\S]*?\.menu-whatsapp-button\s*{\s*display: grid;/,
  );
  assert.match(
    menuCss,
    /\.menu-item__price \.menu-item__price-label\s*{[\s\S]*?position: static;/,
  );
  assert.match(menuCss, /\.menu-index__link--active\s*{[\s\S]*?background: var\(--color-action\);/);
  assert.match(menuCss, /--menu-index-sticky-offset: 60px/);
});

test("the category index synchronizes deep links and communicates the current location", async () => {
  const stickyScript = await readSource("public/scripts/menu-index-sticky.js");

  assert.match(stickyScript, /link\.setAttribute\("aria-current", "location"\)/);
  assert.match(stickyScript, /const getHashTarget = \(\) =>/);
  assert.match(stickyScript, /const syncLocationHash = \(\) =>/);
  assert.match(stickyScript, /behavior: "auto"/);
  assert.match(stickyScript, /updateHistory: false/);
  assert.match(stickyScript, /window\.addEventListener\("hashchange", syncLocationHash\)/);
  assert.match(stickyScript, /window\.addEventListener\("load", syncPageLocation/);
  assert.match(
    stickyScript,
    /getStickyActivationOffset\(\) \+ menuIndex\.getBoundingClientRect\(\)\.height/,
  );
  assert.doesNotMatch(stickyScript, /let activeTarget = menuSectionTargets\[0\]/);
});
