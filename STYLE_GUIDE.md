# Style guide: KANBAN

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
| `--teal` | `#00838A` | Riso Teal: live dot, ink shapes |
| `--teal-deep` | `#006d73` | Teal fill behind white text: READY pill, `printed` chip (6.1:1) |

Error text and invalid-field borders use `#a3122a` (a darker red) because Bright Red text on cream fails contrast and a Bright Red border reads pink. Red is only ever a fill or border behind ink-coloured text.

Task colours are limited to `red`, `blue`, `yellow`, `pink` (server-validated). Each maps to one shape and one second-drum ink:

| Task ink | Shape | Second drum |
|---|---|---|
| red | circle | blue |
| blue | square | pink |
| yellow | quarter circle | blue |
| pink | half circle | teal |

## 2. Type

- **Space Mono only** (400, 700, 400 italic) from Google Fonts, falling back to `ui-monospace, Menlo, Consolas, monospace`.
- **Wordmark**: 700, `clamp(40px, 4.4vw, 64px)` (an app screen, not a poster: the board must start in the first viewport), line-height .9, letter-spacing −.045em, one word (`KANBAN`), plus a pink halftone ghost offset by .05em.
- **Section headings (`.h2`)**: 700, 20–26 px, uppercase, sit on a 6 px ink rule.
- **Labels (`.label`)**: 700, 11 px, uppercase, letter-spacing .16em. Always above their field, never as a placeholder.
- **Body**: 400, 14 px, line-height 1.55. Card titles 700 16 px. Hints 12 px grey.
- Numbers in the monitor: 700, 18–26 px, unit in a `small` at .55em.

## 3. Riso techniques

1. **Halftone fill.** Shapes are filled with SVG `<pattern>` dots rotated 18°: fine screen `ht-<ink>` (4 px cell, r 1.3) and coarse `htl-<ink>` (7 px cell, r 2.5). In CSS the same screen is `radial-gradient(circle, var(--c) 0 1.3px, transparent 1.6px) 0 0 / 4px 4px`.
2. **Two drums, misregistered.** Every shape is drawn twice: the halftone pass in its second-drum ink, translated 2–7 px, and the solid key ink on top, both with `mix-blend-mode: multiply` so overlaps darken like real ink.
3. **Uneven ink.** Solid shapes go through `filter: url(#ink)` (turbulence knocks speckles out, a low-frequency displacement wobbles edges). Large type uses the lighter `#ink-soft` (speckle only).
4. **Paper grain.** One fixed `body::after` turbulence layer, multiply, opacity .32, over everything, pointer-events off.
5. **Offset shadow.** Cards cast a halftone "shadow" in their own ink, offset 7 px down-right, instead of a box-shadow. A card lifted by touch-drag pushes the same shadow to 13 px. The drop target is the whole column, shown with a blue halftone wash. With the columns side by side, a finger drags a card by its grip or by pressing it and moving 6 px, and the page scrolls near the top and bottom edges. With the columns stacked (≤820 px) there is no dragging at all: no grip, a swipe on a card scrolls the page, and cards move with the sheet's arrows.

Do not add gradients, glass, blur, glows or soft drop shadows. Depth comes from overprint and offset, never light.

## 4. Shape lock

- UI chrome is **square**: `border-radius: 0` on buttons, inputs, cards, pills, chips. Borders are 2 px ink; section rules 6 px.
- **Circles appear only as ink shapes**: Bauhaus glyphs, knobs, swatch dots, the live dot. A rounded button or card is off-system.
- Bauhaus vocabulary is fixed: circle, square, quarter circle, half circle (geometry in `GEOM`). Column glyphs: To do = red circle, Doing = yellow quarter, Done = blue square.

## 5. Components

- **Buttons**: outlined ink (`.btn`), filled ink (`.btn.solid`, hover turns blue), red fill for destructive (`.btn.danger`). Uppercase 12 px 700. Disabled = dashed border, grey text. Minimum height 36 px, 42 px on coarse pointers. Most board controls are **icon buttons** (`.btn.ic`): square, 36 × 36 px (42 × 42 on coarse pointers), one 20 px icon; `.ghost` hides the border until hover (Delete, Close, Today, No date). Card move arrows are icon buttons at least 40 px wide (44 on coarse pointers); a move that cannot happen is left out, not shown disabled.
- **Primary action**: one huge underlined word (`.big`, 30–40 px, 5 px underline that turns red on hover), after the "Convert" button of the riso reference. One per screen: *Sign in with Google* on the sign-in screen, a 3 px **+** and *Add* on the board.
- **Text links** (`.link`): uppercase, letter-spaced, 2 px underline, at least 24 px tall (42 px on coarse pointers).
- **Status dots**: the live dot alone while the stream is live (its word, *Live*, is visually hidden and in the tooltip); *Connecting* / *Reconnecting* / *Offline* show beside the dot because they need attention. The printer dot sits beside it with the printer icon instead of the word: teal ready, red with an ink ring when down, grey while checking. It is a button that opens Settings with *Printer and resources* expanded.
- **Printer pill**: inside the *Printer and resources* dropdown in Settings, labelled *Label printer*: big state word (READY / INACTIVE / CHECKING) and the reason on one line. Ready = deep teal with white text, lifted above the paper grain so the multiply layer cannot dull it; inactive = red with ink text. With the dot, it is the only place the printer state shows; the print button shows the printer icon when ready and the printer with a clock badge (`i-queue`) when inactive, so a queued print is told apart without words.
- **Cards**: the sheet takes its column's colour (To do `#FDE4E4`, Doing `#FFF6C4`, Done `#DDEBF6`), and the halftone shadow uses the column glyph's ink (red, yellow, blue). An urgency band runs across the top inside the border: LOW deep teal, MEDIUM yellow, HIGH red. The band colour says the level (no bar icons, by the owner's choice); the words (*High urgency*) are visually hidden and in the tooltip. In print view the urgency dots become a ring (low), a dotted disc (medium) and a solid disc (high). The due date sits at its right after a calendar icon (*Today 17:30*, *Tomorrow*, *4 Nov*), the full sentence (*Due today 17:30*) for screen readers; OVERDUE keeps its word in an inverted ink chip, the one warning on the board.
- **Job chips**: icon + colour, the word visually hidden and in the tooltip: queued = clock on yellow, sent = arrow into a bar on blue (white), printed = check on deep teal (white), failed = ! on red, with the error underneath.
- **Phone card (≤820 px, columns stacked)**: only the urgency band (urgency marks + due) and the title; notes, the print job line and the actions are hidden. Padding tightens to 9/12 px and the title drops to 15 px; the column colour and the halftone shadow stay. The title is a button stretched over the whole card (`.open`, named *Edit "title"*), so a tap or Enter/Space opens the card's sheet, already editing; its focus ring is drawn around the card.
- **Card sheet (phone)**: a native `<dialog>` opened with `showModal()` (focus trap and Escape for free). It slides up from the bottom (.22 s, none with reduced motion), full width, at most 85 vh with its own scroll, on the column's card tint with a 2 px ink top edge; its halftone shadow is thrown up out of the screen edge it stands on (centred, 560 px, shadow down-right when the layout is wide). Backdrop: ink at 38% with a halftone screen. It opens straight into editing: the urgency band (sticky, with the × close button at its right), then the edit form (title, notes, urgency, due date and time), the job line, then the actions: print, move up / move down (previous / next column), delete (inline confirm: bin on red / ×). Focus lands on the sheet's hidden heading, not the title field, so a tap does not raise the phone keyboard. There is no Save step: ×, Escape, the backdrop and the Android back gesture (a history entry pushed on open) all save what was typed and close it. A field left invalid (empty title, unreadable time) keeps its old value rather than blocking the close; only a server refusal keeps the sheet open, with the error. The page behind does not scroll; focus returns to the card. The band, job line and actions follow the task live, the sheet closes when the task is deleted, and the form is built once per opening, never clobbered by updates.
- **Knobs** (resource monitor): black riso disc with an offset halftone disc in the metric's ink, two range dots at −135° and +135°, a cream tick rotated `-135 + 2.7 × percent` degrees, value and uppercase label underneath. CPU blue, MEM pink, DISK yellow, TEMP red. With no agent a rotated red **NO AGENT** stamp overprints the discs (never the numbers); the knob sub-lines go blank and the host line is dropped, so the stamp and the printer pill say it once each.
- **History bars**: 60 halftone bars in the metric's ink with a 2 px cap, dotted baseline when empty. The header shows the window's span (`2-10% over 7 samples`), not the latest value the knob already shows.
- **Column headings** are buttons that fold the column (chevron after the name); Done starts folded, remembered per browser. A folded column still takes drops on its heading.
- **Date picker**: a field-styled button (chevron like the select) opening a calendar on the sheet with the card's halftone offset shadow: square day cells, today underlined in red, the chosen day filled ink, arrow icon buttons for the months, and *Today* (calendar with the day filled) / *No date* (calendar with ×) icon buttons. The browser's own date input is not used because it cannot take this look.
- **Editing** has no button. Side by side, a click on a card's body (not its buttons, never after a drag) or Enter/Space on its title button (*Edit "title"*) turns the card into the inline edit form; Escape, × or a click anywhere outside the card saves and closes it (no Save button). Stacked, the same opens the sheet.
- **Card order** is computed, not dragged: due date, then urgency. Drops show only the column highlight, never an insertion line.
- **Urgency swatches**: radio inputs rendered as halftone dots in the urgency's ink with a solid offset overprint; checked = ink ring. The words are visually hidden labels and tooltips.

### Icons

One sprite of `<symbol>`s inside the hidden `<svg class="riso-defs">`, used as `<svg class="icon"><use href="#i-name"/></svg>` (in script: `ico(name)`, and `ibtn(icon, label)` for an icon button). Drawn on a 24 px grid, shown at 18–24 px (20 by default; 14–16 inside the band and chips; 26–34 on *Add*). Strokes are 2.25 px (2.5 in chips and the band, 3 on *Add*) in `currentColor`, square caps and mitred corners; solid parts (gear, the queue badge, dots) fill `currentColor`. No second ink on icons: at this size a misregistered pass blurs them.

| Name | Shows | Used for |
|---|---|---|
| `i-print` / `i-queue` / `i-busy` | printer / printer + clock badge / three squares | Print, Queue print (printer down), Sending and Syncing |
| `i-bin`, `i-x`, `i-check` | bin, ×, check | Delete (and Delete for good, on red), Close / Keep |
| `i-up` `i-down` `i-left` `i-right` | arrows | Move between columns (left/right side by side, up/down stacked and in the sheet), calendar months |
| `i-plus` `i-minus` | + / − | Add task, show / hide the New task form |
| `i-gear`, `i-tag`, `i-out`, `i-install` | gear, label tag, door with arrow out, download into tray | Settings, Label editor, Sign out, Install app |
| `i-receipt` | receipt with a torn foot and three lines | Print view toggle (`aria-pressed`) |
| `i-sync`, `i-link`, `i-unlink`, `i-cal` | circular arrows, joined links, broken links, calendar | Sync now / Try again, Connect Google Calendar, Disconnect, Open Google Calendar and the due date |
| `i-today`, `i-nodate` | calendar with the day filled / with × | Date picker Today / No date |
| `i-clock`, `i-send`, `i-check`, `i-alert` | clock, arrow into a bar, check, ! | Job chips queued / sent / printed / failed |

**Accessibility rule**: an icon is always `aria-hidden`; the control that holds it carries the words in `aria-label` (with the card title where it acts on a card: `Edit "Order paper"`) and a short `title` tooltip for mouse users. A status shown as an icon keeps its word as visually hidden text (`.sr`). Touch targets stay 42 px on coarse pointers, 36 px otherwise.

**Kept as words**: section and column headings, form field labels (above their fields, as in §2; placeholders are not labels), the empty-column notes, the delete and disconnect questions, OVERDUE, the non-live stream states, *Sign in with Google*, *Connect* beside its icon (a first-time action that should not be guessed), and the *Add* word on the primary action.

## 5a. Print view

A toggle in the masthead (receipt icon, `aria-pressed`, *Print view*), remembered per browser (`kanban.printView` in localStorage), turns the whole board into a thermal receipt print: `html.pv` sets every token to pure black on white (`--paper`/`--sheet` `#fff`, `--ink` and all riso inks `#000`) and patches the places where an ink was a fill behind ink text (urgency band, chips, danger buttons, inactive pill: white with black, or inverted). Rules for the theme:

- Only black and white. Greys exist only as 1-bit halftone dots (card shadows, the backdrop, the *checking* printer dot); no flat grey, no tint. Art (Bauhaus composition, column glyphs, knobs) goes through the `#bw` SVG filter: luminance threshold at .9, so every ink prints black. The paper grain is off. States that were colour become shape: offline / printer down = hollow ring, checking = dotted dot, failed chip = inverted.
- Each card **is the printed label**, dot for dot: `buildLabel()` is a line-by-line port of `build_label()` in `agent/printer_agent.py` (same `clean()`, Python `textwrap.wrap` with its hyphen splitting, `~` truncation, margins, positions, fonts and the 36-character footer rule). It is drawn on a `<canvas>` of the label's dots (40 × 30 mm at 8 dots/mm = 320 × 240), glyph by glyph into the TSPL font cells (font 1 = 8 × 12, 2 = 12 × 20, 3 = 16 × 24, Space Mono 700 stretched to the cell), the BAR as its exact rectangle, then thresholded to 1 bit and scaled with `image-rendering: pixelated`. The canvas sits in the card's title button; its words reach screen readers as a description. Print, move and delete stay under it; phones show the label alone and the sheet shows it above the edit form.
- The label size is the agent's default (40 × 30 mm, offsets 0). The real stock lives in the agent's env (`LABEL_WIDTH_MM`, `LABEL_HEIGHT_MM`, `OFFSET_*_DOTS`), so a different stock will not match until the agent reports its size. The created time is formatted in the browser's time zone; the agent uses its own.
- Turning it off restores the riso theme exactly (the class comes off; nothing else changes).

## 6. Layout and spacing

- Page padding `clamp(16px, 3vw, 40px)`; max width 1440 px.
- Desktop: masthead (wordmark | Bauhaus composition | live and printer dots, *Label editor* and *Settings* icon buttons) on a 6 px rule; then a 264 px *New task* column beside a three-column board; then the footer (the name only, no hint text) on a 6 px rule. *Settings* opens a panel under the masthead (closed on every load; × or Escape shuts it): account (signed-in email, Sign out) in the 264 px column; beside it the *Printer and resources* dropdown (closed by default): printer pill, then the resource monitor (knobs | meta + history). The Bauhaus art is at most 200 px wide and hidden at ≤820 px.
- ≤1180 px: status drops under the masthead, the form goes above the board in two columns.
- ≤820 px: monitor and board stack to one column; cards turn into phone cards that open the sheet, and dragging is off. ≤640 px: everything single column, and the *New task* form closed behind an *Add* / *Hide* toggle so the board comes first.
- No horizontal page scroll at 375 px. Long words wrap (`overflow-wrap: anywhere`).

## 7. Motion and accessibility

- Motion is small and mechanical: the card sheet slides up in .22 s, knob ticks ease over .7 s, cards lift 2 px on hover (by `top`/`left`, never `transform`: a transform makes the card a stacking context and the halftone shadow would paint over its text), buttons press 1 px. The live dot blinks in two steps while reconnecting.
- `prefers-reduced-motion: reduce` removes every transition and animation.
- Focus: 3 px blue outline, 3 px offset, on every interactive element (swatches ring the dot).
- Text contrast meets WCAG AA on both papers. Status is never colour alone: pills and knobs carry a word or number, chips and urgency carry an icon or marks (with the word for screen readers).
- Knobs are `role="meter"` with `aria-valuenow` and `aria-valuetext`; the printer pill is a polite live region. Drag and drop always has keyboard move buttons beside it; on phones the sheet's move buttons are the only way to move a card.
- User text is only ever set with `textContent`. The `svg()` helper (template + innerHTML) takes constant markup only.

## 8. Copy

- Short, plain, uppercase for labels and states, sentence case for help text.
- Say what will happen: "The label waits in line and prints when the printer comes online."
- No emoji, no exclamation marks, no em dashes in sentences (the wordmark's dash is a mark, not punctuation).

## 9. Printed labels

Thermal labels are one-colour and functional, not riso. Layout (agent, 203 dpi, 2 mm margin): small font-1 header `COLUMN  #id6`, a 3-dot bar, the title in font 3 word-wrapped, notes in font 2 if space remains, created date in font 1 at the foot. ASCII only; `"` is escaped as `\["]`, newlines collapse to spaces.
