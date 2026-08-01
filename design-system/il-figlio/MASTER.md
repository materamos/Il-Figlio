# Il Figlio — Design System

This file is the visual source of truth for the public QR menu. Page-specific files under `pages/` may only override density and interaction patterns; brand color and typography remain shared.

## Direction

- Product: neighborhood family pizzeria, QR-first menu, WhatsApp handoff.
- Style: quiet editorial minimalism with a traditional Italian-food character.
- Principles: one clear action, readable prices, generous whitespace, no decorative clutter.
- Avoid: gradients, glass effects, playful illustrations, excessive cards, black/red backgrounds covering large areas, decorative motion, emoji icons.

## Brand palette

The supplied logo contains exact `#FF0000` red on white. Pure red does not reach 4.5:1 against white for normal text, so it is reserved for the logo, large display text, rules, and decorative emphasis. Interactive controls use a darker derived red.

| Role | Value | Token | Usage |
| --- | --- | --- | --- |
| Brand red | `#FF0000` | `--color-brand` | Logo, large accents, decorative rules |
| Action red | `#B80000` | `--color-action` | Buttons, links, focus accents |
| Action hover | `#970000` | `--color-action-hover` | Hover/pressed action state |
| Canvas | `#FFFFFF` | `--color-canvas` | Main background |
| Warm surface | `#FFF9F7` | `--color-surface` | Soft section grouping |
| Ink | `#171717` | `--color-ink` | Primary text |
| Muted ink | `#66615F` | `--color-muted-ink` | Secondary text |
| Border | `#E7E1DE` | `--color-border` | Dividers and input borders |
| Disabled | `#A39D99` | `--color-disabled` | Disabled text only |

Never communicate availability only with red. Always pair color with explicit text and an icon or shape.

## Typography

- Display and headings: Playfair Display, locally hosted; fallback `Georgia, 'Times New Roman', serif`.
- Body and controls: Karla, locally hosted; fallback `Arial, Helvetica, sans-serif`.
- Prices use tabular figures.
- Minimum public body size: 16px.
- Body line height: 1.6.
- Long copy max width: 65 characters.

Type scale:

| Role | Size |
| --- | --- |
| Display | `clamp(3rem, 13vw, 7.5rem)` |
| H1 | `clamp(2.5rem, 9vw, 5.5rem)` |
| H2 | `clamp(2rem, 7vw, 3.75rem)` |
| H3 | `clamp(1.25rem, 4vw, 1.625rem)` |
| Body | `1rem` |
| Small | `0.875rem` |

## Spacing and layout

Use a 4px base with an 8px dominant rhythm.

| Token | Value |
| --- | --- |
| `--space-1` | 4px |
| `--space-2` | 8px |
| `--space-3` | 12px |
| `--space-4` | 16px |
| `--space-6` | 24px |
| `--space-8` | 32px |
| `--space-12` | 48px |
| `--space-16` | 64px |
| `--space-24` | 96px |

- Mobile-first single-column menu.
- Public content max width: 1120px; menu reading column: 820px.
- Breakpoints to verify: 375, 768, 1024, 1440px.
- No horizontal scrolling or nested scroll regions.
- Fixed/sticky UI must reserve space and safe-area padding.

## Shape and elevation

- Border radius: 0 for editorial rules; 8px for controls; 12px for grouped surfaces.
- Prefer borders and whitespace over shadows.
- Only dialogs may use a subtle shadow and backdrop.
- Menu items are rows, not floating cards.

## Interaction

- Minimum touch target: 44×44px with at least 8px between adjacent controls.
- All clickable elements show pointer cursor and visible focus rings.
- Primary transitions: 180ms ease-out; only opacity, color, and transform.
- Respect `prefers-reduced-motion`.
- Do not hide essential content pending animation or JavaScript.
- One primary CTA per view: WhatsApp publicly, Save/Publish contextually in admin.

## Public page pattern

1. Compact brand header.
2. Direct hero with business status and WhatsApp CTA.
3. Short trust statement.
4. Sticky category index.
5. Menu sections and prices.
6. Ordering rule and contact details.
7. Minimal footer.

## Accessibility gates

- Normal text contrast at least 4.5:1.
- Sequential headings and one H1.
- Skip link and meaningful landmarks.
- Visible labels, not placeholder-only fields.
- Status changes announced with `aria-live`.
- Availability conveyed with text, shape, and color.
- Zoom remains enabled.
- Focus order follows reading order.

## Performance gates

- Locally hosted fonts with `font-display: swap`.
- Responsive logo assets with explicit dimensions.
- Astro components for static structure; plain JavaScript only for runtime state.
- No framework hydration or animation dependency.
- Runtime data reserves layout space and has explicit fallback states.
