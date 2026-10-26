# Style guide: KANBAN—3120

The board looks like a Bauhaus poster run through a risograph: flat geometric shapes in a few spot inks, printed as halftone dots, two drums slightly out of register, on cream paper, set entirely in Space Mono. Source of truth for the values below is `kanban/public/index.html` (`:root` and the `INKS` / `GEOM` constants); keep the two in step.

This guide covers the web board. The desktop label editor (`src/`) keeps its own NYT token system, and printed labels are plain black thermal ink (see the end).

## 1. Paper and ink

| Token | Value | Use |
|---|---|---|
| `--paper` | `#F4EFE6` | Page background (the cream stock) |
| `--sheet` | `#FBF8F1` | Cards, inputs, notes: a lighter sheet laid on the paper |
| `--ink` | `#1d1d1b` | Text, rules, borders, black shapes. Never pure `#000` |
| `--grey` | `#5b564e` | Secondary text, hints, footer (AA on both papers) |
| `--red` | `#F15060` | Riso Bright Red: inactive printer, failed, danger |
| `--blue` | `#0078BF` | Riso Blue: focus ring, drop indicators, `sent` |
| `--yellow` | `#FFE800` | Riso Yellow: `queued`, accent shapes |
| `--pink` | `#FF48B0` | Riso Fluorescent Pink: second drum, memory |
| `--teal` | `#00838A` | Riso Teal: ready, `printed`, live |

Error text uses `#a3122a` (a darker red) because Bright Red text on cream fails contrast. Red is only ever a fill or border behind ink-coloured text.

Task colours are limited to `red`, `blue`, `yellow`, `pink` (server-validated). Each maps to one shape and one second-drum ink:

| Task ink | Shape | Second drum |
|---|---|---|
| red | circle | blue |
| blue | square | pink |
| yellow | quarter circle | blue |
| pink | half circle | teal |

## 2. Type

- **Space Mono only** (400, 700, 400 italic) from Google Fonts, falling back to `ui-monospace, Menlo, Consolas, monospace`.
- **Wordmark**: 700, `clamp(46px, 8vw, 118px)`, line-height .9, letter-spacing −.045em, two lines with an em dash (`KANBAN—` / `3120`), plus a pink halftone ghost offset by .05em.
- **Section headings (`.h2`)**: 700, 20–26 px, uppercase, sit on a 6 px ink rule.
- **Labels (`.label`)**: 700, 11 px, uppercase, letter-spacing .16em. Always above their field, never as a placeholder.
- **Body**: 400, 14 px, line-height 1.55. Card titles 700 16 px. Hints 12 px grey.
- Numbers in the monitor: 700, 18–26 px, unit in a `small` at .55em.

## 3. Riso techniques

1. **Halftone fill.** Shapes are filled with SVG `<pattern>` dots rotated 18°: fine screen `ht-<ink>` (4 px cell, r 1.3) and coarse `htl-<ink>` (7 px cell, r 2.5). In CSS the same screen is `radial-gradient(circle, var(--c) 0 1.3px, transparent 1.6px) 0 0 / 4px 4px`.
2. **Two drums, misregistered.** Every shape is drawn twice: the halftone pass in its second-drum ink, translated 2–7 px, and the solid key ink on top, both with `mix-blend-mode: multiply` so overlaps darken like real ink.
3. **Uneven ink.** Solid shapes go through `filter: url(#ink)` (turbulence knocks speckles out, a low-frequency displacement wobbles edges). Large type uses the lighter `#ink-soft` (speckle only).
4. **Paper grain.** One fixed `body::after` turbulence layer, multiply, opacity .32, over everything, pointer-events off.
5. **Offset shadow.** Cards cast a halftone "shadow" in their own ink, offset 7 px down-right, instead of a box-shadow.

Do not add gradients, glass, blur, glows or soft drop shadows. Depth comes from overprint and offset, never light.

## 4. Shape lock

- UI chrome is **square**: `border-radius: 0` on buttons, inputs, cards, pills, chips. Borders are 2 px ink; section rules 6 px.
- **Circles appear only as ink shapes**: Bauhaus glyphs, knobs, swatch dots, the live dot. A rounded button or card is off-system.
- Bauhaus vocabulary is fixed: circle, square, quarter circle, half circle (geometry in `GEOM`). Column glyphs: To do = red circle, Doing = yellow quarter, Done = blue square.

## 5. Components

- **Buttons**: outlined ink (`.btn`), filled ink (`.btn.solid`, hover turns blue), red fill for destructive (`.btn.danger`). Uppercase 12 px 700. Disabled = dashed border, grey text. Minimum height 36 px, 42 px on coarse pointers.
- **Primary action**: one huge underlined word (`.big`, 30–40 px, 5 px underline that turns red on hover), after the "Convert" button of the riso reference. One per screen: *Enter* on login, *Add task* on the board.
- **Text links** (`.link`): uppercase, letter-spaced, 2 px underline.
- **Printer pill**: label, big state word (READY / INACTIVE / CHECKING), reason line. Ready = teal with white text; inactive = red with ink text.
- **Inactive note**: a strip under the monitor saying the printer is inactive and that *Queue print* still works. The print button reads **PRINT** when ready and **QUEUE PRINT** when inactive.
- **Job chips**: QUEUED (yellow), SENT (blue, white text), PRINTED (teal, white text), FAILED (red, with the error underneath).
- **Knobs** (resource monitor): black riso disc with an offset halftone disc in the metric's ink, two range dots at −135° and +135°, a cream tick rotated `-135 + 2.7 × percent` degrees, value and uppercase label underneath. CPU blue, MEM pink, DISK yellow, TEMP red. With no agent a rotated red **NO AGENT** stamp overprints them.
- **History bars**: 60 halftone bars in the metric's ink with a 2 px cap, dotted baseline when empty.
- **Ink swatches**: radio inputs rendered as halftone dots with a solid offset overprint; checked = ink ring.

## 6. Layout and spacing

- Page padding `clamp(16px, 3vw, 40px)`; max width 1440 px.
- Desktop: masthead (wordmark | Bauhaus composition | status) on a 6 px rule; resource monitor (knobs | meta + history); then a 264 px *New task* column beside a three-column board.
- ≤1180 px: status drops under the masthead, the form goes above the board in two columns.
- ≤820 px: monitor and board stack to one column. ≤640 px: everything single column.
- No horizontal page scroll at 375 px. Long words wrap (`overflow-wrap: anywhere`).

## 7. Motion and accessibility

- Motion is small and mechanical: knob ticks ease over .7 s, cards lift 2 px on hover, buttons press 1 px. The live dot blinks in two steps while reconnecting.
- `prefers-reduced-motion: reduce` removes every transition and animation.
- Focus: 3 px blue outline, 3 px offset, on every interactive element (swatches ring the dot).
- Text contrast meets WCAG AA on both papers. Status is never colour alone: pills, chips and knobs always carry a word or number.
- Knobs are `role="meter"` with `aria-valuenow` and `aria-valuetext`; the printer pill is a polite live region. Drag and drop always has keyboard move buttons beside it.
- User text is only ever set with `textContent`. The `svg()` helper (template + innerHTML) takes constant markup only.

## 8. Copy

- Short, plain, uppercase for labels and states, sentence case for help text.
- Say what will happen: "The label waits in line and prints when the printer comes online."
- No emoji, no exclamation marks, no em dashes in sentences (the wordmark's dash is a mark, not punctuation).

## 9. Printed labels

Thermal labels are one-colour and functional, not riso. Layout (agent, 203 dpi, 2 mm margin): small font-1 header `COLUMN  #id6`, a 3-dot bar, the title in font 3 word-wrapped, notes in font 2 if space remains, created date in font 1 at the foot. ASCII only; `"` is escaped as `\["]`, newlines collapse to spaces.
