import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const readSource = (relativePath) => readFile(path.join(root, relativePath), "utf8");

const readCssBlock = (source, marker) => {
  const markerIndex = source.indexOf(marker);
  assert.notEqual(markerIndex, -1, `Missing CSS block: ${marker}`);

  const openingBraceIndex = source.indexOf("{", markerIndex);
  assert.notEqual(openingBraceIndex, -1, `Missing opening brace for: ${marker}`);

  let depth = 0;

  for (let index = openingBraceIndex; index < source.length; index += 1) {
    if (source[index] === "{") {
      depth += 1;
    } else if (source[index] === "}") {
      depth -= 1;

      if (depth === 0) {
        return source.slice(openingBraceIndex + 1, index);
      }
    }
  }

  assert.fail(`Missing closing brace for: ${marker}`);
};

test("the carta keeps WhatsApp visible across mobile and tablet layouts and prices self-labelled", async () => {
  const [carta, menuItem, menuCss] = await Promise.all([
    readSource("src/pages/carta/index.astro"),
    readSource("src/components/MenuItemRow.astro"),
    readSource("src/styles/menu.css"),
  ]);
  const mobileCss = readCssBlock(menuCss, "@media (max-width: 47.999rem)");
  const tabletCss = readCssBlock(menuCss, "@media (min-width: 48rem)");

  assert.match(carta, /class="menu-header__whatsapp"/);
  assert.match(carta, /class="menu-whatsapp-button"/);
  assert.match(menuItem, /class="sr-only menu-item__price-label"/);
  assert.match(menuCss, /\.menu-header__whatsapp\s*{\s*display: none;/);
  assert.match(
    mobileCss,
    /\.menu-header__whatsapp\s*{[\s\S]*?display: grid;/,
    "mobile must expose WhatsApp in the sticky header",
  );
  assert.match(menuCss, /\.menu-whatsapp-button\s*{[\s\S]*?display: none;/);
  assert.match(
    tabletCss,
    /\.menu-whatsapp-button\s*{\s*display: grid;/,
    "tablet and wider layouts must expose the floating WhatsApp link",
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
