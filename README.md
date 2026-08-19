# Thermal Printer Editor

A Windows desktop app for designing thermal labels and printing them on a Gprinter GP-3120TL. You lay out the label on a live preview, save it as a template, then fill in values and print a run — without changing the paper size in Windows printer preferences.

**[Download the latest Windows installer](https://github.com/MalcolmLiew/thermal-printer-editor/releases/latest)**

## Features

### Design
- Live label canvas with rulers, snap guides, and a floating toolbar
- Add **text**, **lines**, **images**, **input fields**, and **groups**
- Drag to move, resize from handles, align, bring forward or send back, and rotate in quarter turns
- Click text on the label to retype it; the box grows with what you type
- Drop an image onto the label to place it, then adjust threshold, dither, and invert for thermal output
- Group elements into rows or columns, with padding and gap
- Drag layers to reorder them; click a group’s arrow to hide its children
- Undo and redo while you design

### Media
- Set width, height, gap, density, speed, and print direction from the app
- Die-cut labels with rounded-corner preview, or continuous stock
- Keep-out padding inside the label edge
- Size presets you can add and edit in Settings
- Warns when content sits past the 76 mm print width or off the label

### Fonts
- Built-in thermal and Roman faces, plus a starter set of common desktop fonts
- Import TTF or OTF files and reuse them on any text or input field
- Point sizes you can type or nudge

### Templates
- Save the full design — media, every element, and every input field
- Open a template later and keep editing it
- Group templates on Home; click a group name to hide its cards
- Duplicate, move, or delete from the Home preview cards
- Design only shows the current template’s name and save, not the full library

### Print
- Fill in text or image inputs without changing the design
- Drag input fields to choose the order they appear on the Print page
- Count-up fields bump serial numbers after each successful print, keeping zero padding
- Reuse values from the last run, or pick a saved fill
- Choose printer, copies, and send the job as raw TSPL so the driver does not rewrite the label
- Ctrl+Enter prints from anywhere on the Print page
- Test print from Settings to check the connection

### Workspace
- Home, Design, Print, and Settings
- Light, dark, or follow the system; the label preview stays white stock with black ink
- Remembers the last media size, copies, printer, and theme

## Install

Windows 10 or 11. Install the Gprinter GP-3120TL driver so the printer appears in Windows, then run the setup exe from [Releases](https://github.com/MalcolmLiew/thermal-printer-editor/releases).

Templates stay on this computer as editable design files in the app data folder. Opening one restores the layout so you can keep changing it.

## Develop

Needs Node.js 20 or later.

```bash
npm install
npm run dev
```

```bash
npm run dist
```

That writes a Windows installer to `release/Receipt Printer Editor Setup <version>.exe`.
