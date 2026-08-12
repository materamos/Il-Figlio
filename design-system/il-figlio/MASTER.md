# Il Figlio — Public UI Design Contract

- Status: normative contract for the current public UI.
- Last reconciled with source: 2026-08-12.
- Scope: `/`, `/carta/`, and the public `404` page.
- Implementation references: `src/styles/global.css`, `src/styles/menu.css`, `src/layouts/BaseLayout.astro`, `src/pages/`, and `src/components/`.

This document describes the intended public experience. A mismatch listed under **Known unresolved deviations** remains a defect; it is not an approved pattern to repeat.

## Product direction

- Product: neighborhood family pizzeria, QR-first menu, WhatsApp handoff.
- Style: quiet editorial minimalism with a traditional Italian-food character.
- Principles: one clear primary action, readable prices, generous whitespace, and minimal decoration.
- Avoid: gradients, glass effects, playful illustrations, excessive cards, large black or red background fields, decorative motion, and emoji icons.
- Public copy uses concise Rioplatense Spanish. Status and its message come from the published menu snapshot; hours, address, ordering rules, and contact details come from the versioned business data in `src/data/il-figlio-menu.ts`. Neither belongs in this design contract.

## Route contracts

### `/` — Landing and contact

1. Compact brand header with the phone entry point.
2. Direct hero with neighborhood positioning, the Il Figlio name, and the current business status.
3. One primary WhatsApp action and one secondary action to `/carta/`.
4. Contact section with WhatsApp, phone, map, and Instagram.
5. Minimal footer.

The craft statement is integrated into the hero copy; there is no separate trust section. Categories and products do not belong on this route.

### `/carta/` — Menu and ordering context

1. Compact header linking back to `/`.
2. Sticky category index.
3. Menu introduction and current business status.
4. Ordered menu sections for every category that has visible items, with item descriptions and prices. The five supported categories keep their contractual order; an empty category is omitted.
5. Ordering rules.
6. A visible WhatsApp entry point at every viewport width.

The landing contact section and site footer are intentionally not duplicated on `/carta/`.

WhatsApp visibility is a continuous responsive contract:

- Below `48rem` (`768px`): the WhatsApp link is in the sticky menu header; the floating link is hidden.
- From `48rem` upward: the header shows the phone link and the fixed WhatsApp link is visible.

The two links may coexist in the HTML, but exactly one WhatsApp presentation is intended to be visible in each responsive mode.

### `404` — Branded recovery

1. Compact brand header.
2. One `h1` with a concise, menu-related error message.
3. One primary recovery action to `/carta/`.
4. Minimal footer.

The recovery action is an intentional exception to the standard WhatsApp-primary rule because the immediate task is returning the visitor to valid content.

`/publication.json` is operational metadata and has no visual contract.

## Brand asset provenance

The documentary source asset `il-figlio-logotipo-rojo.jpg` contains a dominant solid red sampled as `#E5322C` on a near-white background. The repository PNG derivatives normalize those fields to exact `#FF0000` on `#FFFFFF`.

That normalization is inherited implementation history. The repository contains no recorded brand approval establishing `#FF0000` as a newly approved canonical red. Until approval exists:

- preserve the current repository assets and `--color-brand` for compatibility;
- describe the transformation as inherited and unconfirmed;
- do not recolor the source asset or infer a new brand decision from the PNG conversion;
- update the documentary asset, repository derivatives, tokens, and this contract together if a canonical red is later approved.

Both sampled reds are below `4.5:1` against white for normal text. The current UI red therefore remains restricted to the logo, large display text, rules, and decorative emphasis.

Public asset roles:

- `public/brand/il-figlio-mark-256.png`: visible UI mark through `BrandMark.astro`.
- `public/brand/il-figlio-mark.png`: social image, favicon, and touch icon source.
- Visible brand images remain decorative when an adjacent accessible name already identifies Il Figlio.
- Square dimensions must always be reserved to prevent layout shift.

## Color system

### Core tokens

| Role | Value | Token | Usage |
| --- | --- | --- | --- |
| Current UI brand red | `#FF0000` | `--color-brand` | Repository logo, large display accents, decorative rules |
| Action red | `#B80000` | `--color-action` | Primary buttons, links, and focus rings |
| Action hover | `#970000` | `--color-action-hover` | Hover and pressed action state |
| Canvas | `#FFFFFF` | `--color-canvas` | Main background |
| Warm surface | `#FFF9F7` | `--color-surface` | Soft section grouping |
| Ink | `#171717` | `--color-ink` | Primary text |
| Muted ink | `#66615F` | `--color-muted-ink` | Secondary text |
| Border | `#E7E1DE` | `--color-border` | Dividers and control borders |
| Disabled | `#A39D99` | `--color-disabled` | Disabled text only |

### Semantic tokens and platform color

| Role | Value | Token or source | Current public use |
| --- | --- | --- | --- |
| Success | `#166534` | `--color-success` | Open business status |
| Warning | `#8A4B08` | `--color-warning` | Reserved semantic state |
| Error | `#9F1239` | `--color-error` | Reserved semantic state |
| Information | `#334155` | `--color-info` | Closed business status |
| WhatsApp | `#25D366` | Platform color in `menu.css` | Menu WhatsApp controls |

Never communicate business status only with color. Pair it with explicit text and the status marker. Do not use `--color-brand` for normal-size text on white.

## Typography

- Display family: Playfair Display Variable, locally hosted; fallback `Georgia, 'Times New Roman', serif`.
- Body and control family: Karla Variable, locally hosted; fallback `Arial, Helvetica, sans-serif`.
- Both families use `font-display: swap`.
- Default public body size is `1rem` with `1.6` line height.
- Default `h1`, `h2`, and `h3` use Playfair Display at weight `650` and line height `1.05`.
- Menu item names are the deliberate heading exception: semantic `h3` elements rendered in Karla at weight `750` for dense price-row scanning.
- Prices use tabular figures.

Current role scale:

| Role | Size |
| --- | --- |
| Landing display | `clamp(3.5rem, 17vw, 8.5rem)` |
| Standard page `h1` | `clamp(2.5rem, 9vw, 5.5rem)` |
| Carta introduction | `clamp(2.5rem, 9vw, 5rem)` |
| Contact title | `clamp(2.25rem, 8vw, 4.25rem)` |
| Menu section title | `clamp(2rem, 7vw, 3.25rem)` |
| Menu item name | `clamp(1.1rem, 3.8vw, 1.25rem)` |
| Body | `1rem` |
| Small controls and footer | `0.875rem` |
| Eyebrows and compact metadata | `0.75rem` to `0.78rem` |

Long copy remains constrained by its component: hero and status copy use at most `38rem`, menu introduction uses `34rem`, and menu item descriptions use `39rem`.

## Spacing, width, and shape

Use a `4px` base with an `8px` dominant rhythm.

| Token | Value |
| --- | --- |
| `--space-1` | `0.25rem` / `4px` |
| `--space-2` | `0.5rem` / `8px` |
| `--space-3` | `0.75rem` / `12px` |
| `--space-4` | `1rem` / `16px` |
| `--space-6` | `1.5rem` / `24px` |
| `--space-8` | `2rem` / `32px` |
| `--space-12` | `3rem` / `48px` |
| `--space-16` | `4rem` / `64px` |
| `--space-24` | `6rem` / `96px` |

- Public content maximum width: `70rem` / `1120px`.
- Below `48rem`, the menu reading column is capped at `51.25rem` / `820px` with `1rem` side gutters.
- From `48rem`, menu content follows the full public width with `2rem` side gutters.
- Editorial rules have no radius.
- Standard controls use `--radius-control` (`0.5rem`).
- Grouped surfaces use `--radius-panel` (`0.75rem`).
- Category pills and WhatsApp controls are intentionally fully rounded.
- Menu items are rows separated by rules, not floating cards.

## Responsive modes

| Mode | Width | Required behavior |
| --- | --- | --- |
| Narrow mobile | Up to approximately `22rem` | Hide the header wordmark when necessary and reduce the carta title |
| Mobile | Below `48rem` | Sticky `60px` menu header, header WhatsApp, horizontally scrollable category index, self-labelled price columns |
| Tablet | `48rem` to below `56rem` | Wider gutters, wrapped category index, full-width menu layout, fixed WhatsApp |
| Desktop | `56rem` and above | Desktop sticky-index composition with brand mark when stuck, fixed WhatsApp |

Required verification widths are `320`, `375`, `768`, `896`, `1024`, `1280`, and `1440px`. The CTA continuity boundary at `768px` is mandatory.

## Scroll and sticky behavior

- The document itself must not scroll horizontally.
- The mobile category index is the one deliberate nested-scroll exception: it scrolls horizontally, uses proximity snapping, hides the visual scrollbar, and keeps all category links keyboard reachable.
- The active category uses `aria-current="location"` and is centered when the index overflows.
- The mobile menu header reserves `60px`; the category index sticks below it.
- Section targets reserve the combined sticky height through scroll offsets and `scroll-margin-top`.
- Fixed WhatsApp positioning includes bottom and inline safe-area insets.
- Essential menu content and navigation remain present without JavaScript; the script enhances sticky state, active category, and offset-aware scrolling.

## Business status

| Status | Visible label | Tone |
| --- | --- | --- |
| `open` | Estamos tomando pedidos | `--color-success` |
| `closed` | Ahora estamos cerrados | `--color-info` |
| `sold_out` | Producción agotada por hoy | `--color-action` |

- Every status includes visible text, supporting detail, color, and the circular marker.
- Status is incorporated into static HTML at build time and reserves stable layout space.
- A static initial status does not require `aria-live`.
- If status ever changes in the browser without navigation, the update must use an appropriately scoped live region and be tested with assistive technology.

## Interaction, focus, and targets

- Interactive targets are at least `44×44px`, with at least `8px` between adjacent controls.
- Clickable elements show a pointer cursor and a visible `:focus-visible` ring.
- Focus order follows DOM reading order.
- Links with icon-only presentations require an explicit accessible name.
- The sticky category index must support direct hashes, history updates, and `aria-current` without hiding menu content.
- Zoom remains enabled; do not add restrictive viewport scaling.

## Motion and elevation

- Standard CSS transitions use `--transition-fast`: `180ms ease-out`.
- Prefer color, background-color, border-color, opacity, and transform transitions.
- The sticky desktop index uses a purposeful `220ms` transform/opacity animation to preserve spatial continuity when it changes composition.
- The WhatsApp active state currently uses `filter`; do not extend that exception to unrelated components.
- Respect `prefers-reduced-motion` in both CSS and JavaScript. Essential content must never wait for animation.
- Borders and whitespace provide normal separation. Do not add shadows to menu rows or grouped surfaces.
- The fixed WhatsApp action is the only current public elevation exception; its shadow separates the overlay from menu content.

## Accessibility gates

- Normal-size text contrast is at least `4.5:1`; large text is at least `3:1`.
- Functional graphics and necessary control boundaries target at least `3:1` against adjacent colors.
- Each route has one `h1` and sequential heading levels.
- Every page has a working skip link and meaningful `main`, navigation, header, and footer semantics where applicable.
- Visible labels are required for any future form controls; placeholders cannot act as labels.
- Business status is understandable without color.
- Focus remains visible and ordered at all responsive modes.
- Reflow must remain usable at `400%` zoom without document-level horizontal scrolling.

## Performance and implementation gates

- Fonts are locally hosted and use `font-display: swap`.
- Visible logos use the repository PNG derivative and reserve a square aspect ratio. `BrandMark.astro` currently serves the 256 px file while declaring its intrinsic dimensions as square; any future larger rendered use must introduce an appropriate source or responsive image contract.
- Astro components provide static structure.
- Plain JavaScript is limited to local navigation enhancement and the legacy `/#carta` redirect.
- Do not add framework hydration or an animation dependency for the public routes.
- Business status and menu content remain build-time HTML.

## Known unresolved deviations

These are open defects, not accepted exceptions and not examples for new work:

1. `::selection` currently renders white normal-size text on `#FF0000`, approximately `4.00:1`, below the `4.5:1` gate.
2. The white WhatsApp glyph on `#25D366` is approximately `1.98:1`; the functional graphic needs a compliant treatment without silently redefining the brand palette.
3. Public page headers and footers are currently nested inside `main`, so they do not consistently expose global `banner` and `contentinfo` landmarks.

Do not mark these deviations as passed in visual or accessibility verification. Fixes require their own scoped implementation and regression coverage.

## Verification contract

At minimum, verify:

- `/`, `/carta/`, and `404` at every required viewport;
- one visible WhatsApp entry point on `/carta/` below and above `48rem`;
- no document-level horizontal overflow;
- category hashes, active state, and sticky offsets;
- keyboard traversal, focus visibility, skip link, and logical heading order;
- mobile price labels and desktop price-column alignment;
- open, closed, and sold-out status presentations;
- reduced-motion behavior;
- `200%` and `400%` zoom reflow;
- the unresolved contrast and landmark findings remain reported until separately fixed.

Update this contract in the same change whenever a public route, breakpoint, token, type role, component state, or interaction contract changes.
