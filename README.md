# Netwrix Config Exporter

A Chrome extension (Manifest V3) that exports configuration data from a
Netwrix Endpoint Protector (EPP) admin console to CSV, so you don't have to
manually copy settings out of the UI.

## Features

- One-click "Export Current Page" that reads whatever Netwrix EPP page is
  open in the active tab and downloads a CSV.
- Dedicated navigation buttons for ~50 common pages (Device Control, Content
  Aware Protection, Denylists and Allowlists, Reports and Analysis, Alerts,
  Directory Services, Appliance, System Maintenance, System Configuration,
  System Parameters, Dashboard) that jump to the page and export it in one
  click.
- Handles both UI frameworks used across the app: the older ExtJS-based
  pages (`.x-panel`) and the newer Bootstrap-based pages (`.panel-epp`).
- Auto-expands collapsed accordion panels and inactive tabs before
  extracting, so a single export captures data you never manually opened.
- Skips password fields by design.
- Built-in help page (accessible from the popup) with setup and usage
  instructions.

## Installation

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select this folder.
4. Confirm it appears as "Netwrix Config Exporter" with no errors.

## Usage

1. Open your Netwrix EPP admin console in a browser tab and make sure it is
   the active tab.
2. Click the extension icon to open the popup.
3. Click a section button (auto-navigates and exports), or navigate to any
   page yourself and click **Export Current Page**.
4. A CSV file downloads automatically.

See the in-extension Help page (click "Help" in the popup) for full details,
including known limitations.

## Files

| File | Purpose |
|---|---|
| `manifest.json` | Extension manifest (Manifest V3) |
| `content.js` | Injected into the Netwrix EPP page; does the actual DOM extraction and CSV download |
| `popup.html` / `popup.js` | Extension popup UI: page navigation buttons and export triggers |
| `help.html` | In-extension user guide, opened from the popup |

## Known limitations

- List pages (e.g. "Content Aware Policies") export the summary table, not
  each item's full detail. Open an item's Edit page manually and use
  **Export Current Page** for full detail on one item.
- The extension cannot auto-open individual rows (policy edit screens,
  custom class detail views, etc.) because Netwrix's row-action menus only
  respond to real user clicks, not script-simulated ones. Section buttons
  only cover pages reachable directly from the main sidebar.

## Roadmap

- Export format choice: CSV / PDF / Markdown.
- Dashboard export to PNG (General Dashboard, Device Control Dashboard,
  Content Aware Dashboard) with a user-selected time range.
