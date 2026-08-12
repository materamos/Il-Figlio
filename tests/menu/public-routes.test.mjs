import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const readSource = (relativePath) => readFile(path.join(root, relativePath), "utf8");

test("the landing links to the separate carta route and migrates the legacy hash", async () => {
  const [landing, redirectScript, businessStatus, globalCss] = await Promise.all([
    readSource("src/pages/index.astro"),
    readSource("public/scripts/legacy-carta-redirect.js"),
    readSource("src/components/BusinessStatus.astro"),
    readSource("src/styles/global.css"),
  ]);

  assert.match(landing, /href="\/carta\/">Ver la carta/);
  assert.match(landing, /import BusinessStatus/);
  assert.match(landing, /<BusinessStatus/);
  assert.match(landing, /legacy-carta-redirect\.js/);
  assert.match(redirectScript, /window\.location\.hash === "#carta"/);
  assert.match(redirectScript, /window\.location\.replace\("\/carta\/"\)/);
  assert.match(landing, /<footer class="site-footer">/);
  assert.match(landing, /<section class="contact-section"/);
  assert.match(landing, /aria-label={`Llamar a Il Figlio al \${/);
  assert.match(landing, /<p class="hero__lede">{ilFiglioBusiness\.description}<\/p>/);
  assert.doesNotMatch(landing, /hero__lede[\s\S]{0,120}hours\.display/);
  assert.match(businessStatus, /{openingHours}\. {status\.message \|\| current\.detail}/);
  assert.doesNotMatch(globalCss, /html\s*{[^}]*min-width:/);
  assert.match(globalCss, /\.site-header\s*{[^}]*flex-wrap: wrap/);
  assert.match(globalCss, /@media \(max-width: 22rem\)/);
  assert.match(globalCss, /\.contact-list a:active/);
  assert.doesNotMatch(landing, /<MenuSection/);
  assert.doesNotMatch(landing, /Supabase|supabase|menu-runtime-state/);
});

test("the carta route owns the public menu and the legacy menu URL redirects there", async () => {
  const [carta, vercel] = await Promise.all([
    readSource("src/pages/carta/index.astro"),
    readSource("vercel.json"),
  ]);

  assert.match(carta, /import MenuSection/);
  assert.match(carta, /import BusinessStatus/);
  assert.match(carta, /<BusinessStatus/);
  assert.match(carta, /class="menu-whatsapp-button"/);
  assert.match(carta, /href={whatsappHref}/);
  assert.doesNotMatch(carta, /<footer class="site-footer">/);
  assert.doesNotMatch(carta, /<section class="contact-section"/);
  assert.match(carta, /href="\/" aria-label="Il Figlio, volver al inicio"/);
  assert.match(vercel, /"source": "\/menu"[\s\S]*?"destination": "\/carta\/"/);
  assert.match(vercel, /"source": "\/menu\/"[\s\S]*?"destination": "\/carta\/"/);
  assert.doesNotMatch(carta, /Supabase|supabase|menu-runtime-state|data-availability/);
});

test("the not-found route keeps the branded recovery path minimal", async () => {
  const [notFound, globalCss] = await Promise.all([
    readSource("src/pages/404.astro"),
    readSource("src/styles/global.css"),
  ]);

  assert.match(notFound, /bodyClass="not-found-body"/);
  assert.match(notFound, /aria-label="Il Figlio, volver al inicio"/);
  assert.match(notFound, /class="not-found__number" aria-hidden="true">404<\/p>/);
  assert.doesNotMatch(notFound, /class="not-found__mark"/);
  assert.match(notFound, /<p>Lanús Oeste<\/p>/);
  assert.match(notFound, /href="\/carta\/">Ver la carta/);
  assert.doesNotMatch(notFound, /<style>/);
  assert.match(globalCss, /\.not-found-page\s*{/);
  assert.doesNotMatch(globalCss, /\.not-found__mark\s*{/);
});

test("publication metadata is generated from the same immutable menu snapshot", async () => {
  const publicationRoute = await readSource("src/pages/publication.json.ts");

  assert.match(publicationRoute, /loadPublishedMenu/);
  assert.match(publicationRoute, /schemaVersion:\s*1/);
  assert.match(publicationRoute, /revision:\s*snapshot\.content\.revision/);
  assert.match(publicationRoute, /sourceHash:\s*snapshot\.sourceHash/);
  assert.match(publicationRoute, /builtAt:/);
});

test("the retired browser admin and runtime availability script no longer exist", async () => {
  await assert.rejects(
    () => access(path.join(root, "src/pages/admin/index.astro")),
    (error) => error?.code === "ENOENT",
  );
  await assert.rejects(
    () => access(path.join(root, "public/scripts/menu-runtime-state.js")),
    (error) => error?.code === "ENOENT",
  );
});
