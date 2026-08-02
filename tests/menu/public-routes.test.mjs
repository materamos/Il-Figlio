import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const readSource = (relativePath) => readFile(path.join(root, relativePath), "utf8");

test("the landing links to the separate carta route and migrates the legacy hash", async () => {
  const landing = await readSource("src/pages/index.astro");

  assert.match(landing, /href="\/carta\/">Ver la carta/);
  assert.match(landing, /window\.location\.hash === "#carta"/);
  assert.match(landing, /window\.location\.replace\("\/carta\/"\)/);
  assert.match(landing, /<footer class="site-footer">/);
  assert.doesNotMatch(landing, /<MenuSection/);
});

test("the carta route owns the public menu and the legacy menu URL redirects there", async () => {
  const [carta, vercel] = await Promise.all([
    readSource("src/pages/carta/index.astro"),
    readSource("vercel.json"),
  ]);

  assert.match(carta, /import MenuSection/);
  assert.match(carta, /data-menu-page/);
  assert.match(carta, /class="menu-whatsapp-button"/);
  assert.match(carta, /href={whatsappHref}/);
  assert.doesNotMatch(carta, /<footer class="site-footer">/);
  assert.match(carta, /href="\/" aria-label="Il Figlio, volver al inicio"/);
  assert.match(vercel, /"source": "\/menu"[\s\S]*?"destination": "\/carta\/"/);
  assert.match(vercel, /"source": "\/menu\/"[\s\S]*?"destination": "\/carta\/"/);
});
