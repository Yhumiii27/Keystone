# 02 — Design system & visual language

Source of truth for this chapter:

| Source | Path (under `design/`) | What it gives |
|---|---|---|
| Nocturne stylesheet | `_ds/nocturne-08af9e11-fa9b-4d10-b0bf-ef17d330333a/styles.css` | Every token + every component class |
| Nocturne guide | `_ds/nocturne-…/readme.md`, `_ds_manifest.json`, `_adherence.oxlintrc.json` | Usage rules, token kinds, lint rules |
| Prototype template | `_extracted/template-annotated.html` lines 17–3093 (same line numbers as `Keystone PM v8.dc.html`) | All inline-style patterns surveyed below |
| Prototype logic | `Keystone PM v8.dc.html` lines 3095–5242 | Colour/tone helpers (`LO`, `OK`, `seg()`, `chips()`, `shade()`, `*Tag()` …), chart geometry |
| Runtime | `support.js` | x-dc semantics (`sc-if`, `sc-for`, `style-hover`, refs) |
| Image placeholder | `image-slot.js` | `<image-slot>` custom element |
| Map page | `Keystone PM map.html` | d3 world map embedded by the `worldmap` screen |

The survey numbers ("×N") are occurrence counts over template lines 17–3093 (4 369 `style=""` attributes, 70 `style-hover`, 1 `style-focus`).

## Sections covered

| Key | Section | Main sources |
|---|---|---|
| `DS-TOKENS` | Nocturne tokens (colour, ramps, type, spacing, radius, elevation) | `styles.css` `:root` |
| `DS-CLASSES` | Nocturne component classes and their states | `styles.css` components layer, `readme.md` |
| `DS-APP-GLOBALS` | App-level overrides, page background, scrollbars, icon set, fonts | template lines 1–17, `<helmet>` |
| `DS-TONES` | Semantic tone system (mono palette): `LO/OK`, tag tones, status→tag mappings | logic 3135, 3796–4955 |
| `DS-TYPE` | Typography actually used (sizes, weights, tracking, frequencies) | survey |
| `DS-LAYOUT` | Shell grid, page rhythm, grids, z-index scale, responsiveness | template 17–125 |
| `DS-COMPONENTS` | Recurring inline patterns → proposed React component library (props + exact CSS) | survey + line refs |
| `DS-CHARTS` | Charts & data-viz primitives (EVM S-curve, trend, sparkline, column pairs, Gantt, heatmaps, matrices) | template 311–332, 461–471, 506–557, 590–606, 984–1020, 1751–1758, 1801–1811; logic 3818–3857, 4525–4563 |
| `RT-SUPPORT` | `support.js` runtime behaviours the UI relies on | `support.js` |
| `RT-IMAGESLOT` | `<image-slot>` purpose and usages | `image-slot.js`, template 1410, 1650, 1963, 2479 |
| `SCR-WORLDMAP-FRAME` | `Keystone PM map.html` (d3 world map inside the `worldmap` screen) | map file 1–125; logic 5070–5081; template 215–235 |

---

## DS-TOKENS — Nocturne tokens

**Key / scope:** global (`:root`), consumed by every screen and by `Keystone PM map.html`. Dark theme only; there is no light theme and no `prefers-color-scheme` handling anywhere in the prototype.

**Purpose:** a "quiet, compact dark interface: near-neutral blue-grey ground, Inter at medium weight, soft 8px radii and an accent used as a line and a glow rather than a flood" (readme). Mono scheme: one accent voice (blurple), contrast comes from tonal ramps, not saturation.

### Role colours

| Token | Value | Notes |
|---|---|---|
| `--color-bg` | `#161826` | Page ground. Also used as "ink" on accent fills (e.g. check-mark glyph colour, badge text on accent). |
| `--color-surface` | `#232532` | Card / popover / dialog surface. |
| `--color-text` | `#e9e9ed` | Default text. (Manifest lists its kind as `font` — a manifest quirk; treat as colour.) |
| `--color-accent` | `#9184d9` | The single accent (OKLCH hue 289.2, L 0.660, C 0.125). |
| `--color-accent-2` | `#a7a1db` | Machine-derived stand-in; "treat as one role" with accent. Not used by the app. |
| `--color-divider` | `color-mix(in srgb, #e9e9ed 16%, transparent)` ≈ `rgba(233,233,237,.16)` | Hairlines, seg separators, `.input` border. |

### Tonal ramps (OKLCH, shared lightness scale)

| Step | `--color-neutral-*` | `--color-accent-*` | `--color-accent-2-*` |
|---|---|---|---|
| 100 | `#f3f5fe` | `#f5f4ff` | `#f5f4ff` |
| 200 | `#e4e7f5` | `#e7e5fe` | `#e7e5fe` |
| 300 | `#cfd3e5` | `#d2cefd` | `#d2cefd` |
| 400 | `#b2b6ca` | `#b5abfc` | `#b5afe8` |
| 500 | `#9397ab` | `#968ae0` | `#9690c9` |
| 600 | `#75798c` | `#796cbf` | `#7972a9` |
| 700 | `#595d6c` | `#5d5294` | `#5c5783` |
| 800 | `#3f424d` | `#423a6a` | `#423e5d` |
| 900 | `#292b31` | `#2b2741` | `#2b293a` |

Readme guidance: on this dark ground use 700–900 for tinted fills/hovers/subtle borders, 500 as role base, 100–300 for text on tints and pressed states; prefer ramp steps over ad-hoc `color-mix()`. The accent-to-ground pair is ≥3:1 (icons, large text, chrome) — for paragraph-size accent text use `--color-accent-300`.

**Usage frequency in the app** (template `color:` declarations, 1 655 total): `neutral-400` ×771 (secondary text), `accent` ×179, `neutral-500` ×127 (tertiary/empty), `neutral-300` ×124, `text` ×46, `neutral-200` ×29, `accent-300` ×28, `accent-100` ×9, `accent-200` ×8, `neutral-600` ×4, `bg` ×4, plus ~300 bound values. Backgrounds (444): `transparent` ×86, `neutral-900` ×54, `neutral-800` ×47, `accent` ×37, `accent-900` ×21, `surface` ×16, `bg 60%` scrim ×16, `accent-800` ×13. Logic-side colour strings: `text` ×72, `accent-300` ×64, `neutral-300` ×56, `accent` ×53, `neutral-500` ×48, `neutral-400` ×33, `accent-900` ×30, `neutral-700` ×23, `accent-700` ×23.

### Deck-only colours (not interface colours)

| Token | Value |
|---|---|
| `--color-section` | `#262a60` |
| `--color-section-glow` | `#353b80` |
| `--color-section-ghost` | `#4c5397` |

Not used by the app. Readme: only for deck section dividers / landing stat band.

### Typography tokens

| Token | Value |
|---|---|
| `--font-heading` | `"Inter", system-ui, sans-serif` |
| `--font-heading-weight` | `500` |
| `--font-body` | `"Inter", system-ui, sans-serif` |

Inter is loaded from Google Fonts with weights 400;500;600;700 (`@import` at top of `styles.css`); the app uses only 400 and 500 (`font-weight:500` ×148, never 600/700).

Base type (styles.css): `body { font-size:15px; line-height:1.55; font-weight:400 }`; `h1..h6 { line-height:1.12; letter-spacing:-0.015em; margin:0 0 var(--space-2) }`; `h1 42px, h2 32px, h3 25px, h4 20px, h5 16px, h6 13px (letter-spacing .08em, uppercase)`; `p { margin:0 0 var(--space-3) }`; `a { color:accent; text-underline-offset:3px }`; `figcaption 11px, text 55%`; `.text-muted { color: text 55% }` (≈ `rgba(233,233,237,.55)`).

### Spacing (density 0.70× baked in)

| Token | Value | Used by DS classes |
|---|---|---|
| `--space-1` | `2.8px` | `.btn-ghost` inline padding, figcaption margin |
| `--space-2` | `5.6px` | `.btn` block padding, `.card` gap, table cell padding, heading margin, dialog-actions gap |
| `--space-3` | `8.4px` | `.card` padding, `.dialog` gap, p margin, `.btn` inline padding (× 1.2 = 10.08px) |
| `--space-4` | `11.2px` | `.dialog` padding, `.dialog-backdrop` padding, `.hr` margin, `.nav` gap |
| `--space-6` | `16.8px` | — |
| `--space-8` | `22.4px` | — |

(No `--space-5` / `--space-7`.) **The prototype almost never uses the spacing tokens**: it writes raw px (gap 8px ×301, 6px ×297, 10px ×284, 14px ×135, 4px ×106, 12px ×98, 3px ×74, 2px ×37, 5px ×25, 18px ×9). See OPEN QUESTION Q-11.

### Radius

| Token | Value |
|---|---|
| `--radius-sm` | `4px` |
| `--radius-md` | `8px` |
| `--radius-lg` | `14px` |

App radius usage: `var(--radius-md)` ×115, `50%` ×51, `2px` ×37, `3px` ×36, `0` ×16 (drawers), `6px` ×13 (menu items), `4px` ×12, `5px` ×9, `9px` ×7 (pills), `7px` ×4 (icon tiles), `2px 2px 0 0` ×7 (column bars), `var(--radius-sm)` ×1.

### Elevation

| Token | Value | Utility class |
|---|---|---|
| `--shadow-sm` | `0 0 0 1px #3f424d` (neutral-800 hairline) | `.elev-sm` |
| `--shadow-md` | `0 0 0 1px #595d6c, 0 6px 18px rgba(0,0,0,.55)` | `.elev-md` |
| `--shadow-lg` | `0 0 0 1px #9397ab, 0 16px 40px rgba(0,0,0,.65)` | `.elev-lg` |

App usage: `.card.elev-sm` ×215 (all cards/tiles), `.elev-md` ×8 (popovers, map tooltip), `.card.elev-lg` ×19 (drawers, toast, centered modals).

### Lint contract (`_adherence.oxlintrc.json`)

Warns on raw hex literals (`#[0-9a-fA-F]{3,8}`), raw `\d+px` literals, and any `font-family` other than Inter. The prototype violates the hex rule in SVG charts (see DS-CHARTS) and the px rule everywhere.

---

## DS-CLASSES — Nocturne component classes

**Purpose:** plain-CSS components the prototype reuses (classes found in the template: `card elev-sm` ×215, `card-title` ×156, `input` ×86, `btn btn-secondary` ×75, `table` ×68, `btn btn-ghost` ×64, `btn btn-primary` ×56, `seg`/`seg-opt` ×46, `field` ×37, `btn btn-icon btn-ghost` ×33, `card elev-lg` ×19, `tag tag-neutral` ×19, `tag tag-accent` ×12, `tag tag-outline` ×10, `elev-md` ×8, `btn btn-icon btn-secondary` ×7, `dialog*` ×4; plus ~70 bound `{{ x.tagClass }}` values). Not used at all: `.nav`, `.nav-brand`, `.radio`/`.dot`, `.hr`, `.lighten`, `.card-kicker`, `.card-body`, `.card-meta`, `.btn-block`, `.tag-accent-2`, `.dialog-body`. `.text-muted` is only emitted from logic (`healthClass`/`statusClass` when value is "—").

### Global rules

| Selector | Rule |
|---|---|
| `*, *::before, *::after` | `box-sizing:border-box` |
| `body` | `margin:0; background:var(--color-bg); color:var(--color-text); font-family:var(--font-body); font-size:15px; line-height:1.55` |
| `:focus` | `outline:none` |
| `:focus-visible` | `outline:2px solid var(--color-accent); outline-offset:2px` |
| `::selection` | `background: accent 30%` |
| `img` | `display:block; max-width:100%` |
| `.lighten` | `mix-blend-mode:lighten; background-color:transparent` (photo wrapper; unused) |
| `.hr` | 1px rule, `margin:11.2px 0`, gradient fading over 48px each end from `--color-divider` (unused; readme says avoid) |

### Buttons `.btn`

Base: `display:inline-flex; align-items:center; justify-content:center; gap:6px; cursor:pointer; text-decoration:none; font-family:var(--font-heading); font-weight:500; font-size:14px; line-height:1.2; color:var(--color-text); background:transparent; border:1px solid transparent; padding:5.6px 10.08px; border-radius:8px`. `.btn svg{display:block}`. `.btn:disabled { opacity:.45; cursor:not-allowed }`.

| Variant | Rest | Hover | Active |
|---|---|---|---|
| `.btn-primary` | `color:accent; border-color:accent` (outlined — **never filled**) | bg accent 12% | bg accent 22% |
| `.btn-secondary` | `border-color:var(--color-divider)` | bg text 7% | bg text 14% |
| `.btn-ghost` | `color:accent; padding-inline:2.8px` | bg accent 10% | bg accent 18% |
| `.btn-icon` | `width:36px; height:36px; padding:0` (combined with secondary/ghost) | per combined variant | — |
| `.btn-block` | `width:100%; margin-top:5.6px` (unused) | | |

Prototype overrides (font-size is almost always overridden down from 14px):

| Class | Most common inline override |
|---|---|
| `btn-primary` (56) | `font-size:12.5px` ×22; `font-size:12px;padding:3px 10px;white-space:nowrap` ×12 (row actions "Approve"); none ×6 (header primary, dialogs); `font-size:12px` ×5 |
| `btn-secondary` (75) | `font-size:12.5px` ×35; `font-size:12px;padding:3px 10px;white-space:nowrap` ×12; `font-size:12px` ×8; none ×5 |
| `btn-ghost` (64) | `font-size:12.5px` ×19; `font-size:12px` ×8; `margin-left:auto;font-size:12px;white-space:nowrap` ×8 (card-header actions); `font-size:12px;padding:3px 8px` ×6; `font-size:11.5px;padding:2px 8px` ×5; `align-self:flex-start;font-size:12px;padding:2px 4px;margin-left:-4px` (inline "action →" links) |
| `btn-icon btn-ghost` (33) | `color:var(--color-neutral-400)` ×20 (drawer/toast close ×); compact `width:24px;height:24px;min-height:0;padding:0;font-size:13px;color:neutral-400` ×9 (WBS row actions); 28/26/32px variants |
| `btn-icon btn-secondary` (7) | none ×4 (dialog close, bell); `width:28px;height:28px` ×2 (calendar prev/next) |

Buttons always pair a Phosphor icon (left) with the label; trailing `ph-arrow-right` for navigation-type actions ("Open schedule →"), trailing `ph-arrow-square-out` for external/cross-screen opens.

### Forms

| Class | Rule |
|---|---|
| `.field > label` | `display:block; font-size:12px; margin-bottom:5px; color: text 70%` |
| `.input` | `width:100%; min-height:36px; padding:6px 10px; font:inherit; font-size:14px; color:var(--color-text); caret-color:var(--color-accent); background:var(--color-surface); border:1px solid var(--color-divider); border-radius:8px` |
| `.input:hover` | `border-color: text 45%` |
| `.input:focus-visible` | `border-color:var(--color-accent); outline-offset:0` (plus the global 2px accent outline) |
| `textarea.input` | `min-height:90px; resize:vertical` |
| `.radio`, `.radio .dot` | 16px circle, 1.5px divider border; checked = accent fill with `inset 0 0 0 4px var(--color-bg)` (unused by app) |
| `.seg` | `display:inline-flex; overflow:hidden; border:1px solid var(--color-divider); border-radius:8px` |
| `.seg-opt` | `display:inline-flex; align-items:center; gap:6px; padding:7px 12px; font-size:13px; cursor:pointer`; `+ .seg-opt { border-left:1px solid divider }`; `:has(input:checked)` → `color:accent; box-shadow: inset 0 0 0 1px accent`; `:not(:has(input:checked)):hover` → bg text 7%; `:has(input:focus-visible)` → `outline:2px solid accent; outline-offset:-2px` |

The `<select class="input">` uses the native arrow (no custom chevron). Disabled inputs (`disabled="{{ cf.disabled }}"`, Contract sheet 822–827) have no DS styling — native. App `.input` overrides: `min-height:28px;padding:2px 8px;font-size:12.5px;width:100%` ×10 (inline editors), `padding-left:30px;min-height:34px` ×6 (page search), `width:auto;min-height:32px;padding:4px 10px;font-size:12.5px` ×6 (fake dropdown "pills" in Plan toolbar), `min-height:26px;padding:2px 6px;font-size:12px` (WBS grid cells), `display:flex;align-items:center;gap:8px;cursor:pointer` ×7 (read-only "input-looking" pickers in the New-project wizard).

**Important deviation:** the app renders `.seg-opt` on `<button>` elements (not label+radio). The selected look is therefore computed in logic by `seg()` (logic 3889) and passed as inline `color` / `box-shadow` / `border-left`; see `Segmented` in DS-COMPONENTS.

### Cards

| Class | Rule |
|---|---|
| `.card` | `display:flex; flex-direction:column; gap:5.6px; padding:8.4px; border-radius:8px; background:var(--color-surface)` |
| `.card-title` | `font-family:heading; font-weight:500; font-size:17px; line-height:1.2` |
| `.card-kicker` | 10px, .1em, uppercase, accent (unused) |
| `.card-body` | 13px, opacity .8 (unused) |
| `.card-meta` | 11px, text 50% (unused) |

### Tags `.tag`

Base: `display:inline-flex; align-items:center; font-size:11px; letter-spacing:.02em; padding:3px 10px; border-radius:6px` (`calc(var(--radius-md)*.75)`).

| Variant | Background | Text | Border |
|---|---|---|---|
| `.tag-accent` | `--color-accent-800` `#423a6a` | `--color-accent-100` `#f5f4ff` | none |
| `.tag-neutral` | `--color-neutral-800` `#3f424d` | `--color-neutral-100` `#f3f5fe` | none |
| `.tag-outline` | transparent | `--color-accent` `#9184d9` | `1px solid var(--color-accent)` → 2px taller/wider than the filled variants |
| `.tag-accent-2` | accent-2-800 | accent-2-100 | none (unused) |

### Table `.table`

`width:100%; border-collapse:collapse; font-size:14px`. `th`: `text-align:left; font-size:11px; letter-spacing:.08em; text-transform:uppercase; color: text 60%; padding:5.6px; border-bottom:1px solid transparent`. `td`: `padding:5.6px; border-bottom:1px solid transparent`. Row rules are painted on the `<tr>` as a 1px bottom gradient strip that fades over 48px at both ends: header row from `--color-divider`, body rows from text 8%. `tbody tr:hover` adds a full-row text 4% tint layered over the rule.

App usage: 68 tables, all with `style="font-size:13px"` ×35 or `12.5px` ×33; `<th style="text-align:right">` ×101 (numeric columns); clickable rows `<tr onClick=… style="cursor:pointer">` ×20+; selected row = `background:var(--color-accent-900)` (via `r.bg`) and/or id text `--color-accent-300` (`r.idColor`/`noColor`).

### Dialog

| Class | Rule |
|---|---|
| `.dialog-backdrop` | `position:fixed; inset:0; display:grid; place-items:center; padding:11.2px; background: neutral-900 50%` |
| `.dialog` | `width:min(440px,100%); display:flex; flex-direction:column; gap:8.4px; padding:11.2px; border-radius:14px; background:surface; box-shadow:var(--shadow-lg)` |
| `.dialog-title` | heading font, 500, `font-size:20px` |
| `.dialog-body` | 14px, opacity .85 (unused) |
| `.dialog-actions` | `display:flex; justify-content:flex-end; gap:5.6px; margin-top:5.6px` |

### Navigation `.nav`

Defined (`.nav`, `.nav-brand` 18px, `.nav a:hover / [aria-current=page]` → accent) but **not used**: the app uses its own sidebar (DS-COMPONENTS › `SidebarNav`).

### Readme rules the rebuild must keep

- Outlined primary buttons; accent as line/glow, never a flood (exceptions: deck/landing only).
- No pure black/white (shadows excepted). No heavy stacked shadows.
- Headings never bolder than 500; hierarchy by size and space.
- Every interactive element: themed hover + pressed state; focus = 2px accent `:focus-visible` ring.
- Icons: Phosphor everywhere.
- Photographs through `.lighten` (not applicable to the app; image-slots show documents/photos without it).

---

## DS-APP-GLOBALS — App-level globals

**Source:** template lines 1–17 (`<helmet>`), logic 3763–3786.

| Item | Value |
|---|---|
| Stylesheets/scripts | Nocturne `styles.css`, `_ds_bundle.js` (empty namespace bundle), Phosphor `https://unpkg.com/@phosphor-icons/web@2.1.1` (icon font, all weights), `image-slot.js` |
| Global style (line 14) | `body{margin:0;background:var(--color-bg)}` · `*{scrollbar-color:var(--color-neutral-700) transparent;scrollbar-width:thin}` · `a{color:var(--color-accent)}` · `a:hover{color:var(--color-accent-400)}` |
| App root (line 17) | `display:grid; grid-template-columns:232px minmax(0,1fr); min-height:100vh; background: radial-gradient(1200px 600px at 70% -10%, var(--color-accent-900), transparent 60%), var(--color-bg); color:var(--color-text); font-family:var(--font-body)` — the only "glow" gradient on the ground (top-right accent bloom). |
| Icons | Phosphor regular `class="ph ph-<name>"`; one fill usage `ph-fill ph-check-circle` (closed meeting action, logic ~4838). 144 distinct icons (91 in template, 53 more from logic). Typical sizes: 16px (nav, notice), 15px (filter-label icon, ×46), 13–14px (inline), 18–20px (toast, file tiles), 26px (large empty-state icon). |
| Component props (`data-props`, line 3095) | `currency: 'EUR'|'USD'` (default `EUR`, drives `money()`); `showBaseline: boolean` (default `true`, shows baseline bars/diamonds in Schedule Gantt, template 521/531); `startScreen: enum` (default `home`; options: home, myprojects, worldmap, overview, projects, plan, schedule, budget, trends, risks, changes, site, quality, presources, procurement, orders, deliveries, stock, resources, rates, skills, leave, whatif, requests, approvals, pid, bom, plm, eco, drawings, settings, mywork, myapprovals, task) |
| Language | `state.lang` default `'fr'` (state initialiser logic 3767–3774); FR/EN segmented in header (`langSeg`, logic 5103). Every string in the render object is passed through `deepTr` except style-ish keys (`SKIP_KEYS`, logic 3757: icon, bg, color, shadow, bl, border, fg, bar, d, pv/ev/ac/fc, evArea, tagClass, cursor, widths/lefts, …). FR strings are typically 15–30% longer — components must wrap (`text-wrap:pretty`, `flex-wrap:wrap`) rather than truncate titles. |

### Number & money formatting (visual contract)

| Helper | Line | Output |
|---|---|---|
| `this.money(k, signed)` (alias `f`, 3785) | 3775 | Input in **k-units**. FR+EUR: `≥1000 → "1,23 M€"`, else `"640 k€"`. Otherwise `"€1.23M"` / `"€640k"` (`$` when currency USD). Negative sign is U+2212 `−`; `signed` adds `+` for positives. |
| `money$` | 4177 | Units: FR `"12 345 €"` (fr-FR grouping), EN `"€12,345"`. |
| `eur` | 4383 | fr-FR, max 2 decimals, `" €"` suffix (rate cards). |
| `pct(v)` | 3133 | `Math.round(v*1000)/10 + '%'` (one decimal; used for CSS widths too). |
| `dateOf(m)` | 3134 | month-float → `"14 Jan ’27"` style (year suffix only for 2027). |

All numbers render with `font-variant-numeric: tabular-nums` (×388 in template). Dates and months are FR-translated via `FR_MONTHS` (`Jan→janv.` …) in `frSeg` (logic 3755).

---

## DS-TONES — Semantic tone system (mono palette)

**Purpose:** the product has **no red/amber/green**. Severity is expressed by *accent intensity*:

| Tone | Meaning | Text colour | Tag class | Fills |
|---|---|---|---|---|
| **alert** ("LO") | off track, late, over budget, blocked, needs action now | `LO = 'var(--color-accent-300)'` (logic 3135) | `tag tag-accent` (filled accent-800 / accent-100) | accent / accent-400…600 for "over" heat |
| **watch** | at risk, in progress, pending, awaiting | `--color-neutral-300` or accent-300 | `tag tag-outline` (accent outline) | accent-700 / accent-900 |
| **calm / done** | on track, done, approved, closed, OK | `OK = 'var(--color-text)'` | `tag tag-neutral` | neutral-600…800 |
| **n/a** | no data, not started, "—" | `--color-neutral-500` | `text-muted` class or no tag | neutral-900 |

KPI tiles carry `color: LO|OK` on the value (e.g. `scheduleKpis` SPI: `spi<.97?LO:OK`, logic 3860). Table metric cells carry `cpiColor/spiColor/varColor/slipColor` etc. computed with the same rule (e.g. `slipColor: slip>14?LO:'var(--color-neutral-300)'`, logic 3851).

### Project health (shared everywhere)

`healthOf(p)` (logic 3916): `m = min(budget*progress/actual, spi||1)`; `m<.90 → 'Off track'`, `m<.97 → 'At risk'`, else `'On track'`; `null` when no actual/progress.

| Health (EN → FR) | Tag |
|---|---|
| Off track → *Hors trajectoire* | `tag tag-accent` |
| At risk → *À risque* | `tag tag-outline` |
| On track → *Conforme* | `tag tag-neutral` |
| none → "—" | `text-muted` |

### Project lifecycle status (`statusTag`, logic 3917)

| Status (French labels are canonical, also in EN UI) | Tag |
|---|---|
| Initiative, APS, APD (`PIPE_STAGES`) and Garantie | `tag tag-outline` |
| Etudes, Approvisionnements, Fabrication & Assemblage, FAT, Expédition, Chantier, Mise Service & SAT (`EXEC_STAGES`) | `tag tag-accent` |
| Clos, Annulé | `tag tag-neutral` |

Short labels for the stage slider `ST_SHORT` (logic 3905): Init., APS, APD, Études, Appro., Fab., FAT, Expéd., Chantier, MES/SAT, Garantie, Clos, Annulé. Lifecycle dots (`lifecycle`, logic 3943): exec stages `accent`, Clos `neutral-500`, Annulé `neutral-700`, others `accent-700`; "Fabrication & Assemblage" gets glow `0 0 10px accent 60%`.

### Status → tag mappings by object (exact logic)

| Object (helper, logic line) | `tag-accent` | `tag-outline` | `tag-neutral` | other |
|---|---|---|---|---|
| Stage history mode (3941) | Forcé | — | Auto | |
| Plan activity row `statusClass` (4007) | Behind (*En retard*) | In progress (*En cours*) | Completed (*Terminée*) | Not started → `text-muted` |
| Selected activity (4020) | In progress · n% | Not started | Complete | (note inverted vs. row, Q-6) |
| Schedule milestone (3856) | Late | (else, e.g. At risk) | Done | |
| Budget change requests list (4053) | Approved | Pending | else | (≠ Change control, Q-5) |
| Change control `crTag` (4594) | In review (*En revue*) | Rejected, Draft/else | Approved | |
| CR approval chain (4609) | pending | rejected | ok, n/a | |
| Baselines (4605) | Current (*Actuel*) | Proposed (*Proposée*) | else | |
| Part `partTag` (4176) | else | Not validated | Validated | |
| Make/buy `puTag` (4181) | PU | PR | else | |
| ECO `ecoTag` (4194) | In approval | Rejected, Draft, Impact analysis | Released (*Diffusé*) | |
| ECO interchangeability/pending (4364–4366) | not assessed / dispositions pending | — | set | |
| Drawing `dwgTag` (4373) | else (e.g. In work) | Obsolete | Released | |
| Purchase order `poTag` (4313) | Partially received | Awaiting approval, Ordered | Received, Cancelled, Draft | |
| Delivery `dTag` (4451) | Rejected, Partially rejected | Received, QC pending | Accepted, Announced | |
| Stock source (4488) | local | — | X3 | |
| Risk level `rTag` (4575) | Critical (≥15) | High (≥8) | Medium (≥4), Low | `rScore = p × i`, `rLevel` 4574 |
| NCR severity `sevTag` (4615) | Critical | Major | else | |
| NCR status `ncrTag` (4616) | Open | Containment…Verification | Closed | |
| Deliverable `dlvTag` (4631) | Rejected, Submitted | In progress, Internal review | Accepted, Planned | |
| RFQ `rfqTag` (4649) | Comparing | else | Awarded, Draft | |
| Supplier invoice `invTag` (4660) | Blocked, No PO | else (Awaiting receipt…) | Paid, Approved for payment | |
| Supplier grade (4674) | C / else | B | A | |
| Client invoices (4686) | Invoiced | else | Paid | |
| Client issues (4688) | Open | else | Closed | |
| Connectors (4714) | Warning | else | OK | |
| Site status `stTag` (4743) | Missing, Open, NO GO | Pending, Expiring, GO with reserve | Signed, Confirmed, OK, Closed, Ready, Approved, GO, Not required, else | |
| Site equipment source (4745) | — | Expédié | else | |
| Site collisions (4753) | Load | Certificate, Document, Leave | — | |
| P&ID tag `tsTag` (4767) | Unmapped, Unknown ref | else | Linked, Client | |
| P&ID steps (4777) | doing | todo | done | |
| Meeting type (4857) | External | — | Internal | |
| Meeting status (4857) | Notes in progress | Scheduled | Minutes sent | |
| Read receipts (4860) | — | Not read yet | Read … | |
| Carried actions (4838) | Still open | — | Closed since | |
| Client bridge (4840) | Needs an answer | — | Answer ready | |
| Contract amendment (4884) | else (pending) | — | Signed | |
| ITP type (4942) | Hold (*Point d’arrêt*) | Witness (*Témoin*) | else | |
| ITP status (4942) | Failed | Scheduled, else | Passed | |
| Punch category (4946) | A | B | else | |
| Punch status (4946) | else (Open) | In progress | Closed | |
| Interface status (4955) | Late | else | Frozen, Received | |
| Home row for member (4429) | due ≤ today | — | later | |
| Map tooltip (map file `tagClass`) | active & not on track/at risk | active At risk; pipeline | active On track; closed | (status tag colour follows health, Q-2) |

### Other tone helpers

| Helper (line) | Mapping |
|---|---|
| `nav()` (3786) | active: `bg accent-900`, `color accent-300`; idle: transparent / `neutral-300` |
| `seg()` (3889) | selected: `color accent`, `box-shadow inset 0 0 0 1px accent`; idle: `neutral-300`, none; `bl` (border-left) `1px solid var(--color-divider)` for i>0 else `0` |
| `chips()` (4110) | on: `bg accent-900`, `border accent-700`, `color accent-200`; off: transparent / `neutral-800` / `neutral-300` |
| `shade(v)` allocation % (3867) | `>115`: accent-400 / bg ink · `>100`: accent-600 / accent-100 · `≥90`: accent-800 / accent-200 · `≥60`: accent-900 / neutral-300 · else neutral-900 / neutral-400 |
| `rCell(p,i)` risk matrix (4576) | `p·i ≥15` accent-500 · `≥8` accent-700 · `≥4` accent-900 · else neutral-900; text accent-100 if ≥8 else neutral-300 |
| `lvColor(v)` skill dots (4392) | ≥4 accent-400 · 3 accent-600 · 2 accent-800 · 1 neutral-800 · 0 transparent; empty dot neutral-900 |
| RACI cell (4935) | A: bg accent-800 / accent-100 · R: bg accent-900 / accent-300 · C: neutral-300 · I: neutral-500; border `1px solid neutral-800` if set else `1px dashed neutral-900` |
| `cmStatus` commissioning (4971) | Done: bg accent-800, border accent-700, text accent-100, `ph-check` · In progress: bg accent-900, border neutral-800, accent-300, `ph-circle-half` · Blocked: transparent, `1px dashed accent`, LO, `ph-lock-simple` · else: transparent, neutral-800, neutral-400, `ph-circle-dashed` |
| Task check (`todoLite` 3896, checklist 4089) | done: ring+fill accent, title `line-through`, title colour neutral-500; open: ring neutral-600, transparent |
| Board column dot (4078) | done neutral-500 · todo neutral-400 · doing/review accent |
| Work groups (4077) | Overdue label LO · Today accent-300 · others default |
| Flow steppers (4334, 4355, 4625, 4640, 4777, 5042) | reached dot accent (current may glow `0 0 8px accent 60%`), future neutral-700; label text vs neutral-500; rejected → all neutral-700 |
| Approval dots (4343, 4600) | ok accent · rejected neutral-100 · n/a transparent with `inset 0 0 0 1px neutral-700` · pending neutral-700 |
| Notifications (4706) | unread: dot accent, row bg `accent-900 60%`; read: transparent |
| Gantt (3852–3853) | critical bar bg accent-900, edge inset accent-600, fill gradient accent-700→accent-500; normal bg neutral-900, edge neutral-700, fill neutral-700 |

---

## DS-TYPE — Typography actually used

**Font:** Inter 400/500 only. Body inherits 15px/1.55 from `styles.css`; most text sets an explicit size.

### Font-size inventory (template inline `font-size`, 1 880 declarations)

| Size | Count | Role(s) |
|---|---|---|
| 26px | 3 | Page title `h2` (line 97, `margin:0`; DS h2 tracking −0.015em, lh 1.12, 500); satisfaction average (927); big empty-state icon (2459) |
| 24px | 2 | KPI value on Home (168) and Overview (243) |
| 22px | 58 | KPI value everywhere else (`font-size:22px;font-weight:500;letter-spacing:-0.02em` ×57); trend-card value |
| 20px | 6 | Variance figures (338–339), dialog title (`.dialog-title`), reconciliation values, 20px icons |
| 18px | 6 | Home greeting (165), task % (2949), wizard total (3032), toast icon |
| 17px | 2 | `.card-title` default (DS) — card titles inherit 17px (×156) |
| 16px | 13 | Brand "Keystone" (23, `letter-spacing:-0.01em`), nav icons, notice icons |
| 15px | 60 | Filter-label icons (×46 `font-size:15px;color:var(--color-accent)`); card-title override in Task screen |
| 14.5px | 1 | Project card name (203) |
| 14px | 6 | Highlight titles (what-if, used part, approval card) |
| 13.5px | 6 | Task description `p` (lh 1.55, neutral-200), list titles in My work, wizard template names |
| 13px | 139 | Primary row/list text, nav items, table cells in 13px tables, toast |
| 12.5px | 347 | Secondary body, inputs in header, callouts, key–value rows, buttons (override) |
| 12px | 604 | Card subtitles/hints (`font-size:12px;color:var(--color-neutral-400)` ×93), filter labels, crumbs, chip/seg text |
| 11.5px | 200 | Row sub-lines (`11.5px neutral-400` ×65 + `text-wrap:pretty` ×56), KPI sub |
| 11px | 167 | Table `th` (DS), micro meta, tags, chart axis labels |
| 10.5px | 210 | Eyebrows/section labels (`10.5px .08em uppercase` ×73 neutral-400, ×48 accent), KPI labels, chart labels, small tags |
| 10px | 45 | Menu headers (uppercase), nav group headers, small tags `font-size:10px;padding:1px 7px`, badges |
| 9.5px | 3 | Gantt stage labels, 22–24px avatars |
| 9px | 2 | 20px avatar initials, check glyph |

### Weights, tracking, line-heights

- `font-weight:500` ×148 (titles, values, IDs, emphasised names); otherwise 400.
- `letter-spacing`: `0.08em` ×184 (always with uppercase eyebrows), `-0.02em` ×62 (big numbers), `0.06em` ×11 (sub-eyebrows, map tooltip header), `-0.01em` (brand), `0` ×7 (reset inside uppercase headers).
- `text-transform:uppercase` ×194.
- `line-height`: `1.3` ×89 (title/sub stacks), `1.25` ×12 (avatar+name stacks), `1.45` ×9 / `1.5` ×7 / `1.55` (paragraphs), `1.2` ×7, `1` ×5 (icon buttons).
- `text-wrap:pretty` ×231 on any multi-line text; `text-wrap:balance` ×1.
- Truncation idiom ×20: `white-space:nowrap;overflow:hidden;text-overflow:ellipsis` with `min-width:0` on the flex/grid parent.
- Numbers: `font-variant-numeric:tabular-nums` ×388.

### Text roles (proposed type tokens for the rebuild)

| Token | Spec |
|---|---|
| `type.pageTitle` | 26px / 500 / lh 1.12 / −0.015em / text |
| `type.kpiValue` | 22px (lg 24px) / 500 / −0.02em / tone colour |
| `type.cardTitle` | 17px / 500 / lh 1.2 (compact 15px) |
| `type.dialogTitle` | 20px / 500 |
| `type.eyebrow` | 10.5px / 400 / .08em / uppercase / neutral-400 (muted) or accent (section) |
| `type.th` | 11px / .08em / uppercase / text 60% (DS table) — grid-tables use 10.5–11px neutral-400 |
| `type.body` | 13px / text |
| `type.bodySm` | 12.5px |
| `type.hint` | 12px / neutral-400 |
| `type.sub` | 11.5px / neutral-400 / lh 1.3 |
| `type.micro` | 11px / neutral-400 or neutral-500 |
| `type.menuHeader` | 10px / .08em / uppercase / neutral-500 |

---

## DS-LAYOUT — Shell, rhythm, grids, layering

### App shell (template 17–125)

| Region | CSS |
|---|---|
| Root | `display:grid; grid-template-columns:232px minmax(0,1fr); min-height:100vh;` + radial accent bloom background (DS-APP-GLOBALS) |
| Sidebar `<aside>` (19) | `display:flex; flex-direction:column; gap:14px; padding:18px 14px; position:sticky; top:0; height:100vh; overflow:auto; border-right:1px solid var(--color-neutral-900); background:color-mix(in srgb, var(--color-bg) 70%, transparent)` |
| Main `<main>` (75) | `display:flex; flex-direction:column; gap:18px; padding:20px 28px 40px; min-width:0` |
| Page header `<header>` (76) | `display:flex; align-items:flex-end; gap:16px; flex-wrap:wrap` |
| Screen body | each `sc-if` screen opens with `display:flex;flex-direction:column;gap:14px` (×61) (Overview uses 18px) |

### Page rhythm

1. Header (crumb + title + actions) → 2. optional banners (outside-workspace, zone bar, notices) → 3. optional filter/view bar → 4. KPI grid → 5. cards (full-width or responsive multi-column) → 6. drawers/dialogs (fixed).

### Grids

| Pattern | CSS | Count |
|---|---|---|
| KPI grid | `display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:10px` | ×52 (160px ×6, 170px Home, 140px Budget) |
| Card columns | `repeat(auto-fit,minmax(min(100%,Npx),1fr))` with N ∈ {220,230,260,300,340,360,380,400,420,460,540,620}, gap 14px | ~35 |
| Flex columns | `display:flex;flex-wrap:wrap;gap:14px;align-items:flex-start|stretch` with children `flex:<grow> 1 <basis>px;min-width:0` (e.g. 3 1 560px + 1 1 280px; 2.4 1 1015px + 1 1 260px) | ×12+ |
| Master/detail | `grid-template-columns:minmax(260px,340px) minmax(0,1fr)` (Meetings 758); `minmax(0,1fr) clamp(240px,28%,320px)` (World map 218) | |
| Row grids | `minmax(0,1fr) auto` ×18 · `minmax(0,1fr) auto auto` ×13 · `auto minmax(0,1fr) auto` ×5 · `18px minmax(0,1fr) auto` ×4 · `28px minmax(0,1fr)` (icon rows) | |
| Fixed-column "grid tables" | e.g. WBS `72px minmax(220px,1.6fr) 150px 64px 84px minmax(170px,1fr) 100px 92px` (1047), progress `72px minmax(200px,1.4fr) 84px 84px 80px 54px minmax(170px,1fr) 50px 92px 46px 56px` (1074), Gantt `230px 56px 64px minmax(560px,1fr)` (506), portfolio Gantt `240px 172px 170px minmax(760px,1fr)` (984) — wrapped in a `min-width` container inside an `overflow:auto` card | |

### Responsive behaviour

There are **no media queries** in the app, the DS or the map page. Responsiveness relies on: auto-fit/auto-fill grids, `flex-wrap`, flex-basis columns, `min()/clamp()` widths (`min(640px,100vw)`, `min(480px,calc(100vw - 48px))`, `clamp(460px,68vh,720px)`), and horizontal scrolling of wide data (`overflow:auto` on cards + inner `min-width` 780–1342px). The 232px sidebar never collapses (Q-8).

### Z-index scale (observed)

| z | Layer | Lines |
|---|---|---|
| 2 | Portfolio-Gantt board diamonds | 1008 |
| 20 | In-table popovers (status "Move to", stage deliverables) | 673, 695, 706, 729 |
| 30 | Project picker popover | 84 |
| 40 | Role ("View as") menu | 60 |
| 48 / 49 | Click-catcher + popover for global search and notifications | 101–102, 111–112 |
| 50 | Dialogs: generic add-form, New project wizard, New resource request | 139, 2973, 3072 |
| 55 | "Force stage change" dialog | 3059 |
| 60 / 61 | Drawer scrim / drawer panel (16 drawers) | 1106…2665 |
| 70 / 71 | Centered modal over drawers (Codex deposit, engineering import) | 2364, 2453 |
| 80 | Toast | 160 |

---

## DS-COMPONENTS — Proposed component library

Names are proposals for a React + TypeScript library. CSS values are exact prototype values; token names in parentheses. "Lines" = template lines of representative instances.

### C-01 `AppSidebar` / `SidebarNavItem` / `SidebarSection` / `SidebarGroup`

Lines 19–73; logic 3786 (`nav`), 5139–5172.

- **Brand** (20–24): row `gap:10px;padding:0 6px`; logo tile `26×26, radius 7px, border 1px accent, color accent, box-shadow 0 0 14px accent 40%`, icon `ph-polygon` 15px; wordmark "Keystone" 16px/500/−0.01em.
- **Quick jump** (25–37): `.input` with `padding-left:28px;padding-right:38px;min-height:32px;font-size:12.5px`; magnifier icon abs `left:9px;top:9px;13px;neutral-500`; `⌘K` hint chip abs `right:8px;top:8px;font-size:10px;padding:1px 5px;radius 4px;border 1px neutral-800;color neutral-500`. ⌘/Ctrl+K focuses+selects (`navQRef`, logic 3765); Esc clears; Enter jumps to first hit. Results list items show label + section (10.5px neutral-500); empty: "No page matches" (*Aucune page ne correspond*).
- **`SidebarNavItem`** props `{icon, label, active, badge?, onClick}`: `display:flex;align-items:center;gap:10px;padding:7px 8px` (fixed items) / `6px 8px 6px 10px` (section items); `border:0;border-radius:8px;font-size:13px;text-align:left`; active `bg accent-900; color accent-300`, idle `transparent; neutral-300`; hover `background: neutral-900 !important` (also overrides active bg — see RT-SUPPORT). Icon 16px `flex:none`. Label ellipsis. Badge pill (C-14).
- **`SidebarSection`** props `{label, open, onToggle, badge?, count?, sub?, active}`: header button `gap:8px;padding:6px 8px;font-size:10.5px;letter-spacing:.08em;uppercase;color: (active||open)? neutral-300 : neutral-500`; caret `ph-caret-down|right` 11px; collapsed sections show a badge = sum of numeric child badges or `!` if any non-numeric; when open and no badge, a `count` (10.5px neutral-600) of items. `sub` (current project name) `11.5px neutral-300; padding:0 8px 4px 27px; ellipsis`. Collapsed sections still show the active item. Open state persisted in `localStorage['keystone-nav-open']`; default open: `project` section and `Steering` sub-group.
- **`SidebarGroup`** (50): `gap:6px;padding:7px 8px 4px 10px;font-size:10px;.08em;uppercase;color (active||open)? neutral-300 : neutral-500`; hover `color neutral-200`; trailing rule `flex:1;height:1px;background:linear-gradient(90deg,var(--color-neutral-800),transparent)`; badge/count as above (10px).
- **Viewer switch** (58–72): button `width:100%;gap:10px;padding:8px;radius 8px;background surface` hover neutral-900; avatar 28 accent tone; name 13px, role 11px neutral-400; `ph-caret-up-down` neutral-500. Menu above (`bottom:calc(100% + 6px)`, z40, `.elev-md`), header "View as" (*Voir en tant que*), items with 24px neutral avatar + name + role; selected item `bg accent-900`.
- Special section "Outside my workspace" (*Hors de mon périmètre*) pinned on top with eye icon in accent-300 when the current screen is outside the role's `ROLE_SCREENS` (logic 5167).

### C-02 `PageHeader`

Lines 76–125. Props `{crumb, title, healthTag?, readOnly?, projectPicker?, onSearch, notifications, statusDate, lang, onExport, primaryAction?}`.

- Left column `gap:4px;margin-right:auto`: crumb `12px neutral-400; gap:8px; flex-wrap` + separator "/" neutral-600 + **ProjectPicker** button (`padding:3px 9px;radius 6px;border 1px neutral-800;bg surface;12.5px`, `ph-folder-open` accent, `ph-caret-down` neutral-500; hover border neutral-600). Title row `gap:10px`: `h2` 26px `margin:0` + health tag + "Read-only" (*Consultation*) `tag tag-outline` with `ph-eye`.
- Right: global search (`position:relative;min-width:220px;flex:1 1 220px;max-width:360px`, input `padding-left:30px;min-height:32px;font-size:12.5px`, placeholder "Search projects, activities, parts, orders, people…"); bell `btn btn-icon btn-secondary` with unread badge (abs `top:-4px;right:-4px;min-width:16px;height:16px;padding:0 4px;radius 8px;10px;bg accent;color bg`); status date `12px neutral-400` + `ph-calendar-blank` "Status date · 25 Sep 2026" (*Date d’état ·*); language `Segmented` FR/EN; `btn-secondary` "Export" (`ph-export`, **no handler**); `btn-primary` with `ph-plus` + screen-specific label (`primary` map, logic 5137) when `hasPrimary`.
- **ProjectPicker popover** (83–93): `.elev-md`, z30, `top:calc(100% + 4px)`, `min-width:460px;max-width:min(560px,90vw);padding:6px;radius 8px;bg surface`; header "Switch project"; scope `Segmented` (full-width options, with counts); search input "Search a project number or name…"; options `grid minmax(0,1fr) auto; gap:10px; padding:6px 8px; radius 6px; 13px` (name + sub 11px neutral-400; right: read-only eye + health tag); selected `bg accent-900`; empty "No project in this scope · search the whole portfolio".
- **SearchPopover** (100–106): click-catcher `fixed inset:0 z48`; panel `.elev-md z49 top:calc(100% + 4px) right:0 width:min(480px,calc(100vw - 48px)) padding:6px max-height:60vh overflow:auto`; rows `grid 110px minmax(0,1fr); gap:10px; padding:7px 8px; radius 6px; 12.5px` with `tag tag-neutral` kind + title/sub; empty "No match — try a reference, a name or a supplier".
- **NotificationsPopover** (110–117): catcher z48; panel z49 `top:calc(100% + 6px);right:0;width:min(440px,90vw);padding:8px;max-height:70vh`; header 13px/500 + ghost "Mark all read" (12px, `padding:2px 8px`); item `grid 8px 28px minmax(0,1fr); gap:10px; align-items:start; padding:8px; radius 6px` — unread dot 8px accent (`margin-top:9px`), icon tile (C-17), title 13px, sub 11.5px neutral-400, when 11px neutral-500; unread bg `accent-900 60%`; footer note 11px neutral-500 "Also sent by e-mail digest and to the project Teams channel · preferences in Settings".

### C-03 `ContextBanner` (outside workspace) and `ZoneBar`

- Outside banner (127): `display:flex;align-items:center;gap:10px;font-size:12.5px;color:neutral-300;padding:9px 12px;radius 8px;background:neutral-900;box-shadow:inset 0 0 0 1px neutral-800`; `ph-eye` 16px accent; text `margin-right:auto`; ghost button `ph-house` + back label (12px).
- Zone bar (131–135): `display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:-4px`; `ph-globe-hemisphere-east` 15px accent + title 12px neutral-400; `Segmented` with counts; owner `ph-user-circle` neutral-500 + label + name in neutral-200.

### C-04 `KpiTile` + `KpiGrid`

Lines 166–169, 291–298 (×59 tiles). Props `KpiTile {label, value, sub?, tone:'default'|'alert', icon?, size:'md'|'lg'}`; `KpiGrid {minWidth: 140|150|160|170}`.

```
.card.elev-sm  { gap:3px; padding:12px 14px }            /* surface #232532 + 1px #3f424d ring, radius 8 */
label          { font-size:10.5px; letter-spacing:.08em; text-transform:uppercase; color:var(--color-neutral-400) }
value (md)     { font-size:22px; font-weight:500; letter-spacing:-0.02em; color: tone==='alert' ? var(--color-accent-300) : var(--color-text) }
value (lg)     { font-size:24px; … }                    /* Home, Overview */
sub            { font-size:11.5px (lg: 12px); color:var(--color-neutral-400); text-wrap:pretty }
sub with icon  { display:flex; gap:5px; align-items:center }  /* Overview: <i class={k.icon}> */
grid           { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:10px }
```
Value line-height inherits 1.55. Data shape everywhere: `{label:string, value:string|number, sub:string, color: LO|OK, icon?:string}`.

**Variant `TrendKpiCard`** (1741–1747): `button.card.elev-sm` `gap:6px;padding:12px 14px;text-align:left;border:0;cursor:pointer`; selected `background:accent-900; box-shadow:inset 0 0 0 1px accent-700`, else surface/none; header row label + target (no uppercase); value 22px + `Sparkline` 120×32 `margin-left:auto`; delta 11.5px coloured (LO when worse). Grid `minmax(190px,1fr)`.

**Variant `ReconStep`** (Budget setup ~424): `padding:10px 14px;radius 8px;min-width:150px;background:{neutral-900|accent-900};box-shadow:{none|inset 0 0 0 1px accent-700}`; eyebrow + value; `ph-arrow-right` neutral-600 between steps.

### C-05 `SectionCard`

`.card.elev-sm` with `padding:14px 16px` (×148). Props `{title?, subtitle?, hint?, actions?, gap: 4|6|8|10|12, scroll?: boolean, flex?: string, selectable?}`.

- Default `gap:8px` (×81), add `overflow:auto` when it contains a table or wide grid (×67).
- Header variants:
  - Inline: `display:flex;align-items:center;gap:10px;flex-wrap:wrap` → `.card-title` (`margin-right:auto`) + hint `font-size:12px;color:neutral-400` or an icon+hint (`ph-arrows-clockwise` "Mirrored from …") or `btn-ghost` action.
  - Stacked: `display:flex;flex-direction:column;margin-right:auto` → `.card-title` + subtitle `12px neutral-400 text-wrap:pretty`; optional legend on the right (C-25).
  - Iconic: leading Phosphor icon in accent (`ph-sparkle`, `ph-heartbeat`, settings icons 16px `margin-top:2px`).
- Compact title in Task screen: `.card-title` `font-size:15px`.
- Clickable card (My projects 202): `cursor:pointer`, hover `box-shadow:inset 0 0 0 1px var(--color-accent-700)`; arrow link "Open project →" `12px accent-300`.
- Tinted card (what-if 2116): `background:var(--color-accent-900)`.
- Highlight card (2 instances): `flex-direction:row;align-items:center;gap:12px;flex-wrap:wrap;padding:12px 16px;border:1px solid var(--color-accent-800)`.
- Group list card (My work 2833): `padding:10px 16px 4px;gap:0` with uppercase group label coloured by tone.

### C-06 `Eyebrow` / `SectionLabel`

| Variant | CSS | Count |
|---|---|---|
| `section` (inside cards/drawers) | `font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--color-accent);margin-bottom:4px` | ×48 |
| `muted` (KPI labels, panel headers) | same, `color:var(--color-neutral-400)` | ×73 |
| `sub` | `font-size:11px;letter-spacing:.06em;uppercase;color:neutral-500` (e.g. "Projects & BOMs · 3") | |
| `menu` | `font-size:10px;letter-spacing:.08em;uppercase;color:neutral-500;padding:4px 8px 6px` | |
| `group divider` | eyebrow + count (tabular, neutral-500, letter-spacing 0) + `flex:1;height:1px;background:linear-gradient(90deg,neutral-800,transparent)` (Gantt groups 1000, nav groups) | |

### C-07 `StatusTag`

Props `{tone:'accent'|'outline'|'neutral'|'muted', size:'md'|'sm'|'xs', icon?, asButton?, onClick?}` + helper functions per object type reproducing DS-TONES tables (the logic always produces the full class string `'tag tag-…'`).

- `md`: DS `.tag` (11px, `3px 10px`). Usually `white-space:nowrap`.
- `sm`: `font-size:10.5px` (map lists, Gantt status, plan rows 11px).
- `xs`: `font-size:10px;padding:1px 7px` ("New" (*Nouveau*), project code chips in task lists).
- Tag-as-menu-button (Projects status cell 669): `class={tagClass}` + `border:0;cursor:pointer;gap:5px;font:inherit;font-size:11px;padding:3px 8px 3px 10px;white-space:nowrap` + `ph-caret-down`; opens a `Popover` (C-20) "Move to" (*Déplacer vers*) listing allowed transitions with gate text on the right.
- With icon: `tag tag-outline` + `display:inline-flex;align-items:center;gap:5px` + `ph-eye` ("Read-only").
- `muted` = class `text-muted` with text "—".

### C-08 `Segmented`

Lines 86, 120, 133, 288 … (×46). Props `{options: {value, label, icon?, count?}[], value, onChange, wrap?: boolean, fullWidth?: boolean, size?: 'sm'}`.

```
.seg (wrapper)  display:flex [; flex-wrap:wrap]  + DS .seg (1px divider border, radius 8, overflow hidden)
option <button class="seg-opt">
  white-space:nowrap; border:0; background:transparent; font:inherit; font-size:12px; cursor:pointer;
  padding:4px 10px; display:inline-flex; align-items:center; gap:6px;
  color: selected ? var(--color-accent) : var(--color-neutral-300);
  box-shadow: selected ? inset 0 0 0 1px var(--color-accent) : none;
  border-left: index>0 ? 1px solid var(--color-divider) : 0;
  [fullWidth] flex:1; justify-content:center
  hover (DS): background: text 7%
icon  <i class={o.icon}>   count <span style="font-variant-numeric:tabular-nums;font-size:11px;color:var(--color-neutral-400)">
```
Logic builder: `seg(opts, cur, set)` (3889). Accessibility: should be `role="radiogroup"` / `aria-pressed` (Q-12). Used for view switches ("Display"/*Vue*), language, scope, wizard choices (DAS, machine type, currency, calendar, contingency %), task status, % complete presets, ECO dispositions.

### C-09 `FilterBar`, `FilterLabel`, `FilterChips`

- Bar: `display:flex;align-items:center;gap:12px;flex-wrap:wrap` (sometimes `gap:6px` outer with search pushed right `margin-left:auto`).
- `FilterLabel` props `{icon, label}`: `display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--color-neutral-400);white-space:nowrap` + icon 15px accent. Labels come from `FL` (logic 5210): view "Display" (*Vue*), status "Status" (*Statut*), stage "Stage" (*Étape*), group "Group by" (*Regrouper par*), type, system, kind, state (*État*), skill, location, category, register, severity, scope, family, makebuy "Make / buy" (*Fabriqué / acheté*), department, source. Icons: `ph-eye` (view), `ph-funnel` (filters), `ph-tag` (type), `ph-factory` (supplier/make-buy), `ph-gear` (PU/PR).
- `FilterChips` props `{options:{value,label,count?}[], value, onChange}` (×22): `display:inline-flex;align-items:center;gap:8px;padding:4px 10px;border-radius:8px;font:inherit;font-size:12px;cursor:pointer;background;border:1px solid;color` (`chips()` 4110: on accent-900/accent-700/accent-200, off transparent/neutral-800/neutral-300); hover `background:var(--color-neutral-900)`; count `11px neutral-400 tabular`. Container `display:flex;gap:6px;flex-wrap:wrap`. Chips are single-select: the first option is "All" (*Tous*) with value `null` (or `'all'`) and the total count; clicking a chip sets that value (re-clicking the active chip does not clear it — choose "All"). Example `riskChips` (logic ~4578): `[{v:null,l:'All',count}, …categories with counts]`.
- Select-filter (BOM/PLM 1182–1183, 2549–2552): `<label style="display:inline-flex;align-items:center;gap:8px">` FilterLabel + `select.input` compact.

### C-10 `SearchField`

Props `{value, onChange, placeholder, size:'sm'|'md', minWidth}`. Wrapper `position:relative;min-width:220px|260px` (`margin-left:auto` in filter bars); icon `ph-magnifying-glass` abs `left:10px;top:9–10px;color:neutral-500`; `.input` `padding-left:30px;min-height:34px` (page) or `min-height:32px;font-size:12.5px` (header/popover, `left:9px` icon 13px).

### C-11 `DataTable`

DS `.table` + conventions: table font 13px (registers) or 12.5px (secondary tables); numeric columns `th/td text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap`; ID cells `font-size:12px;font-weight:500;tabular;color: selected? accent-300 : neutral-300`; primary cell = title/sub stack (`display:flex;flex-direction:column;line-height:1.3` → `span font-weight:500` + `span 11.5px neutral-400`); secondary text cells `font-size:12px;color:neutral-300`; long text `max-width:180–300px` with ellipsis; clickable rows `cursor:pointer` → open a `Drawer`; selected row `background: accent-900`. Empty → `EmptyState inline` below the table. Column width hints `th style="width:18–30%"` for bar columns. No sorting UI in table headers (sorting, where it exists, is a seg/select control — per-screen specs).

**Grid-table variant** (Plan WBS/progress, Gantt, allocation, calendar): CSS grid rows `min-height:36px` (or fixed 40/44px), header `font-size:10.5px|11px;letter-spacing:.08em;uppercase;color:neutral-400;padding:6px 0;border-bottom:1px solid var(--color-neutral-800)`; rows `border-bottom:1px solid var(--color-neutral-900)`; hover `background:var(--color-neutral-900)`; inline editors are compact `.input` (26–28px). Tree indent: Plan rows `padding-left: (summary ? level : 2) × 18 px` (`indent`, logic 3998; summaries weight 500), BOM tree `depth × 18 + 6 px` (`pad`, logic 4234); caret button 18×18 `ph-caret-down|right` neutral-400; BOM leaf marker `ph-dot-outline`.

### C-12 `ListRow` / `ListCard`

Most common in-card list (Home, Milestones, Approvals, Settings …): `display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;padding:8px 0;border-top:1px solid var(--color-neutral-900)` (variants: `auto auto` right part, padding 5/6/7/9/10px). Left stack: title 13px (`text-wrap:pretty`) + sub 11.5px neutral-400; right: tag / amount / buttons. Clickable rows set `cursor:pointer` and hover `color:accent-300` (buttons) or `background:neutral-900`. Icon rows: `grid 28px minmax(0,1fr)` with `IconTile`.

### C-13 `KeyValueList`

×22. Row: `display:flex;justify-content:space-between;gap:10px;font-size:12.5px;padding:3px 0;border-bottom:1px solid var(--color-neutral-900)`; key `color:neutral-400;flex:none`; value `text-align:right;font-variant-numeric:tabular-nums;text-wrap:pretty;color:{g.color}`. Data: `{k:string, v:string, color?:string}[]` (e.g. `dwg.meta`, `eco.impact`, `task.plan`). Horizontal variant (Task meta 2915): `display:flex;flex-wrap:wrap;gap:8px 22px;font-size:12.5px`, each item eyebrow (10.5px uppercase neutral-400) over value.

### C-14 `CountBadge`

| Use | CSS |
|---|---|
| Nav item | `font-size:11px;padding:1px 7px;border-radius:9px;background:var(--color-accent-800);color:var(--color-accent-100);flex:none` |
| Section/group header | `font-size:10.5px|10px;padding:0 6px;border-radius:9px;…;letter-spacing:0;text-transform:none` |
| Bell | see C-02 (16px circle-ish, accent bg, bg-colored text) |
| Outline pill (engineering matrix 2395) | `font-size:11px;padding:2px 7px;border-radius:9px;border:1px solid {it.border};color:{it.color}` + 7px dot |

### C-15 `Avatar`

Props `{initials, size: 20|22|24|26|28|30, tone:'neutral'|'accent', title?}`. Initials = first letter of each word (`initials()` logic 3891).

| Size | Font | Tone usage |
|---|---|---|
| 30 | 11px | accent (`bg accent-800; color accent-200`) — "me" in My work, dept head |
| 28 | 11px / 10.5px | neutral (`bg neutral-800; color neutral-200`) people lists, comments; accent for sidebar viewer |
| 26 | 10px | neutral (approvals, NCR) ; accent-900/accent-200 + 500 weight for keyed bubbles (1961) |
| 24 | 10px / 9.5px | neutral (role menu, plan owner) |
| 22 | 9.5px | neutral (WBS drawer to-dos) |
| 20 | 9px | accent (PM picker in wizard) ; neutral agenda number bubble 11px neutral-300 |

All `border-radius:50%;display:grid;place-items:center;flex:none`.

### C-16 `StatusDot`

`width/height: 6|7|8|10px; border-radius:50%; background:{dot}` (+ optional `box-shadow:{ring}`). Used for unread, board columns, stepper, approvals mini-chain (3 dots `8px`, 2716), billing legend rows (10px).

### C-17 `IconTile`

| Variant | CSS |
|---|---|
| Alert/notification | `width:28px;height:28px;border-radius:7px;background:var(--color-accent-900);color:var(--color-accent-300);display:grid;place-items:center` |
| File | `30×30; radius 6px; background:neutral-900; color:accent-300` (Task files 2934) |
| Brand | `26×26; radius 7px; border:1px solid accent; color accent; glow 0 0 14px accent 40%` |

### C-18 `ProgressBar` family

| Variant | Track | Fill | Where |
|---|---|---|---|
| `inline` (table cell) | `width:64px;height:5px;border-radius:3px;background:neutral-800` | `height:100%;border-radius:3px;background:accent` (or `{p.barColor}`) + label 12px tabular | Overview 259, Projects 734/748 |
| `card` | `height:4px;border-radius:2px;background:neutral-900;overflow:hidden` | `linear-gradient(90deg,var(--color-accent-700),var(--color-accent-500))` | My projects 205 |
| `thin` | `height:3px;border-radius:2px;background:neutral-800` | accent | Task checklist 2921, board cards 2878 |
| `md` | `height:6px;border-radius:3px;background:neutral-800[;overflow:hidden]` | accent / `{barColor}` | Task progress/time, plan progress cell, score |
| `capacity` | `position:relative;height:8px;border-radius:4px;background:neutral-900` | demand `accent` if over capacity else `neutral-600`; tick `position:absolute;top:-3px;width:2px;height:14px;background:neutral-300;left:{capacity%}` | Resources 615–618; scale = `max(cap,dem)*1.1` |
| `capacityStack` | same 8px track, `display:flex;overflow:visible` | committed `neutral-600` (radius 4 0 0 4) + candidate `accent` (0 4 4 0) + tick | Portfolio what-if |
| `spendVsEarned` | `position:relative;width:84px;height:5px;radius 3;neutral-800` | spent `neutral-300`; earned marker `position:absolute;top:-3px;width:2px;height:11px;background:accent;left:{progress%}` | Overview 260 + legend 269 |
| `bullet` (cost breakdown) | `position:relative;height:10px;border-radius:3px;background:neutral-900;display:flex;overflow:visible` | actual `neutral-300` (radius 3 0 0 3, width a/b/1.4), committed `neutral-700` (c/b/1.4), budget tick `top:-3px;height:16px;width:2px;neutral-500;left:1/1.4`, forecast diamond `8×8 rotate(45deg) accent` at `min(fc/b,1.4)/1.4` (`margin-left:-4px;transform:translateY(5px) rotate(45deg);top:-4px`) | Budget 365–370 (logic 3844) ; WBS variant 8px with actual + tick |
| `stackedShare` | `display:flex;height:10px;border-radius:5px;overflow:hidden;background:neutral-800` | paid `accent`, invoiced `accent-700` | Billing 847 |
| `overlay` | `position:relative;height:6px;radius 3;neutral-800` | invoiced `neutral-400` then paid `accent` absolutely overlaid | Cash 2157 |
| `hatched` | `height:8px;radius 4;neutral-800;position:relative;overflow:hidden` | EMV `repeating-linear-gradient(135deg, accent-800 0 3px, transparent 3px 7px)`, used `accent` on top | Contingency 904 |

### C-19 `Drawer` (right side panel)

16 instances (`closeSel` 1106, `closeNode` 1234, `closeEco` 1347, `closeDwg` 1406, `closeDeliv` 1633, `closeStock` 1695, `closeRisk` 1816, `closeCR` 1867, `closeNcr` 1913, `closeDlv` 1956, `closeRfq` 2000, `closeInv` 2044, `closeDoc` 2347 (680px), `closePidTag` 2519, `closePart` 2583, `closePO` 2664). Props `{open, onClose, width: 640|680, header, children}`.

```
scrim   position:fixed; inset:0; z-index:60; background:color-mix(in srgb, var(--color-bg) 60%, transparent)   — click = onClose
panel   class="card elev-lg"  position:fixed; top:0; right:0; bottom:0; z-index:61; width:min(640px,100vw);
        overflow:auto; border-radius:0; padding:18px 22px; gap:12px; border-left:1px solid var(--color-neutral-800)
header  display:flex; align-items:center; gap:10px; flex-wrap:wrap
        ID 12px neutral-400 tabular (margin-right:auto) · type/status tags · btn btn-icon btn-ghost (color neutral-400) ph-x
title   .card-title  text-wrap:pretty
body    sections: Eyebrow(section) + KeyValueList / ListRow / Stepper / Callout; layout grid minmax(0,1fr) gap 18px
actions display:flex; gap:8px; flex-wrap:wrap — btn-secondary/ghost font-size:12.5px (Approve/Reject pairs: ghost 12px "Reject" + primary 12px "Approve" with ph-check)
```
No open/close animation; no Esc handling in source (Q-9). Opening is "selected id ≠ null" in state; clicking the same table row again toggles it closed (`select: s.x===id?null:id`, e.g. logic 4374).

### C-20 `Popover` / `Menu`

`.elev-md` + `position:absolute; z-index:20|30|40; display:flex; flex-direction:column; padding:6px; border-radius:8px; background:var(--color-surface)`; anchored `top:calc(100% ± 2–4px); left:0|6px` or `right:0`; header (C-06 menu); items `display:flex;align-items:center;gap:8–10px;padding:6px 8px;border:0;border-radius:6px;background:transparent|accent-900;color:text;font:inherit;font-size:12.5–13px;text-align:left;cursor:pointer` hover `neutral-900`; optional right meta `margin-left:auto;font-size:11px;color:neutral-400`. Global search & notifications add a transparent click-catcher (`fixed inset:0 z48`); the project/role/status menus do not (Q-9).

### C-21 `Dialog` (DS modal) and `FormDialog`

Instances: generic add-form `afOpenDlg` (138–158), New project wizard `npOpen` (2972–3056), Force stage change `showForce` (3058–3069), New resource request `nrOpen` (3071–3092).

```
backdrop  class="dialog-backdrop"  z-index:50 (55 for force); top-aligned: align-items:start; padding-top:8vh (af) | 6vh (np, nr)
dialog    class="dialog"  width:min(640px|720px|560px,100%); gap:14px; max-height:84vh|88vh; overflow:auto   (radius 14, padding 11.2, shadow-lg)
header    display:flex; align-items:flex-start; gap:12px → [title block margin-right:auto: .dialog-title + sub 12–12.5px neutral-400] + btn btn-icon btn-secondary ph-x
body      fields grid repeat(2,minmax(0,1fr)) gap:12px (af, wizard step 1/4)
actions   class="dialog-actions" (style display:flex;gap:8px;justify-content:flex-end; margin-top:0) — btn-secondary "Cancel" (Annuler) + btn-primary (icon + label), disabled → opacity .45
```

`FormDialog` (generic add form, logic 5111–5136, registry `AF` at 3674): props `{title, submit, kind:'create'|'run', fields: [id,label,type:'text'|'number'|'textarea'|'select', default|options|dynamic-source, required]}`. Field `grid-column: '1 / -1'` for textarea and ids `title|name|progress|reason|why`, else `auto`. Required label shows accent `*`; sub-header "{projectName} · Required fields are marked · *" (*Les champs obligatoires sont marqués ·*). Text `.input`; number `.input type=number` tabular; textarea `rows=3; min-height:72px; resize:vertical`; select `.input` with options (dynamic sources WP, TEAM, ACT, ACTOPEN, PIPE, RCAT, ITPSYS, FLEET, MSPLAN resolved by `afOpts`, 5117; select defaults to first option). Submit disabled until all required non-select fields are non-blank (`afValid`, 5120). Submit icon `ph-check` (create) or `ph-play` (run). On submit → state update + toast.

`Wizard` (New project): step bars `grid repeat(4,1fr) gap:6px`, each `height:2px;border-radius:1px;background: i<step ? accent : neutral-800` + label 11.5px (current `text`, else `neutral-400`); steps Basics / Structure / Budget / Schedule; footer Back (secondary, from step 2), Next (primary + `ph-arrow-right`), Create project (primary + `ph-check`) on step 4. Choice cards (step 2, 3002–3005): `button` `display:flex;flex-direction:column;gap:6px;text-align:left;padding:12px;border-radius:8px;background:neutral-900;border:1px solid {accent|neutral-800}` hover `border-color:accent-700`; radio dot 14px `border 1.5px {accent|neutral-600}; background {accent|transparent}; box-shadow {inset 0 0 0 3px neutral-900|none}`.

### C-22 `CenteredModal`

Instances 2364 (Codex deposit), 2453 (engineering list import). Scrim `fixed inset:0 z70 background: bg 65%`; panel `.card.elev-lg` `position:fixed;z-index:71;top:50%;left:50%;transform:translate(-50%,-50%);width:min(640px|720px,96vw);max-height:92vh;overflow:auto;padding:18px 22px;gap:14px`. Uses the **numbered stepper** (C-26). Sits above drawers.

### C-23 `Toast`

Line 160; logic `showToast` 5116. Single global toast: `class="card elev-lg"` `position:fixed;right:22px;bottom:22px;z-index:80;display:flex;align-items:center;gap:10px;padding:10px 14px;font-size:13px;max-width:min(420px,90vw);border:1px solid var(--color-accent-800)`; icon `ph-check-circle` 18px accent `flex:none`; text `text-wrap:pretty`; close `btn btn-icon btn-ghost` `color:neutral-400;margin-left:4px` `ph-x`. Behaviour: replaces the current message, auto-dismiss after **4000 ms** (timer reset on each call), close button clears `state.toast`. In FR the message is translated segment-by-segment on `' · '`. No variants (success only).

### C-24 `Callout` / `Notice` / `InsetPanel`

| Variant | CSS | Count / lines |
|---|---|---|
| `info` | `display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--color-neutral-300);padding:10px 12px;border-radius:8px;background:var(--color-neutral-900)` + icon accent | ×12 (zone empty, read-only, margins masked…) |
| `info-outlined` | same + `padding:9px 12px;box-shadow:inset 0 0 0 1px var(--color-neutral-800)` | 127, 199 |
| `emphasis` | `display:flex;gap:8px;align-items:flex-start;font-size:12.5px;line-height:1.45;color:var(--color-neutral-200);padding:10px 12px;border-radius:8px;background:var(--color-accent-900)` icon `margin-top:2px` | ×5 (critical-path warning, locks) |
| `emphasis-bordered` | neutral-900 bg + `border:1px solid var(--color-accent-800)` | 2526 |
| `compact` | `font-size:12px;padding:8px 10px` (accent-900 or neutral-900) | ECO 1358/1364/1365, stock 1704 |
| `inset panel` | `display:flex;flex-direction:column;gap:4–8px;padding:10px 12px|12px;border-radius:8px;background:var(--color-neutral-900)` + eyebrow | meetings prep, wizard summary |
| `bordered panel` | `padding:10px 12px;border-radius:8px;border:1px solid var(--color-neutral-800)` | transcript, add-note |
| `paragraph note` | `font-size:12.5px;line-height:1.5;color:neutral-300;padding:10px 12px;radius 8;background:neutral-900;text-wrap:pretty` (with accent-300 inline figure) | Budget TCPI note 350 |

### C-25 `EmptyState`

| Variant | CSS | Examples (EN → FR where available) |
|---|---|---|
| `inline` | `font-size:12.5px;color:var(--color-neutral-500);padding:8px 0` (×17) — also `4px 0` ×9, `6px 0` ×3, `10px 0` ×2 | "Nothing waiting" (*Rien en attente*), "No ECO in this status", "No drawing matches", "No risk in this category", "No checklist yet", "No files attached", "No comments yet", "All milestones invoiced" |
| `boxed` | `font-size:12.5px;color:var(--color-neutral-400);padding:14px;text-align:center;border-radius:8px;background:var(--color-neutral-900)` (×15) | "No contract registered for this project", "No meeting in this view", "No stakeholder yet", "No interface registered", "No engineering register for this project yet — import the first list to start." |
| `boxed-lg` | `font-size:13px;padding:16px` same | Approvals "Nothing waiting — every request for …" |
| `column` | `font-size:12px;color:neutral-500;padding:8px 2px` | Board "Nothing here" (*Rien ici*) |
| `menu` | `font-size:12px;color:neutral-500;padding:6px 8px|8px` | "No page matches", "No project in this scope · search the whole portfolio" |
| `dropzone` | `width:100%;aspect-ratio:5/1;border:1px dashed var(--color-neutral-700);border-radius:8px;display:grid;place-items:center;font-size:12px;color:neutral-500` "Drop a file or click to choose" | Hours imports 2256 |

### C-26 `Stepper` family

- **FlowStepper** (ECO 1350, NCR 1917, Delivery 1960, PID 2484, PO 2668): row `display:flex;align-items:center;flex-wrap:wrap;font-size:11.5px;color:neutral-400`; item `gap:6px` → dot 10px (`s.dot`, + `s.ring` glow) + label (`s.color`) + connector `width:36px;height:1px;background:neutral-800;margin:0 8px` except last. Optional right meta "Raised by …" `margin-left:auto`. Flows: `PO_FLOW` (3414), `ECO_FLOW` (3431), `DELIV_FLOW` (3474), `NCR_FLOW` (3506), `DELIV_FLOW2` (3514).
- **NumberedStepper** (deposit/import, logic 4813/5052): number bubble 18px (`background: step≥i ? accent-600 : neutral-700; color neutral-100; 10.5px`) + label (`accent-200` current, `text` done, `neutral-500` future).
- **WizardBars** (C-21).
- **StageSlider** (C-30).

### C-27 Check controls

- `CheckCircle` (task done toggle, 2840): button `18×18;border-radius:50%;border:1.5px solid {ringColor};background:{fill};display:grid;place-items:center;padding:0` + `ph-check` 10px `color:var(--color-bg)` when done. 14px variant in WBS drawer (1150, glyph 9px).
- `CheckSquare` (checklist, 2924): `16×16;border-radius:4px;border:1.5px solid {ring};background:{fill}` + `ph-check` 10px bg; row button `gap:10px;padding:7px 0;border-bottom:1px solid neutral-900;font-size:13px`; done text `line-through` neutral-500.
- `IconCheck` (meeting actions 770, 809): icon button 16–17px, `ph-fill ph-check-circle` accent-300 when done / `ph ph-circle` neutral-500; or `ph-check-square`/`ph-square` (stage deliverables 708, colour `d.color`).
- `RadioDot` (wizard template cards) — C-21.

### C-28 `LegendItem`

Container `display:flex;gap:14px;font-size:12px;color:neutral-300` (chart headers) or `11.5px neutral-400` (footers); item `display:flex;align-items:center;gap:6px`. Swatch kinds: line (`width:14px;border-top:2px solid|dashed|dotted <color>`), block (`10×10 radius 2`, `12×6 radius 2`, `12×5 radius 2`), bar (`16×8 radius 2` + `box-shadow inset 0 0 0 1px <edge>`, `18×8`), baseline (`16×4` / `18×3`), diamond (`8×8;transform:rotate(45deg)`), tick (`2×10`), hatched (`18×8; border:1px dashed neutral-600; background:repeating-linear-gradient(135deg, neutral-600 0 2px, transparent 2px 6px)`), dashed outline (`18×8;border:1px dashed accent-700`), heat scale (5 swatches `16×10 radius 2` between "Under"/"Over" labels — *Sous*/*Sur*).

### C-29 `AttachmentRow`, `CommentRow`, `TimeEntryRow`

Task screen (2932–2958): file row `display:flex;align-items:center;gap:10px;padding:6px 0;border-top:1px solid neutral-900;font-size:13px` + file IconTile; comment `grid 28px minmax(0,1fr); gap:10px; padding:8px 0; border-top` with 28px avatar; composer `display:flex;gap:6px` → `.input min-height:34px;font-size:13px` + `btn-primary 12.5px "Post"`. Time entries `grid 96px minmax(0,1fr) auto; 12.5px; padding:5px 0`; logger `grid 72px minmax(0,1fr) auto; gap:6px`.

### C-30 `StageSlider` (project lifecycle filter)

Lines 641–660; logic 3903–3915. Container scrolls horizontally (`flex:1 1 760px;overflow-x:auto` → inner `min-width:780px;padding:0 36px`). Element: `tabIndex=0 role="slider" aria-valuemin=0 aria-valuemax=13 aria-valuetext={label}`; `position:relative;height:66px;cursor:pointer;outline:none;touch-action:none;user-select:none;border-radius:6px`; focus `box-shadow:0 0 0 2px var(--color-accent-800)` (via `style-focus`).

- Track: `position:absolute;left:0;right:0;top:11px;height:2px;border-radius:1px;background:neutral-800`; fill to thumb `accent-700`.
- Ticks: 14 = "All" + 13 `STATUSES` (incl. Annulé), `left = i/13*100%`, wrapper 60px wide centred (`translateX(-50%)`), `pointer-events:none`. Dot: index 0 → 6×6 square radius 2 (`margin-top:9px`), others 8×8 circle (`margin-top:8px`); colour selected `accent` + ring `0 0 0 4px accent-900`, past `accent-700`, has projects `neutral-500`, empty `neutral-800`. Odd ticks drop their label 14px lower with a 1px `neutral-800` connector (`lift`), so labels never collide. Label 10.5px (selected `accent-300` weight 500; has projects `neutral-300`; empty `neutral-600`); count 10.5px `neutral-500` tabular.
- Thumb: `top:4px;16×16 circle;background:var(--color-bg);box-shadow:inset 0 0 0 2px accent, 0 0 10px accent 55%;transition:left .16s ease`.
- Interaction: pointer down captures and snaps to nearest index (`round(x/width*13)`), drag updates live, keys ←/↓ −1, →/↑ +1, Home → All, End → last; writes `statusFilter` (null = All) and closes `statusMenu`. Side text: selected label 13px/500, description 11.5px neutral-400, hint 11px neutral-500 ("Drag the cursor or use ← → to change stage" / "Drag the cursor to filter by stage").

### C-31 `ImageSlot` wrapper

See RT-IMAGESLOT. Wrapper `<div style="width:100%;aspect-ratio:4/3|16/9|16/7|16/8">` + `<image-slot id shape="rounded" radius="8" fit="contain|cover" placeholder>`; preceded by a section eyebrow ("Photos", "Document").

---

## DS-CHARTS — Charts & data-viz primitives

All charts are hand-built (no chart library). SVG charts use a fixed `viewBox` and `width:100%;height:auto;display:block` (responsive by scaling). **SVG strokes/fills are raw hex** equal to tokens:

| Hex in SVG | Token |
|---|---|
| `#9184d9` | `--color-accent` |
| `#b5abfc` | `--color-accent-400` |
| `#5d5294` | `--color-accent-700` |
| `#e4e7f5` | `--color-neutral-200` |
| `#b2b6ca` | `--color-neutral-400` |
| `#9397ab` | `--color-neutral-500` |
| `#75798c` | `--color-neutral-600` |
| `#595d6c` | `--color-neutral-700` |
| `#292b31` | `--color-neutral-900` |
| `#161826` | `--color-bg` |

Rebuild with `var(--…)` / `currentColor` (lint rule).

### CH-1 `EvmSCurve` (Budget › Performance, template 311–332, logic 3818–3828)

- viewBox `0 0 760 290`; margins `L=52, R=16, T=14, B=30`; `ymax = BAC × 1.17`.
- `x(m) = L + m/12 × (W−L−R)`; `y(v) = T + (1 − v/ymax) × (H−T−B)`.
- Grid step = first of `[100,200,250,500,1000,2000]` with `ymax/step ≤ 6.5` (fallback 2000); grid values 0..ymax. Grid line `x1=52 x2=744 stroke=#292b31`; label `x=44, y=y+4, 11px, anchor end, #9397ab`, text `f(v)` with `.00` stripped, `0` for zero.
- Month labels: `PD.chartMonths[i]` at `x(i+.5)`, `y=282`, 11px middle.
- Series path builder: `'M' + [[0,0], …a.map((v,i)=>[i+1,v])] → "x y"` joined by `' L'` (cumulative values starting from 0 at month 0).
  - PV: `stroke=#75798c; stroke-width:2; dasharray 5 4`.
  - EV: `stroke=#9184d9; width 2.5`; EV area = EV path + `L x(EVn) y(0) Z`, filled with vertical gradient `#9184d9` opacity .28 → 0 (`id="evfill"`).
  - AC: `#e4e7f5` width 2.
  - Forecast: straight line from `(x(EVn), y(AC_last))` to `(x(12), y(EAC))`, `#e4e7f5` width 2, dasharray `1 4`, round caps.
- BAC line `y(BAC)`, `#595d6c`, dasharray `2 4`; label "Budget at completion · {BAC}" (*Budget à l’achèvement ·*) at `x=56, y=y(BAC)−6`, `#b2b6ca`.
- Today line `x(EVn)`, `y 10→262`, `#5d5294`; label "Today" (*Aujourd’hui*) at `x+6, y=22`, `#b5abfc`.
- Payment-term steps (`offerPoints(PD.OFFER)`): circles `r=3.5 fill=#161826 stroke=#9397ab width 1.5` at `(x(m+1), y(PV[m]))` with `<title>` "{system} · deposit|delivery|acceptance {pct} % · {amount} · {month}".
- EAC marker circle `r=4 fill bg stroke #e4e7f5 width 2` at `(x(12), y(EAC))`; label "EAC {value}" anchor end at `(x(12)−10, y(EAC)−10)`.
- Legend (304–309): PV dashed neutral-500, EV solid accent, AC solid **neutral-100**, Forecast dotted neutral-100 (Q-16).
- Formulas (logic 3787–3788): `EVn = EV.length`; `ev, ac, pv` = last values; `CPI = ev/ac`, `SPI = ev/pv`, `EAC = BAC/CPI`, `VAC = BAC − EAC`, `TCPI = (BAC − ev)/(BAC − ac)`.

### CH-2 `CashRecoveryChart` (Budget › Cash, template 461–471, logic ~4918–4920)

Same frame (760×290, `min-width:560px`, margins as CH-1 via `rcX/rcY`), month labels 10.5px. Series: committed cumulative `#e4e7f5` 2 (+ forecast dotted), client receipts `#9184d9` 2.5; at today a vertical "gap" segment between the two curves (`stroke=#b5abfc;width 3;round;opacity .6`) with its amount label; lowest point marker `r=4` accent stroke with `<title>` "Lowest point". Legend 456–459.

### CH-3 `TrendLineChart` (Trends, template 1751–1758, logic 4561–4563)

`spark(arr, 760, 220, target)`: margins `L48 R16 T14 B26`; `lo = min(arr ∪ target)`, `hi = max(arr ∪ target)`, pad = `(hi−lo)×.15 || 1`; `x(i) = L + i/(n−1)×(W−L−R)`; `y(v) = T + (1−(v−lo)/(hi−lo))×(H−T−B)`. Grid at `t ∈ {0,.25,.5,.75,1}` (y = `T + t(H−T−B)`, label = formatter(hi − t(hi−lo)), `x=42`, 10.5px, `dominant-baseline:middle`); x labels `SNAP_WEEKS` at y 212; target line dashed `5 4` `#75798c` (if target); area gradient `#9184d9` .25→0 (`id="trfill"`, area closes at baseline `H−B`); path accent 2.5; last point circle r4 bg/accent.

### CH-4 `Sparkline` (trend cards, logic 4564)

`mini(arr)`: `W=120, H=32`; `x = i/(n−1)×W`; `y = hi===lo ? H/2 : 2 + (1−(v−lo)/(hi−lo))×(H−4)`; `<svg viewBox="0 0 120 32" style="width:120px;height:32px">`, path `stroke=#9184d9;stroke-width:1.5;fill:none`. Delta text compares last vs 4 weeks earlier (`a[a.length−5]`); "worse" = higher for eac/risk/slip, lower otherwise → LO colour.

### CH-5 `ColumnPairChart` (Schedule progression 546–557; Client progress ~2189)

Grid `repeat(12,1fr); gap:8px; height:170px; align-items:end; padding-top:8px`; column `flex column; align-items:center; gap:5px; justify-content:flex-end`: SPI label 10.5px tabular (LO when `<0.93`, else neutral-400), bar pair container `display:flex;gap:2px;align-items:flex-end;width:100%;height:120px`, bars `flex:1;border-radius:2px 2px 0 0` planned `neutral-700` height `PV[i]/BAC`, actual `accent` height `EV[i]/BAC`; month label 10.5px neutral-400. Client variant 150/120px, 9 months.

### CH-6 `DivergingBars` (Budget › Variance, 342–348)

`display:flex;gap:6px;height:110px;align-items:start;border-top:1px solid neutral-800;padding-top:1px` — bars hang from the zero line: `width:100%;border-radius:0 0 3px 3px;background:linear-gradient(var(--color-accent-700), var(--color-accent-500));height:max(3, |cv|/cvMax×80)%`; label 10px neutral-400 (first letter of month). `cv_i = EV_i − AC_i`.

### CH-7 `CashFlowBars` (Cash 2169–2174)

6 columns `flex:1`, `height:150px`, inner `height:100px`; net label 10px coloured; in `accent`, out `neutral-600`; legend "Cash in"/"Cash out".

### CH-8 `Gantt` (project) — Schedule 506–538

- Grid `230px 56px 64px minmax(560px,1fr)`, `min-width:900px`; header cells `11px .08em uppercase neutral-400 padding:6px 0 border-bottom:1px solid neutral-800` ("Work package", "Done", "Slip"); timeline header `repeat(13,1fr)`, labels 11px neutral-400 `padding:6px 0 6px 6px;border-left:1px solid neutral-900`.
- Row height 44px, `border-bottom:1px solid neutral-900`; name 13px + `ph-lightning` 12px accent for critical + owner 11.5px; % done right-aligned 13px; slip `+Nd` (LO if >14 d).
- Timeline cell background: `repeating-linear-gradient(to right, var(--color-neutral-900) 0 1px, transparent 1px calc(100% / 13))` (month gridlines).
- Positions: `pos(m) = pct(m/13)` (months from project start, float). Baseline bar `top:31px;height:4px;radius 2;neutral-700;left:pos(bs);width:pos(be−bs)` (only if `showBaseline`). Actual/forecast bar `top:10px;height:16px;radius 4;overflow:hidden;left:pos(as);width:pos(ae−as);background:barBg;box-shadow:barEdge` with inner fill `width = % complete` (`fillBg`). Today line `1px accent opacity .7` at `pos(PD.tNow)`.
- Milestone row: baseline diamond `9×9 rotate 45 inset 1px neutral-600 top 17` at `pos(b)`; forecast diamond `11×11 top 16` at `pos(fc)` coloured `neutral-400` (Done) or `accent`; "Today" chip `top:-2px;10px;accent-300;padding:0 4px;background:surface;radius 3;translateX(-50%)`.
- Legend: Critical path (*Chemin critique*) `16×8 accent-800 + inset accent`, Task (*Tâche*) `16×8 neutral-800 + inset neutral-600`, Baseline (*Référence*) `16×4 neutral-600`, Milestone (*Jalon*) diamond accent.

### CH-9 `PortfolioGantt` — Portfolio schedule 984–1020, logic 4525–4550

- Grid `240px 172px 170px minmax(760px,1fr)`, `min-width:1342px`; 24 months (`PG_MONTHS`), header shows year (10px neutral-500, only on January) over month (10.5px neutral-400); month border-left `neutral-700` at year start else `neutral-900` (`pgMonths`, 4552); background gridlines `calc(100% / 24)`.
- Groups "In progress" / "Pipeline" with group-divider eyebrow.
- Row: name button (13px, ellipsis `max-width:230px`, hover accent-300) + PM · client; status tag 10.5px; gate column (next decision / forecast finish, 12.5px + 11.5px coloured sub).
- Segments (pre-execution plan): stages Initiative/APS/APD bars `top:14px;height:14px;radius 4;background: done ? neutral-600 : neutral-700`, label 9.5px .06em (`INI`, `APS`, `APD`) when ≥0.8 month wide, label colour neutral-200 (done) / neutral-300; group-board segments `top:15px;height:12px;radius 2;background:repeating-linear-gradient(135deg, var(--color-neutral-600) 0 2px, transparent 2px 6px);border:1px dashed (current ? accent : neutral-600)`, current glow `0 0 10px accent 45%`; board decision diamond `10×10 rotate 45 translateX(-5px)` at segment end: done `accent-300`, current `accent` + glow 60%, future transparent with `neutral-500` border; titles "Group board · Approved|Decision pending|Planned".
- Execution bar `top:12px;height:18px;radius 4;overflow:hidden`: active `background:accent-800; box-shadow:inset 0 0 0 1px accent-700`, inner fill `accent` = progress %; pipeline ("if approved") `transparent; border:1px dashed accent-700`. Baseline (when slipping) `top:34px;height:3px;neutral-600`. Clipped beyond 24 months → right chip "→ {finish}" (10.5px neutral-400 on surface). Today line as CH-8.
- Legend 979–986 (In progress, Pipeline, Group decision pending, Group board, Execution if approved, Baseline finish).

### CH-10 `AllocationHeatmap` (Resources 590–606)

Grid `minmax(150px,200px) repeat(8,minmax(0,1fr)) 52px; gap:4px`; person cell (40px high, 28px neutral avatar, name 13px, role 11.5px; hover neutral-900; click → My work for that person); value cells `height:34px;border-radius:5px;display:grid;place-items:center;font-size:12px;tabular` coloured by `shade(v)` (DS-TONES); average column right-aligned 13px (LO if >100). Legend Under→Over.

### CH-11 `RiskMatrix` (Risks 1801–1811)

5×5 grid `18px repeat(5,1fr); gap:4px`; rows impact 5→1, columns probability 1→5; cells `aspect-ratio:1;border-radius:5px;font-size:10.5px;tabular;padding:2px` showing risk IDs, colour `rCell(p,i)`; axis labels 11px neutral-400; legend Critical ≥ 15 (*Critique ≥ 15*), High ≥ 8 (*Élevé ≥ 8*), Medium ≥ 4 (*Moyen ≥ 4*).

### CH-12 Dot ratings, RACI, commissioning matrix, calendar

- `DotRating`: 5 dots `8×8` circle `gap:2px` (portfolio axes 2097–2099; skills via `lvColor`).
- `RaciMatrix` (Stakeholders ~874): `grid 220px repeat(6,minmax(96px,1fr)); gap:4px; min-width:820px`; cells per RACI helper.
- `CommissioningMatrix` (~915): `grid 200px repeat(5,minmax(130px,1fr)) 90px`; cell per `cmStatus` with icon.
- `WeekCalendar` (My work 2885–2898): `grid 200px repeat(10,minmax(56px,1fr)); min-width:780px`; day header (weekday 10.5px, date 13px; today `bg accent-900`); task bars `top:9px;height:22px;border-radius:5px;padding:0 8px;font-size:11.5px` coloured by `t.bg/t.fg/t.edge`; weekend/holiday shading; planned-hours footer row.

---

## RT-SUPPORT — `support.js` behaviours the UI relies on

**Purpose:** the "x-dc" runtime (generated from `dc-runtime/src/*.ts`) compiles the `<x-dc>` template to React elements against the object returned by `Component.renderVals()`. The rebuild replaces it with real React components; only these semantics matter:

| Feature | Semantics (support.js line) | Rebuild equivalent |
|---|---|---|
| `{{ expr }}` text | Resolved by path (`a.b`, `a[0]`) against render values; `undefined` → nothing (console warn), `null`/boolean → nothing, React element/array rendered, else `String(v)` inside `<span class="sc-interp">` (560–610) | JSX expressions |
| Attribute binding | Whole-value `{{ x }}` passes the raw value (function, boolean, object); mixed strings interpolate with `?? ""` (406–417) | props |
| `style="…"` | String parsed to a style object (`cssToObj`, 395); CSS custom properties preserved | style objects / CSS modules |
| `class` / `for` | → `className` / `htmlFor` | — |
| Events | `onClick`, `onChange`, `onKeyDown`, `onFocus`, `onMouseEnter/Leave`, `onPointerDown/Move/Up/Cancel` used; camelCase preserved via `sc-camel-` encoding (316–375); React synthetic events (`onChange` on inputs fires per keystroke) | same |
| Controlled inputs | `value`/`checked` that resolve to `undefined` become `""`/`false` (800–803) | controlled components |
| `<sc-if value hint-placeholder-val>` | Renders children when value is truthy; no else-branch. `hint-placeholder-val` is only used while the design tool streams (placeholder preview) (646–658) | `{cond && …}` |
| `<sc-for list as hint-placeholder-count>` | Iterates arrays (non-arrays → nothing + warn); exposes `as` var and `$index`; keys = index (612–644) | `.map` with stable keys (use ids) |
| `style-hover="css"` / `style-focus="css"` | `style-<pseudo>` attributes compile to a generated class `.scpN:<pseudo>{…}` inserted in a runtime stylesheet; **declarations are made `!important`** (`importantify`, 1567–1590), so hover styles override inline styles (e.g. an active nav item's accent-900 bg turns neutral-900 on hover) | CSS `:hover`/`:focus` rules in component styles (decide whether to keep the override, Q-13) |
| `ref="{{ r }}"` | Passed through as React `ref`; logic creates `React.createRef()` — `navQRef` (sidebar quick jump, focused by ⌘/Ctrl+K, logic 3764–3765) and `mapRef` (map iframe for `postMessage`, logic 5077–5078) | `useRef` |
| `<helmet>` | Injects head content (stylesheets/scripts/style) | app `index.html` / CSS imports |
| Table tags | `table/thead/tbody/tr/td/th/select` are wrapped as `sc-raw-*` during parsing so control-flow tags can live inside tables (303–388) | — |
| Logic class | `class Component extends DCLogic` with `state`, `setState(patch|fn, cb)` (shallow merge), `componentDidMount/WillUnmount`, `renderVals()`; error boundary per component | React state/store |
| Props | From `data-props` (currency, showBaseline, startScreen) | app config |

Other runtime CSS (`sc-placeholder`, streaming shimmer, error overlay) is tooling-only and must not be ported.

---

## RT-IMAGESLOT — `<image-slot>` (`image-slot.js`)

**Purpose:** an omelette starter web component — a user-fillable image placeholder. In the prototype it stands in for **document/photo previews** that the real app must source from storage (PDM previews, delivery receipt photos, issued deliverables, P&ID sheets).

| Attribute | Meaning |
|---|---|
| `id` | Persistence key (required to survive reload); drops persist to a `.image-slots.state.json` sidecar via the omelette bridge — read-only outside that runtime |
| `shape` | `rect` \| `rounded` (default) \| `circle` \| `pill` |
| `radius` | px for `rounded` (default 12; app uses 8) |
| `mask` | any CSS `clip-path` (overrides shape) |
| `fit` | `cover` (default) \| `contain` — initial framing; user can reframe (double-click/Edit: drag to move, wheel/corner handles to scale, Esc/click-out commits) |
| `placeholder` | empty-state caption (default "Drop an image") |
| `src`, `credit`, `credit-href` | optional initial image + attribution overlay (Unsplash requires credit) |

Sizing: fills its container (100%×100%); with indefinite parent height falls back to full width at 3:2.

| Usage (template line) | Wrapper | Attributes |
|---|---|---|
| Drawing drawer 1410 | `aspect-ratio:4/3` | `id={{ dwg.slotId }} fit=contain placeholder="Drop the PDM preview (PDF / PNG export)"` |
| Delivery (goods receipt) drawer 1650 | eyebrow "Photos", `aspect-ratio:16/9` | `id={{ deliv.slotId }}` "Drop receipt photos" |
| Quality deliverable drawer 1963 | eyebrow "Document", `aspect-ratio:16/7` | `id={{ dlv.slotId }} fit=contain` "Drop the issued document (PDF preview)" |
| P&ID screen 2479 | `aspect-ratio:16/8` | `id="pid-hlt-026" fit=contain` "Drop the P&ID (PDF / PNG) — sheets 1–4" |

Rebuild: a `DocumentPreview` component (rounded 8px, contain/cover, drop/upload when the user may write, otherwise a read-only viewer), backed by the document store (Q-18).

---

## SCR-WORLDMAP-FRAME — `Keystone PM map.html` (projects map page)

### 1. Key / route / visibility

- Embedded page, not a navigable route. Loaded in an `<iframe ref={{ mapRef }} src={{ mapSrc }} title="Projects map">` by the **`worldmap`** screen (`isWorldMap = screen==='worldmap'`, logic 5223; `startScreen` option `worldmap`).
- Nav: sidebar section **Portfolio** › "Projects map" (*Mappemonde des projets*) icon `ph-globe-hemisphere-west` (logic 5145). Page title "Projects map"; crumb extra "{n} projects located{ · zone}" (`CRUMB_EXTRA.worldmap`).
- Roles: director (all screens), `pm`, `depthead` (`ROLE_SCREENS`, logic 3465). Others see it only via the "Outside my workspace" path.

### 2. Purpose

Geographic view of the EPC portfolio: where projects (sites) are, which are in execution vs pipeline vs closed, which are at risk — with click-through to the project plan. Respects the portfolio **zone** filter (Europe & North America / Africa / Asia Pacific, `ZONES` 3170).

### 3. Layout

Host screen (template 215–235): KPI grid (`minmax(160px,1fr)`), then `grid-template-columns:minmax(0,1fr) clamp(240px,28%,320px); gap:14px; align-items:start`:
- Left: `.card.elev-sm` `padding:0;overflow:hidden;height:clamp(460px,68vh,720px);position:sticky;top:14px` containing the iframe (`display:block;width:100%;height:100%;border:0;background:transparent`).
- Right: eyebrow "Sites · {n}" (accent) + optional zone-empty info callout + site group cards (`.card.elev-sm padding:10px 12px gap:4px`) — header button (`ph-map-pin` accent, city 13px/500, "country · count" 11.5px neutral-400; hover accent-300 → `focus`), project rows (`grid minmax(0,1fr) auto; padding:6px 0; border-top neutral-900; 12.5px`; name + "code · PM · client" 11px; right stack status tag + health tag at 10.5px; hover accent-300 → `highlight`; leave → `highlight null`; click → open).
- Footer hint 11.5px neutral-400: "Pan and zoom · click a marker to open the project · hover a project to highlight it on the map" (*Déplacez et zoomez · cliquez un repère pour ouvrir le projet · survolez un projet pour le mettre en évidence sur la carte*).

Map page itself (map file lines 1–40):

| Element | CSS |
|---|---|
| `html,body` | `margin:0;height:100%;background:transparent;color:text;font-family:body;overflow:hidden`; `<html lang="fr">`; links Nocturne `styles.css` |
| `#wrap` | `position:relative;width:100%;height:100%;background:radial-gradient(900px 520px at 50% 45%, var(--color-neutral-900), transparent 72%)` |
| `svg#map` | full size; `cursor:grab` (`grabbing` while active); `role="img" aria-label="Projects map"` |
| `.sphere` | `fill:none; stroke:neutral-800; stroke-width:1; vector-effect:non-scaling-stroke` |
| `.graticule` | `stroke:neutral-800; stroke-opacity:.45; stroke-width:.5; non-scaling` |
| `.country` | `fill:neutral-900; stroke:neutral-700; stroke-opacity:.7; stroke-width:.6; non-scaling` |
| `.mk .dot` | `filter:drop-shadow(0 0 6px accent 55%)` |
| `.mk text` | `11px; fill:neutral-200; paint-order:stroke; stroke:var(--color-bg); stroke-width:3px; stroke-linejoin:round` (halo) |
| `.mk .count` | `10.5px; 500; fill:accent-100; text-anchor:middle; dominant-baseline:central` |
| `.mk .hl` | highlight ring `fill:none; stroke:accent-200; stroke-width:1.5` |
| `#ctl` (`.seg`) | `position:absolute;top:10px;left:10px;display:flex`; buttons `12px;border:0;transparent;color:neutral-300;padding:6px 12px`; `.on` → `color:accent; box-shadow:inset 0 0 0 1px accent` |
| `#legend` | `absolute; left:10px; bottom:10px; flex; gap:12px; wrap; 11px; neutral-300; padding:6px 10px; radius 8; background: bg 78%`; swatch `10×10 circle` |
| `#attr` | `absolute; right:10px; bottom:10px; 10px; neutral-500` — "Natural Earth · world-atlas 2.0.2" |
| `#tip` (`.card.elev-md`) | `absolute; display:none→flex; column; gap:4px; padding:10px 12px; min-width:230px; max-width:320px; z-index:5; 12px` |
| `#tip .hdr` | `flex; gap:8px; 10.5px; .06em; uppercase; accent`; `.close` `×` 14px neutral-400 (pinned only) |
| `#tip .row` | `grid minmax(0,1fr) auto; gap:8px; padding:6px 0; border-top:1px solid neutral-900; cursor:pointer`; hover `.name` accent-300; `.sub` 11px neutral-400; `.tags` column right, `.tag` 10px |
| `#tip .open` | "Open project →" 11px accent-300 |
| `#msg` | `absolute; inset:0; display:grid (when shown); place-items:center; 12.5px; neutral-400; pointer-events:none` |

### 4. Components

- **Projection & layers:** `d3.geoNaturalEarth1()` fitted with `fitExtent([[6,6],[W−6,H−6]], Sphere)`; layers sphere, `d3.geoGraticule10()`, countries from `https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json` via `topojson.feature(topo, topo.objects.countries)`. Libraries: `d3@7.9.0`, `topojson-client@3.1.0` from unpkg with SRI.
- **Zoom/pan:** `d3.zoom().scaleExtent([1,48])`; double-click zoom disabled; transform applied to root group; on zoom markers re-render and a pinned tooltip is re-placed.
- **Clustering** (`clusters()`): greedy in projected (unzoomed) coordinates with radius `R = 18/k` (k = zoom scale): a point joins the first cluster within R, cluster centre = mean of members. Marker groups are counter-scaled (`translate(x,y) scale(1/k)`) so they keep constant screen size. Data join key = sorted member codes.
- **Labels** shown when `k ≥ 2.4` or `≤ 4` clusters: single → city at `(12,4)`; cluster → city or "{n} sites" at `(15,4)`.
- **Marker styles** (`styleOf`): cluster (n>1) circle `r=11 fill=accent-900 stroke=accent 1.5` + count text, highlight ring `r=15`. Single: `ontrack` (active & On track) `r=6 fill=accent stroke=accent-200 1`; `risk` (active & At risk/Off track) `r=6 fill=accent-300` + ring `r=10 none stroke=accent-300 1.2 dash 3 2`; `pipeline` `r=6 fill=bg stroke=accent-300 1.5 dash 2.5 2`; `closed` (closed and "other") `r=4.5 fill=neutral-600`; highlight ring `r=14`.
- **Legend** (4 entries, translated `ui` strings): On track (*Conforme*) accent dot; At risk / off track (*À risque / hors trajectoire*) accent-300 dot with dashed outline (`outline:1px dashed accent-300; outline-offset:2px`); Pipeline dashed ring `1.5px dashed accent-300`; Closed / on hold (*Clos / en attente*) neutral-600 dot.
- **View controls** (`buildCtl`): World (*Monde*) · zone label or Europe · Projects (fit). `applyView`: `world` → identity transform; `europe` → `fitBox(boxOf(zone.bounds || [-12,62,34,34]), maxK 8)`; `fit` → bounding box of projected points ±2px, maxK 10 (1 point) or 14. Animated 650 ms. `fitBox`: `k = clamp(1, maxK, 0.72 / max(dw/W, dh/H))`, centred. `boxOf([w,n,e,s])` projects 8 boundary points.
- **Initial view** (`homeView`): zone set → `europe` (zone box); else `defaultView`: `world` if longitude span > 90° or latitude span > 60°, else `fit`.
- **Tooltip**: header "{City · Country} · {n} project(s)" or "{n} sites · {n} projects" (singular by stripping trailing "s" of `ui.projects`); rows per project: name, "code · pm · client", status tag (map's own `tagClass`, Q-2) + health tag (On track neutral / At risk outline / else accent); footer "Open project →". Placement: `x = sx+16, y = sy−12`; flips left (`sx − tw − 16`) if overflowing; clamped 8px inside.

### 5. Interactions & state

| Trigger | Behaviour |
|---|---|
| Hover marker | If nothing pinned: show tooltip (`showTip(d,false)`); leave hides it |
| Click marker | Cluster whose spread × 48 > 22 px → zoom to fit its members (maxK 48), unpin; otherwise pin tooltip (with × close) |
| Click map background | Unpin + hide tooltip |
| Click tooltip row | `parent.postMessage({type:'keystone-map', action:'open', code}, '*')` |
| Host receives `open` (logic 3765) | `DEFS[code]` exists → `setState({screen:'plan', project:code, projMenu:false})`; else `setState({screen:'projects', q:code, statusFilter:null})` |
| Host hover on a project row | `mapPost({action:'highlight', code})`; leave → `code:null` → ring redraw |
| Host click on a site header | `mapPost({action:'focus', code: items[0].code})` → `focusCode`: fits the point and neighbours within 0.5 px (±1 px, maxK 12) and clears the active view button |
| Message `{action:'view', view}` | `applyView(view, true)` (not sent by host today) |
| Message `{action:'data', data}` | replace data and re-render (not sent by host today) |
| `hashchange` | re-read data; if points or zone changed and geometry loaded → re-apply home view |
| Resize | `ResizeObserver` → recompute viewBox/projection, redraw, keep view |
| Load | shows `ui.loading` ("Loading map geometry…" / *Chargement de la géométrie de la carte…*), then draws; on fetch failure shows `ui.failed` ("Map geometry could not be loaded." / *Impossible de charger la géométrie de la carte.*) and still applies the view (markers render on the graticule) |

Host message helper: `mapPost = m => mapRef.current?.contentWindow?.postMessage({type:'keystone-map', ...m}, '*')` (logic 5078). All messages are untargeted (`'*'`) — the rebuild should restrict origins (Q-17).

### 6. Data contract (URL hash)

`mapSrc = './Keystone PM map.html#' + encodeURIComponent(JSON.stringify({ui, points, zone}))` (logic 5076); the page parses `location.hash.slice(1)` (falls back to `DEFAULT_POINTS` if absent/invalid).

| Field | Type | Source / example |
|---|---|---|
| `ui` | `Record<'world'|'europe'|'fit'|'ontrack'|'risk'|'pipeline'|'closed'|'open'|'projects'|'loading'|'failed', string>` | `mapUi` (5075), FR-translated with `mapT` when `lang==='fr'`; missing keys fall back to `DEFAULT_UI` |
| `points[]` | `{code, name, city, country, lat, lng, cat, health, status, client, pm}` | `mapPts` (5074) from zone-filtered projects `zP` that have `GEO[code]` |
| `points[].cat` | `'pipeline' | 'closed' | 'active' | 'other'` | `PIPE_STAGES` → pipeline; `Clos`/`Annulé` → closed; has health → active; else other |
| `points[].health` | `'On track'|'At risk'|'Off track'|''` (translated) | `healthOf(p)` only for active |
| `points[].country`, `status` | translated strings | |
| `zone` | `{label, bounds:[west, north, east, south]} | null` | `ZONE_BOUNDS` (3172): `euna [-135,72,45,24]`, `afr [-22,40,55,-38]`, `apac [58,52,180,-50]` |

`GEO` (3169) example: `'HLT-026': {city:'Le Havre', country:'France', lat:49.49, lng:0.11}`.

Host KPIs (`mapKpis`, 5080): "Projects located" (*Projets localisés*) = located count, sub "{n} without location" or zone/"Whole portfolio"; "Sites" = distinct city|country, sub "{n} countries"; "Active on site" (*Actifs*) = cat active, sub "{n} in pipeline"; "At risk" = health ≠ On track (LO if >0), sub "{n} off track". Site groups (`mapGroups`, 5081) sorted by count desc then city.

### 7. Cross-links

Plan (`plan`) for projects with detailed data (`DEFS`), else Projects register filtered by code; portfolio zone filter shared with Overview/Projects/Schedule/Cash/Prioritisation; health from Settings rules (see Q-4).

---

## Data entities (field-level, design-system scope)

| Entity | Fields (type — example) | Source |
|---|---|---|
| `DesignToken` | `name: string` (`--color-accent`), `value: string` (`#9184d9`), `kind: 'color'|'font'|'spacing'|'radius'|'shadow'` | `_ds_manifest.json` `tokens[]` |
| `Tone` | `'alert'|'watch'|'calm'|'muted'`; text colour `LO='var(--color-accent-300)'`, `OK='var(--color-text)'` | logic 3135 |
| `TagClass` | `'tag tag-accent'|'tag tag-outline'|'tag tag-neutral'|'text-muted'` | logic helpers (DS-TONES) |
| `KpiTile` | `label: string` ("SPI"), `value: string|number` ("0.90"), `sub: string` ("Earning 90¢ …"), `color: string` (LO|OK), `icon?: string` ("ph ph-warning") | e.g. `portfolioKpis` 3802–3808, `scheduleKpis` 3859 |
| `SegOption` (render) | `label`, `icon`, `onClick`, `color`, `shadow`, `bl`, `count?` | `seg()` 3889 (input `{v,l,icon?}` or string) |
| `ChipOption` (render) | `label`, `count: string`, `badge: string`, `onClick`, `bg`, `border`, `color` | `chips()` 4110 (input `{v,l,count?}`) |
| `NavItem` | `id`, `label`, `icon`, `onClick`, `bg`, `color`, `badge?: string` (numeric or "!"), `groupLabel?`, `groupKey?`, `visible`, `section?` | `nav()` 3786, `navs` 5143–5154 |
| `NavSection` | `key`, `label`, `sub`, `items: NavItem[]`, `open`, `chev`, `badge`, `count`, `color`, `toggle` | 5166 |
| `Notification` (render) | `id`, `kind`, `title`, `sub`, `when`, `icon`, `read: bool`, `dot`, `bg`, `open()` | `myNotifs` 4706 from `NOTIFS` tuples `[id,kind,title,sub,when,read,screen,extraState,roles]` |
| `Toast` | `toast: string` (state), auto-clear 4000 ms | 5116 |
| `AddFormDef` | `title`, `kind: 'create'|'run'`, `submit`, `fields: [id, label, type, default|options|source, required?][]` | `AF` 3674 |
| `AddFormField` (render) | `id`, `label`, `req`, `isText|isNumber|isTextarea|isSelect`, `value`, `onChange`, `options:{v,selected}[]`, `span: '1 / -1'|'auto'` | 5119 |
| `FlowStep` (render) | `label`, `line: bool`, `dot`, `ring?`, `color` | 4334, 4355, 4625, 4640 |
| `StageTick` (render) | `label`, `count`, `left`, `size`, `mt`, `lift`, `pt`, `bg`, `ring`, `color`, `weight`, `radius`, `onClick` | 3913 |
| `GanttTask` (render) | `name`, `owner`, `critical`, `pctText`, `slipText`, `slipColor`, `bL,bW,aL,aW` (% strings), `barBg`, `barEdge`, `fillBg` | 3849–3853 from `TASKS` tuples `[name, owner, baseStart, baseEnd, actStart, actEnd, pct, critical]` (month floats) |
| `GanttMilestone` (render) | `name`, `bL`, `fL`, `bg`, `baseDate`, `fcDate`, `slipText`, `slipColor`, `status`, `tagClass` | 3854 from `MILES` `[name, base, forecast, status]` |
| `EvmChart` (render) | `grid[{y,ty,label}]`, `months[{label,x}]`, `pv`, `ev`, `ac`, `evArea`, `fc` (SVG path strings), `bacY`, `bacLabelY`, `bacText`, `todayX`, `todayLabelX`, `eacX`, `eacY`, `eacLabelX`, `eacLabelY`, `eacText`, `steps[{x,y,title}]` | 3820–3828 |
| `TrendChart` (render) | `path`, `area`, `targetY`, `hasTarget`, `labels[{x,label}]`, `grid[{y,label}]`, `last{cx,cy}` | 4561 |
| `HeatCell` | `v: number` (%), `bg`, `fg` | 3871 |
| `MapPoint` | `code`, `name`, `city`, `country`, `lat: number`, `lng: number`, `cat`, `health`, `status`, `client`, `pm` | 5074 |
| `MapUi` | 11 string keys (see contract) | 5075 |
| `MapZone` | `label: string`, `bounds: [w,n,e,s]` | 5076, 3172 |
| `MapMessage` | `{type:'keystone-map', action:'open'|'highlight'|'focus'|'view'|'data', code?, view?, data?}` | map file; logic 3765, 5078 |
| `ImageSlot` | `id`, `shape`, `radius`, `fit`, `placeholder`, `src?`, `credit?`, `credit-href?` | image-slot.js |
| Component props | `currency: 'EUR'|'USD'`, `showBaseline: boolean`, `startScreen: string` | data-props 3095 |

---

## Status machines / workflows (as visualised by the DS)

| Machine | States (EN → FR) | Visual component |
|---|---|---|
| Project lifecycle `STATUSES` (3136) | Initiative → APS → APD → Etudes → Approvisionnements → Fabrication & Assemblage → FAT → Expédition → Chantier → Mise Service & SAT → Garantie → Clos; side exit Annulé | `StageSlider` (C-30), `statusTag` tones, lifecycle dots, Portfolio Gantt (pipeline stages + group boards → execution) |
| Project health | On track (*Conforme*) / At risk (*À risque*) / Off track (*Hors trajectoire*) — derived, not a workflow | Health tag, map marker style |
| Purchase order `PO_FLOW` (3414) | Draft → Awaiting approval → Ordered → Partially received → Received; Cancelled | FlowStepper (3 dots: Draft, Approved, Ordered) + `poTag` |
| ECO `ECO_FLOW` (3431) | Draft → Impact analysis → In approval → Released; Rejected | FlowStepper (first 4) + `ecoTag` + approval dots |
| Delivery `DELIV_FLOW` (3474) | Announced → Received → QC pending → Accepted / Partially rejected / Rejected | `dTag` |
| NCR `NCR_FLOW` (3506) | Open → Containment → Root cause → Corrective action → Verification → Closed | FlowStepper + `ncrTag` |
| Quality deliverable `DELIV_FLOW2` (3514) | Planned → In progress → Internal review → Submitted → Accepted; Rejected | FlowStepper (first 5) + `dlvTag` |
| Task (My work) | todo → doing → review → done (`STATUS_L` 3264: To do / In progress / In review / Done) | Board columns + CheckCircle |
| Map tooltip | hidden → hover-shown → pinned → hidden (background click / ×) | map `#tip` |
| Toast | empty → shown → auto-cleared after 4 s or closed | C-23 |
| Drawer | closed (selected id null) ↔ open (row click toggles; scrim click / × closes) | C-19 |
| Wizard (New project) | step 1 Basics → 2 Structure → 3 Budget → 4 Schedule → create | C-21 |
| Numbered import/deposit | Source → Column mapping → Check & import; File & type → Metadata → Number & record | NumberedStepper |

Detailed transition rules belong to the respective screen specs; this chapter only fixes how each state is rendered.

---

## Cross-links

- Every screen spec (`01-…` onward) should reference the component names here (C-01…C-31, CH-1…CH-12) instead of restating CSS.
- Tone mappings (DS-TONES) are the single place where status → colour is defined; screen specs list states, this chapter colours them.
- `worldmap` screen ↔ `plan` / `projects` (map `open` message); ↔ portfolio zone filter (`pfZone`, shared by `overview`, `projects`, `pfplan`, `portfolio`, `cash`, `fleet`, `sav`).
- Drawers open from table rows on `plan`, `bom`, `eco`, `drawings`, `deliveries`, `stock`, `risks`, `changes`, `quality` (NCR, deliverables), `procurement` (RFQ, invoices), `docs`, `pid`, `plm`, `orders`.
- Generic `FormDialog` is reached from the header primary button on meetings, contract, billing, stakeholders, itp, interfaces, contingency, commissioning, rex, hours, fleet, sav, schedule, plan (logic 5137).
- Toasts are emitted after every create/approve/transition action across screens.
- Image slots: `drawings`, `deliveries`, `quality`, `pid`.

---

## Open questions

1. **Q-1 Mono palette semantics.** The product has no red/amber/green; "bad" is `accent-300` text / filled accent tag, "watch" is outline. Confirm this is intended for production (accessibility: colour-only distinction between accent tag and neutral tag; accent-300 vs text contrast for KPI values).
2. **Q-2 Map tag mapping differs from the app.** In `Keystone PM map.html` the *status* tag colour is derived from health/category (`tagClass(p)`), while the host uses `statusTag(status)` (exec stages = accent). Which mapping is canonical for the tooltip?
3. **Q-3 Stale map fallback.** `DEFAULT_POINTS` in the map file (e.g. NDC-031 in Lille, WSA-044 in UK) contradict `GEO` (NDC-031 Casablanca, WSA-044 Westfield WA). Drop the fallback in the rebuild?
4. **Q-4 Health thresholds.** Settings exposes editable thresholds (`ST.health.risk=0.97`, `off=0.90`, logic 4444) but `healthOf` hard-codes `.97/.90` (3916). Should health tags follow the Settings values?
5. **Q-5 Change-request tag inconsistency.** Budget › Change requests uses Approved = `tag-accent`, Pending = outline (4053); Change control uses Approved = `tag-neutral`, In review = accent (4594). Pick one.
6. **Q-6 Activity status tag inconsistency.** Plan rows: In progress = outline, Behind = accent, Not started = muted (4007); activity drawer: In progress = accent, Not started = outline (4020).
7. **Q-7 FR dictionary collision.** `FR_DICT['Complete'] = 'Avancement'` while the drawer status "Complete" should read *Terminée*; review the dictionary for similar collisions.
8. **Q-8 Responsiveness.** No breakpoints; sidebar fixed at 232px; wide grids rely on horizontal scroll. Target viewport range / tablet behaviour / collapsible sidebar?
9. **Q-9 Dismissal & focus.** Drawers/dialogs have no Esc handling or focus trap; project/role/status popovers have no outside-click close. Define standard behaviour (Esc, outside click, focus return, `aria-modal`).
10. **Q-10 Raw hex in SVG.** Charts hard-code token hex values; confirm the rebuild uses CSS variables (lint rule) — no visual change intended.
11. **Q-11 Spacing tokens vs prototype px.** DS mandates `--space-*` (2.8px multiples) but the prototype uses raw px (2–28px). For pixel fidelity, introduce app tokens matching the prototype values, or snap to the DS scale?
12. **Q-12 Segmented semantics.** `.seg-opt` is used on `<button>` with computed selected styles; should the rebuild use radio inputs (DS pattern) or `aria-pressed` buttons?
13. **Q-13 Hover `!important`.** `style-hover` declarations are `!important`, so hover overrides active/selected backgrounds (e.g. active nav item). Keep this visual behaviour or let selected states win?
14. **Q-14 Export button** in the header has no handler — scope and formats?
15. **Q-15 Outline tag size.** `.tag-outline` is 2px larger than filled tags (1px border). Keep, or compensate padding for aligned pills?
16. **Q-16 EVM legend colour.** AC/Forecast legend swatches use `neutral-100` but the SVG strokes use `#e4e7f5` (`neutral-200`).
17. **Q-17 postMessage security.** Map ↔ host messages use target `'*'` and do not check `origin`; the rebuild should replace the iframe with an in-app component or restrict origins.
18. **Q-18 Image slots.** `<image-slot>` persistence depends on the design tool's sidecar; what is the production storage (PDM, Codex document store) and who may upload?
19. **Q-19 Layering.** The generic add-form dialog (z 50) sits below drawers (z 60/61). Confirm no drawer action opens it; otherwise raise dialogs above drawers.
20. **Q-20 Icon delivery.** Phosphor is loaded as the web font bundle (all weights) from unpkg; the rebuild should probably use `@phosphor-icons/react` (regular + one fill icon). Confirm.
21. **Q-21 Inter weights.** Google Fonts loads 400–700 but only 400/500 are used; trim to 400/500?
