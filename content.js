// content.js
// Netwrix EPP uses two different UI frameworks across different pages:
//  - Bootstrap-style (e.g. Device Control, Content Aware Protection): .panel-epp / .card-title / .form-group
//  - ExtJS-style (e.g. System Configuration): .x-panel / .x-panel-header / .form-row
//
// Wrapped in an IIFE because Netwrix EPP is an SPA (single-page app) that never
// does a full page reload when switching between policies/menus. Without the IIFE,
// top-level declarations (const/function) would collide with "Identifier has
// already been declared" when this script is re-injected by popup.js on the
// second and subsequent runs on the same page, causing export to fail completely
// until the extension is reloaded manually.
(function () {

// Open every collapsed accordion panel (e.g. Policy Denylists, Policy Allowlists,
// DPI Monitored URL Categories on the Edit Policy page) before extraction runs.
// A collapsed panel has .card-body.epp-hidden (display:none), so every offsetParent
// check in the extractors would simply skip it -- without this step, the export
// would only contain whatever panel HAPPENED to already be open when the user
// loaded the page. Class manipulation is used directly (not .click()) because the
// collapse toggle in this app does not respond to script-dispatched events.
function expandAllCollapsedPanels() {
  document.querySelectorAll('.card-body.epp-hidden').forEach(body => {
    body.classList.remove('epp-hidden');
    const header = body.closest('.panel-epp')?.querySelector('.card-header');
    if (header) header.classList.remove('panel-collapsed', 'card-collapsed');
  });
}

// Open all Bootstrap tabs (.tab-pane) at once, not just the currently active one,
// by adding the "active show" class to all of them. Without this, the extractor
// only sees the first/last tab the user clicked (e.g. only "MIME Type", even
// though "Allowed Files", "E-mail Domain", "Deep Packet Inspection" exist in
// other tabs).
function expandAllTabs() {
  document.querySelectorAll('.tab-pane').forEach(pane => {
    pane.classList.add('active', 'show');
  });
}

// Once all tabs are forced open at the same time, there is no longer a single
// globally-valid ".active" nav-link. Find the tab name for an element via its
// nearest tab-pane id, matched to the nav-link whose href points to that id.
function findTabLabelForElement(el) {
  const pane = el.closest('.tab-pane');
  if (!pane || !pane.id) return null;
  const tabsContainer = pane.closest('.epp-tabs-container') || pane.closest('[class*="tab"]');
  if (!tabsContainer) return null;
  const navLink = tabsContainer.querySelector(`.nav-link[href="#${CSS.escape(pane.id)}"]`);
  return navLink ? navLink.innerText.trim() : null;
}

function getRadioOptionText(radioEl) {
  let text = "";
  let node = radioEl.nextSibling;
  while (node) {
    if (node.nodeType === 1 && node.tagName === 'INPUT') break; // the next node belongs to another radio
    text += node.textContent || "";
    node = node.nextSibling;
  }
  text = text.replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
  // Some radio toggles (e.g. Server Maintenance) have no label text at all in the
  // DOM (just value="0"/"1" with no readable sibling text) -- treat as boolean.
  if (!text && (radioEl.value === '0' || radioEl.value === '1')) {
    return radioEl.value === '1' ? 'ON' : 'OFF';
  }
  return text;
}

// Every extractor pushes plain {panel, name, value} records here instead of
// pre-formatted CSV strings, so the same extracted data can be serialized to
// CSV, Markdown, or PDF at the end without re-running extraction per format.
function pushRow(rows, panelTitle, configName, configValue) {
  if (!configName || configValue === undefined || configValue === "") return;
  rows.push({ panel: panelTitle, name: configName, value: configValue.toString() });
}

// Extraction for Bootstrap-style UI: .panel-epp / .card-title / .form-group
function extractBootstrapPanels(rows) {
  const panels = document.querySelectorAll('.panel-epp');

  panels.forEach(panel => {
    const panelTitleEl = panel.querySelector('.card-title');
    const panelTitle = panelTitleEl ? panelTitleEl.innerText.trim() : "General";

    // .form-group: the older pattern (list/filter pages). .mb-3.row: the Bootstrap 5
    // pattern used on Edit/Detail pages (e.g. Edit Policy, Edit Custom Class).
    const formGroups = panel.querySelectorAll('.form-group, .mb-3.row');
    const seenGroups = new Set();
    const handledRadioNames = new Set();

    formGroups.forEach(group => {
      if (seenGroups.has(group)) return;
      seenGroups.add(group);
      if (group.offsetParent === null) return; // skip hidden fields (e.g. a closed Filters panel)

      const labelEl = group.querySelector('label.control-label, label:not(.btn)');

      // Radio button with no label on the .form-group itself
      const radioEl = group.querySelector('input[type="radio"]');
      if (!labelEl && radioEl) {
        const groupName = radioEl.name;
        if (handledRadioNames.has(groupName)) return;
        handledRadioNames.add(groupName);

        const groupRadios = panel.querySelectorAll(`input[type="radio"][name="${CSS.escape(groupName)}"]`);
        const checkedRadio = Array.from(groupRadios).find(r => r.checked);
        const configName = groupName.replace(/\[\]$/, '').replace(/[_-]/g, ' ').trim();
        const configValue = checkedRadio ? (getRadioOptionText(checkedRadio) || checkedRadio.value) : "";
        pushRow(rows, panelTitle, configName, configValue);
        return;
      }

      if (!labelEl) return;

      let configName = labelEl.innerText.replace(/:/g, '').trim();
      let configValue = "";

      const selectEls = group.querySelectorAll('select');
      if (selectEls.length > 0) {
        configValue = Array.from(selectEls).map(selectEl => {
          if (selectEl.multiple) {
            return Array.from(selectEl.selectedOptions).map(o => o.innerText.trim()).filter(Boolean).join(', ');
          }
          const selectedOption = selectEl.querySelector('option:checked');
          return selectedOption ? selectedOption.innerText.trim() : selectEl.value;
        }).filter(Boolean).join(' / ');
      } else if (group.querySelector('input[type="checkbox"]')) {
        const checkbox = group.querySelector('input[type="checkbox"]');
        configValue = checkbox.checked ? "ON" : "OFF";
      } else if (group.querySelector('input[type="radio"]')) {
        const checkedRadio = group.querySelector('input[type="radio"]:checked');
        configValue = checkedRadio ? (getRadioOptionText(checkedRadio) || checkedRadio.value) : "";
      } else if (group.querySelector('input[type="text"]')) {
        const inputTxt = group.querySelector('input[type="text"]');
        configValue = inputTxt.value;
      } else if (group.querySelector('textarea')) {
        const textArea = group.querySelector('textarea');
        configValue = textArea.value.trim();
      }

      pushRow(rows, panelTitle, configName, configValue);
    });
  });
}

// Extraction for ExtJS-style UI: .x-panel / .x-panel-header / .form-row
function extractExtJsPanels(rows) {
  const panels = document.querySelectorAll('.x-panel');

  panels.forEach(panel => {
    const panelTitleEl = panel.querySelector('.x-panel-header');
    const panelTitle = panelTitleEl ? panelTitleEl.innerText.trim() : "General";

    // [class*="form-row"] also catches variants like .form-row-noborder-system-status
    // (the System Status page) in addition to the standard .form-row / .form-row-noborder.
    const formRows = panel.querySelectorAll('[class*="form-row"]');
    const handledRadioNames = new Set();

    formRows.forEach(row => {
      if (row.offsetParent === null) return; // skip hidden fields

      const labelEl = row.querySelector('label');

      // Radio button with no separate <label>, text sits directly inside .content
      const radioEl = row.querySelector('input[type="radio"]');
      if (!labelEl && radioEl) {
        const groupName = radioEl.name;
        if (handledRadioNames.has(groupName)) return;
        handledRadioNames.add(groupName);

        const groupRadios = panel.querySelectorAll(`input[type="radio"][name="${CSS.escape(groupName)}"]`);
        const checkedRadio = Array.from(groupRadios).find(r => r.checked);
        const configName = groupName.replace(/\[\]$/, '').replace(/[_-]/g, ' ').trim();
        const configValue = checkedRadio ? (getRadioOptionText(checkedRadio) || checkedRadio.value) : "";
        pushRow(rows, panelTitle, configName, configValue);
        return;
      }

      if (!labelEl) return;

      let configName = labelEl.innerText.replace(/:/g, '').trim();
      let configValue = "";

      const selectEls = row.querySelectorAll('select');
      if (selectEls.length > 0) {
        // Some rows have more than one <select> (e.g. Time Zone: region + city).
        configValue = Array.from(selectEls).map(selectEl => {
          if (selectEl.multiple) {
            return Array.from(selectEl.selectedOptions).map(o => o.innerText.trim()).filter(Boolean).join(', ');
          }
          const selectedOption = selectEl.querySelector('option:checked');
          return selectedOption ? selectedOption.innerText.trim() : selectEl.value;
        }).filter(Boolean).join(' / ');
      } else if (row.querySelector('input[type="checkbox"]')) {
        const checkbox = row.querySelector('input[type="checkbox"]');
        configValue = checkbox.checked ? "ON" : "OFF";
      } else if (row.querySelector('input[type="radio"]')) {
        const checkedRadio = row.querySelector('input[type="radio"]:checked');
        configValue = checkedRadio ? (getRadioOptionText(checkedRadio) || checkedRadio.value) : "";
      } else if (row.querySelector('input[type="text"]')) {
        const inputTxt = row.querySelector('input[type="text"]');
        configValue = inputTxt.value;
      } else if (row.querySelector('textarea')) {
        const textArea = row.querySelector('textarea');
        configValue = textArea.value.trim();
      } else if (row.querySelector('input[type="image"]')) {
        // Image-based toggle (e.g. System Status): ON/OFF state is stored in the
        // image file name (buttonon.png / buttonoff.png), not a checked attribute.
        const imgToggle = row.querySelector('input[type="image"]');
        const srcFilename = imgToggle.src.split('/').pop().split('?')[0].toLowerCase();
        if (srcFilename.includes('on')) configValue = 'ON';
        else if (srcFilename.includes('off')) configValue = 'OFF';
      } else {
        // Read-only info row (e.g. Server Information: Disk Space, Uptime) -- no
        // input at all, just plain text inside .content (or a variant of it, e.g.
        // .content-system-status on the System Status page).
        const contentEl = row.querySelector('[class*="content"]');
        if (contentEl) configValue = contentEl.innerText.trim();
      }

      pushRow(rows, panelTitle, configName, configValue);
    });
  });
}

// Extraction for Device Rights lists (e.g. Global Rights): rows shaped as
// .rights-list-view .row.new-line, not a regular .form-group. The label lives in
// div.col-label (not .col-switch), the value in a <select> or checkbox toggle.
function extractRightsListRows(rows) {
  const containers = document.querySelectorAll('.rights-list-view');

  containers.forEach(container => {
    const panelEl = container.closest('.panel-epp, .x-panel');
    const panelTitleEl = panelEl && (panelEl.querySelector('.card-title') || panelEl.querySelector('.x-panel-header'));
    const mainTitleEl = document.getElementById('maincontenttitle');
    const panelTitle = panelTitleEl ? panelTitleEl.innerText.trim() : (mainTitleEl ? mainTitleEl.innerText.trim() : "General");

    const entityRows = container.querySelectorAll('.row.new-line');
    entityRows.forEach(row => {
      if (row.offsetParent === null) return; // skip hidden fields

      const labelEl = row.querySelector('.col-label:not(.col-switch)');
      if (!labelEl) return;

      const configName = labelEl.innerText.replace(/:/g, '').trim();
      let configValue = "";

      const selectEl = row.querySelector('select');
      if (selectEl) {
        const selectedOption = selectEl.querySelector('option:checked');
        configValue = selectedOption ? selectedOption.innerText.trim() : selectEl.value;
      } else {
        const checkbox = row.querySelector('input[type="checkbox"]');
        if (checkbox) configValue = checkbox.checked ? "ON" : "OFF";
      }

      pushRow(rows, panelTitle, configName, configValue);
    });
  });
}

// Column headers that are a better fit as the row identifier (a name, not a
// sequence number).
const PREFERRED_IDENTIFIER_HEADERS = [
  'name', 'computer name', 'device name', 'policy', 'username', 'class name',
  'group name', 'title', 'user', 'computer'
];

function pickTableRowIdentifier(pairs) {
  let match = pairs.find(p => PREFERRED_IDENTIFIER_HEADERS.includes(p.header.toLowerCase()));
  if (match) return match;
  match = pairs.find(p => !/^\d+$/.test(p.value)); // avoid a sequence-number column (e.g. Priority)
  return match || pairs[0];
}

// Read a table cell's value; detect an ON/OFF toggle switch (two <span> "on"/"off"
// elements that are always present in the DOM, with the real state on the hidden
// checkbox next to them).
function readTableCellValue(cell) {
  const toggleCheckbox = cell.querySelector('input[type="checkbox"].checkbox-status, input[type="checkbox"]');
  if (toggleCheckbox && cell.querySelector('.epp-btn-toggle')) {
    return toggleCheckbox.checked ? 'ON' : 'OFF';
  }
  return cell.innerText.trim();
}

// Extraction for policy cards (e.g. eDiscovery Policies, the card view of Content
// Aware Policies): .epp-policy-box holds a title, priority, description, and an
// ON/OFF status toggle.
function extractPolicyCards(rows) {
  const boxes = document.querySelectorAll('.epp-policy-box');

  boxes.forEach(box => {
    if (box.offsetParent === null) return;

    const titleEl = box.querySelector('.policy-title');
    if (!titleEl) return;
    const title = titleEl.innerText.trim();

    const priority = box.querySelector('.priorityVal')?.innerText.trim();
    const description = box.querySelector('.policy-description')?.innerText.trim().replace(/\s*\n\s*/g, ' | ');
    const toggleCheckbox = box.querySelector('.policy-status-btn input[type="checkbox"]');
    const status = toggleCheckbox ? (toggleCheckbox.checked ? 'ON' : 'OFF') : '';

    const panelEl = box.closest('.panel-epp, .x-panel');
    const panelTitleEl = panelEl && (panelEl.querySelector('.card-title') || panelEl.querySelector('.x-panel-header'));
    const panelTitle = panelTitleEl ? panelTitleEl.innerText.trim() : "General";

    const parts = [];
    if (priority) parts.push(`Priority: ${priority}`);
    if (description) parts.push(`Description: ${description}`);
    if (status) parts.push(`Status: ${status}`);

    pushRow(rows, panelTitle, title, parts.join(' | '));
  });
}

// Extraction for pseudo-checkbox lists (e.g. MIME Type on the Allowlists/Denylists
// pages): .epp-pseudo-checkbox-group holds an <input type="checkbox"> + <label> as
// siblings, not a checkbox nested inside the label like the regular .form-group pattern.
function extractPseudoCheckboxGroups(rows) {
  const groups = document.querySelectorAll('.epp-pseudo-checkbox-group');

  groups.forEach(group => {
    if (group.offsetParent === null) return; // skip an inactive tab
    if (group.closest('.title_wrapper')) return; // skip the "select all" toggle on a dual-list widget (e.g. DPI Monitored URL Categories)

    const checkbox = group.querySelector('input.pseudo-checkbox, input[type="checkbox"]');
    const labelEl = group.querySelector('label');
    if (!checkbox || !labelEl) return;

    const name = labelEl.innerText.trim();
    const value = checkbox.checked ? 'ON' : 'OFF';

    const container = group.closest('.container-fluid.epp_spacer_border_bottom') || group.closest('.container-fluid');
    const sectionHeading = container ? container.querySelector('h2, h3, h4') : null;
    const panelEl = group.closest('.panel-epp, .x-panel');
    const panelTitleEl = panelEl && (panelEl.querySelector('.card-title') || panelEl.querySelector('.x-panel-header'));
    // Find the tab name via the tab-pane id (not a global ".active"), because all
    // tabs are forced open together by expandAllTabs() before extraction runs.
    const tabLabel = findTabLabelForElement(group);

    const parts = [panelTitleEl?.innerText.trim(), tabLabel, sectionHeading?.innerText.trim()].filter(Boolean);
    const category = parts.join(' - ') || 'General';

    pushRow(rows, category, name, value);
  });
}

// Extraction for the Content Detection rule summary (e.g. "X OR Y") on the Edit
// Policy page: .cf_content_summary holds a <ul> of conditions that reads naturally
// via innerText.
function extractContentDetectionRules(rows) {
  const summaries = document.querySelectorAll('.cf_content_summary');

  summaries.forEach(summary => {
    if (summary.offsetParent === null) return;
    const ul = summary.querySelector('ul');
    if (!ul || !ul.textContent.trim()) return;

    const rule = ul.innerText.replace(/\s+/g, ' ').trim();
    const panelEl = summary.closest('.panel-epp, .x-panel');
    const panelTitleEl = panelEl && (panelEl.querySelector('.card-title') || panelEl.querySelector('.x-panel-header'));
    const panelTitle = panelTitleEl ? panelTitleEl.innerText.trim() : 'General';

    pushRow(rows, panelTitle, 'Content Detection Rule', rule);
  });
}

// Extraction for entity panels (e.g. Policy Entities: Departments/Groups/Computers/Users):
// .epp-panel-entities holds a checkbox list per category; only checked items are
// extracted (an empty list means "applies to everyone", nothing to record).
function extractEntityLists(rows) {
  const panels = document.querySelectorAll('.epp-panel-entities');

  panels.forEach(panel => {
    if (panel.offsetParent === null) return;

    const categoryEl = panel.querySelector('.card-header .epp-center-label');
    const category = categoryEl ? categoryEl.innerText.trim() : 'General';

    const checkedLabels = Array.from(panel.querySelectorAll('.card-body input[type="checkbox"]:checked'))
      .map(cb => cb.closest('li')?.querySelector('.form-check-label, label')?.innerText.trim())
      .filter(Boolean);
    if (checkedLabels.length === 0) return;

    const parentPanelEl = panel.closest('.panel-epp, .x-panel');
    const parentTitleEl = parentPanelEl && (parentPanelEl.querySelector('.card-title') || parentPanelEl.querySelector('.x-panel-header'));
    const parentTitle = parentTitleEl ? parentTitleEl.innerText.trim() : 'General';

    pushRow(rows, parentTitle, category, checkedLabels.join(', '));
  });
}

// Extraction for <select multiple> with no <label> (e.g. the "Custom Content" /
// "Predefined Content" / "HIPAA" etc. tabs on Policy Denylists/Allowlists): the
// selected items are rendered by select2 as "(x) Name" chips, with no field label
// at all. Since there is no label, this row is skipped by extractBootstrapPanels
// and needs to be handled separately.
function extractLabellessMultiSelects(rows) {
  const selects = document.querySelectorAll('select[multiple]');

  selects.forEach(select => {
    const row = select.closest('.mb-3.row, .form-group');
    if (row) {
      if (row.offsetParent === null) return; // skip an inactive tab
      if (row.querySelector('label.control-label, label:not(.btn)')) return; // already handled by extractBootstrapPanels
    }

    const selectedOptions = Array.from(select.selectedOptions).map(o => o.textContent.trim()).filter(Boolean);
    if (selectedOptions.length === 0) return;

    const panelEl = select.closest('.panel-epp, .x-panel');
    const panelTitleEl = panelEl && (panelEl.querySelector('.card-title') || panelEl.querySelector('.x-panel-header'));
    const panelTitle = panelTitleEl ? panelTitleEl.innerText.trim() : 'General';
    const tabLabel = findTabLabelForElement(select);
    const category = [panelTitle, tabLabel].filter(Boolean).join(' - ') || panelTitle;

    pushRow(rows, category, 'Selected Items', selectedOptions.join(', '));
  });
}

// Extraction for data tables (e.g. the device list inside a Custom Class), which
// are not .form-group/.form-row but a <table> with thead + tbody.
//
// Each pushed row keeps both a flattened "identifier + rest" name/value pair
// (used by the CSV/Markdown output, one row per record) AND the original
// fixed-column record under `.table` (headers + per-column values, blanks
// kept so every row lines up under the same columns). The PDF renderer uses
// `.table` to draw a real multi-column table instead of squashing every
// column into a single "Value/Status" cell.
function extractDataTables(rows) {
  const tables = document.querySelectorAll('table');

  tables.forEach(table => {
    if (table.offsetParent === null) return; // skip hidden tables (e.g. a modal template)

    const thead = table.querySelector('thead');
    const tbody = table.querySelector('tbody');
    if (!thead || !tbody) return;

    const rawHeaders = Array.from(thead.querySelectorAll('th')).map(th => th.innerText.trim());
    if (rawHeaders.every(h => !h)) return;

    // Column indexes worth keeping: has a header, and isn't the checkbox/actions column.
    const keptColumns = rawHeaders
      .map((header, index) => ({ header, index }))
      .filter(c => c.header && c.header.toLowerCase() !== 'actions');
    if (keptColumns.length === 0) return;
    const headers = keptColumns.map(c => c.header);

    const panelEl = table.closest('.panel-epp, .x-panel');
    const panelTitleEl = panelEl && (panelEl.querySelector('.card-title') || panelEl.querySelector('.x-panel-header'));
    const panelTitle = panelTitleEl ? panelTitleEl.innerText.trim() : "General";

    const bodyRows = tbody.querySelectorAll('tr');
    bodyRows.forEach(row => {
      const cells = row.querySelectorAll('td');
      if (cells.length === 0) return;

      const values = keptColumns.map(c => {
        const cell = cells[c.index];
        return cell ? readTableCellValue(cell) : '';
      });
      if (values.every(v => !v)) return;

      const pairs = headers.map((header, i) => ({ header, value: values[i] })).filter(p => p.value);
      if (pairs.length === 0) return;

      // The column best suited as the row identifier (e.g. Policy, Computer Name).
      const identifierPair = pickTableRowIdentifier(pairs);
      const identifier = identifierPair.value;
      const rest = pairs.filter(p => p !== identifierPair).map(p => `${p.header}: ${p.value}`).join(' | ');
      if (!identifier) return;

      rows.push({ panel: panelTitle, name: identifier, value: rest || '(no additional fields)', table: { headers, values } });
    });
  });
}

// Some list pages (e.g. Devices, System Administrators) load their table data via
// AJAX after the page shell renders. If extraction runs immediately after
// navigation, the table may not exist yet, producing a false "nothing found"
// result. Poll for a recognizable panel/table, and once a data table is found,
// keep polling until its row count is stable across two consecutive checks --
// a table can briefly exist with a "loading" placeholder row or a partial first
// batch of rows before AJAX finishes filling it in.
function waitForPageReady(maxWaitMs, intervalMs) {
  maxWaitMs = maxWaitMs || 6000;
  intervalMs = intervalMs || 150;
  return new Promise(resolve => {
    const start = Date.now();
    let lastTableRowCount = -1;
    function visibleDataTables() {
      return Array.from(document.querySelectorAll('table')).filter(t => t.offsetParent !== null && t.querySelector('thead') && t.querySelector('tbody tr'));
    }
    function check() {
      const tables = visibleDataTables();
      const hasNonTablePanel = document.querySelectorAll('.panel-epp').length > 0 ||
        document.querySelectorAll('.x-panel').length > 0 ||
        document.querySelectorAll('.rights-list-view').length > 0 ||
        document.querySelectorAll('.epp-policy-box').length > 0;
      const timedOut = Date.now() - start >= maxWaitMs;

      if (tables.length > 0) {
        const totalRows = tables.reduce((sum, t) => sum + t.querySelectorAll('tbody tr').length, 0);
        if (totalRows === lastTableRowCount || timedOut) {
          resolve();
          return;
        }
        lastTableRowCount = totalRows;
        setTimeout(check, intervalMs);
        return;
      }

      if (hasNonTablePanel || timedOut) {
        resolve();
      } else {
        setTimeout(check, intervalMs);
      }
    }
    check();
  });
}

async function extractNetwrixFormConfig() {
  await waitForPageReady();

  expandAllCollapsedPanels();
  expandAllTabs();

  let rows = [];

  const hasBootstrapPanels = document.querySelectorAll('.panel-epp').length > 0;
  const hasExtJsPanels = document.querySelectorAll('.x-panel').length > 0;
  const hasRightsList = document.querySelectorAll('.rights-list-view').length > 0;
  const hasPolicyCards = document.querySelectorAll('.epp-policy-box').length > 0;
  const hasPseudoCheckboxGroups = document.querySelectorAll('.epp-pseudo-checkbox-group').length > 0;
  const hasContentDetectionRules = document.querySelectorAll('.cf_content_summary').length > 0;
  const hasEntityLists = document.querySelectorAll('.epp-panel-entities').length > 0;
  const hasLabellessMultiSelects = document.querySelectorAll('select[multiple]').length > 0;
  const hasDataTables = Array.from(document.querySelectorAll('table')).some(t => t.offsetParent !== null && t.querySelector('thead') && t.querySelector('tbody'));

  if (!hasBootstrapPanels && !hasExtJsPanels && !hasRightsList && !hasPolicyCards && !hasPseudoCheckboxGroups && !hasContentDetectionRules && !hasEntityLists && !hasLabellessMultiSelects && !hasDataTables) {
    alert("No configuration panel found ('.panel-epp' or '.x-panel'). Make sure you are on a settings page.");
    return;
  }

  if (hasBootstrapPanels) extractBootstrapPanels(rows);
  if (hasExtJsPanels) extractExtJsPanels(rows);
  if (hasRightsList) extractRightsListRows(rows);
  if (hasPolicyCards) extractPolicyCards(rows);
  if (hasPseudoCheckboxGroups) extractPseudoCheckboxGroups(rows);
  if (hasContentDetectionRules) extractContentDetectionRules(rows);
  if (hasEntityLists) extractEntityLists(rows);
  if (hasLabellessMultiSelects) extractLabellessMultiSelects(rows);
  if (hasDataTables) extractDataTables(rows);

  if (rows.length === 0) {
    const tableRowCounts = Array.from(document.querySelectorAll('table'))
      .filter(t => t.offsetParent !== null)
      .map(t => t.querySelectorAll('tbody tr').length);
    const diagnostics = `panels=${document.querySelectorAll('.panel-epp').length}, ` +
      `x-panels=${document.querySelectorAll('.x-panel').length}, ` +
      `visible tables=${tableRowCounts.length} (row counts: ${tableRowCounts.join(', ') || 'none'})`;
    alert(`A configuration panel was found, but no fields could be extracted from this page.\n\nDiagnostics: ${diagnostics}\n\nPlease share this message so the issue can be fixed.`);
    return;
  }

  const mainTitleEl = document.getElementById('maincontenttitle');
  const pageTitle = mainTitleEl ? mainTitleEl.innerText.trim() : 'Netwrix Config';
  const fileBaseName = pageTitle.toLowerCase().replace(/\s+/g, '_');

  // popup.js sets window.__eppExportFormat before injecting this script; defaults
  // to CSV when exported the old way (e.g. this file run directly without the popup).
  const format = window.__eppExportFormat || 'csv';

  if (format === 'md') {
    downloadBlob(rowsToMarkdown(rows, pageTitle), `${fileBaseName}.md`, 'text/markdown;charset=utf-8;');
  } else if (format === 'pdf') {
    downloadPDF(rows, pageTitle, fileBaseName);
  } else {
    downloadBlob(rowsToCSV(rows), `${fileBaseName}.csv`, 'text/csv;charset=utf-8;');
  }
}

function rowsToCSV(rows) {
  const csvLines = ['"Category/Panel","Configuration Name","Value/Status"'];
  rows.forEach(r => {
    const panel = r.panel.replace(/"/g, '""');
    const name = r.name.replace(/"/g, '""');
    const value = r.value.replace(/"/g, '""');
    csvLines.push(`"${panel}","${name}","${value}"`);
  });
  return csvLines.join('\n');
}

function rowsToMarkdown(rows, pageTitle) {
  const groups = [];
  const groupIndexByPanel = new Map();
  rows.forEach(r => {
    if (!groupIndexByPanel.has(r.panel)) {
      groupIndexByPanel.set(r.panel, groups.length);
      groups.push({ panel: r.panel, items: [] });
    }
    groups[groupIndexByPanel.get(r.panel)].items.push(r);
  });

  const escapeCell = s => s.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');

  let md = `# ${pageTitle}\n\n`;
  groups.forEach(g => {
    md += `## ${g.panel}\n\n`;
    md += '| Configuration Name | Value/Status |\n|---|---|\n';
    g.items.forEach(r => {
      md += `| ${escapeCell(r.name)} | ${escapeCell(r.value)} |\n`;
    });
    md += '\n';
  });
  return md;
}

function downloadBlob(content, filename, mimeType) {
  // Add a UTF-8 BOM so Excel/other tools don't misread non-breaking spaces as mojibake.
  const blob = new Blob(['\uFEFF' + content], { type: mimeType });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  link.style.visibility = 'hidden';

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function downloadPDF(rows, pageTitle, fileBaseName) {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    alert("PDF export failed: the PDF library did not load. Try again, or use CSV/Markdown instead.");
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const marginLeft = 14;
  const bottomMargin = 14;
  const cellPadding = 2;
  const headerRowHeight = 7;
  let orientation = 'portrait';
  let y = 18;

  function pageDims() {
    return { w: doc.internal.pageSize.getWidth(), h: doc.internal.pageSize.getHeight() };
  }

  function newPage(targetOrientation) {
    doc.addPage('a4', targetOrientation);
    orientation = targetOrientation;
    y = 18;
  }

  // Returns true if a new page was started, so the caller can redraw the table header.
  function ensureSpace(neededHeight) {
    const { h } = pageDims();
    if (y + neededHeight > h - bottomMargin) {
      newPage(orientation);
      return true;
    }
    return false;
  }

  function ensureOrientation(target) {
    if (orientation !== target) newPage(target);
  }

  doc.setFontSize(14);
  doc.setFont(undefined, 'bold');
  doc.text(pageTitle, marginLeft, y);
  y += 10;

  const groups = [];
  const groupIndexByPanel = new Map();
  rows.forEach(r => {
    if (!groupIndexByPanel.has(r.panel)) {
      groupIndexByPanel.set(r.panel, groups.length);
      groups.push({ panel: r.panel, items: [] });
    }
    groups[groupIndexByPanel.get(r.panel)].items.push(r);
  });

  // A group renders as a real multi-column table only if every item in it came
  // from the same source <table> (same columns in the same order); otherwise it
  // falls back to the generic 2-column "Configuration Name / Value/Status" layout.
  function isDataTableGroup(g) {
    if (g.items.length === 0 || !g.items[0].table) return false;
    const headers = g.items[0].table.headers;
    return g.items.every(i => i.table && i.table.headers.length === headers.length &&
      i.table.headers.every((h, idx) => h === headers[idx]));
  }

  function drawFieldGroup(g) {
    const { w } = pageDims();
    const contentWidth = w - marginLeft * 2;
    const col1Width = contentWidth * 0.35;
    const col2Width = contentWidth - col1Width;
    const textLineHeight = 4.5;

    function drawHeader() {
      doc.setDrawColor(150);
      doc.setFillColor(230, 230, 230);
      doc.rect(marginLeft, y, col1Width, headerRowHeight, 'FD');
      doc.rect(marginLeft + col1Width, y, col2Width, headerRowHeight, 'FD');
      doc.setFont(undefined, 'bold');
      doc.setFontSize(9);
      doc.setTextColor(0, 0, 0);
      doc.text('Configuration Name', marginLeft + cellPadding, y + 5);
      doc.text('Value/Status', marginLeft + col1Width + cellPadding, y + 5);
      y += headerRowHeight;
    }

    ensureSpace(headerRowHeight + textLineHeight + 6);
    doc.setFontSize(11);
    doc.setFont(undefined, 'bold');
    doc.text(g.panel, marginLeft, y);
    y += 5;
    drawHeader();

    doc.setFont(undefined, 'normal');
    doc.setFontSize(9);

    g.items.forEach(item => {
      const nameLines = doc.splitTextToSize(item.name, col1Width - cellPadding * 2);
      const valueLines = doc.splitTextToSize(item.value, col2Width - cellPadding * 2);
      const lineCount = Math.max(nameLines.length, valueLines.length, 1);
      const rowHeight = lineCount * textLineHeight + cellPadding * 2 - 1;

      if (ensureSpace(rowHeight)) {
        drawHeader();
        doc.setFont(undefined, 'normal');
        doc.setFontSize(9);
      }

      doc.setDrawColor(200);
      doc.rect(marginLeft, y, col1Width, rowHeight);
      doc.rect(marginLeft + col1Width, y, col2Width, rowHeight);

      let ly = y + cellPadding + 2;
      nameLines.forEach(line => { doc.text(line, marginLeft + cellPadding, ly); ly += textLineHeight; });
      ly = y + cellPadding + 2;
      valueLines.forEach(line => { doc.text(line, marginLeft + col1Width + cellPadding, ly); ly += textLineHeight; });

      y += rowHeight;
    });

    y += 6;
  }

  // Renders the table's original columns (Username, First Name, E-mail, ...)
  // instead of the flattened "identifier + rest" pair, so it actually looks
  // like the source data table. Wide tables (more than 5 columns) switch the
  // page to landscape so columns stay readable.
  function drawDataTableGroup(g) {
    const headers = g.items[0].table.headers;
    ensureOrientation(headers.length > 5 ? 'landscape' : 'portrait');

    const { w } = pageDims();
    const contentWidth = w - marginLeft * 2;

    const colWeights = headers.map((h, i) => {
      let maxLen = h.length;
      g.items.forEach(item => { maxLen = Math.max(maxLen, (item.table.values[i] || '').length); });
      return Math.min(Math.max(maxLen, 6), 30);
    });
    const totalWeight = colWeights.reduce((a, b) => a + b, 0);
    const colWidths = colWeights.map(wt => (wt / totalWeight) * contentWidth);

    const fontSize = headers.length > 8 ? 6.5 : 8;
    const rowLineHeight = fontSize * 0.55 + 1.2;

    function drawHeader() {
      doc.setFont(undefined, 'bold');
      doc.setFontSize(fontSize);
      let x = marginLeft;
      headers.forEach((h, i) => {
        // Fill color must be reasserted before every rect: drawing text uses the
        // same underlying PDF fill-color state, so the previous column's text
        // silently leaves it black for this column's rect otherwise.
        doc.setDrawColor(150);
        doc.setFillColor(230, 230, 230);
        doc.rect(x, y, colWidths[i], headerRowHeight, 'FD');
        doc.setTextColor(0, 0, 0);
        const lines = doc.splitTextToSize(h, colWidths[i] - cellPadding * 2);
        doc.text(lines[0] || '', x + cellPadding, y + 5);
        x += colWidths[i];
      });
      y += headerRowHeight;
    }

    ensureSpace(headerRowHeight + rowLineHeight + 6);
    doc.setFontSize(11);
    doc.setFont(undefined, 'bold');
    doc.text(g.panel, marginLeft, y);
    y += 5;
    drawHeader();

    doc.setFont(undefined, 'normal');
    doc.setFontSize(fontSize);

    g.items.forEach(item => {
      const cellLines = headers.map((h, i) => doc.splitTextToSize(item.table.values[i] || '', colWidths[i] - cellPadding * 2));
      const lineCount = Math.max(1, ...cellLines.map(l => l.length));
      const rowHeight = lineCount * rowLineHeight + cellPadding * 1.5;

      if (ensureSpace(rowHeight)) {
        drawHeader();
        doc.setFont(undefined, 'normal');
        doc.setFontSize(fontSize);
      }

      let x = marginLeft;
      doc.setDrawColor(200);
      headers.forEach((h, i) => {
        doc.rect(x, y, colWidths[i], rowHeight);
        let ly = y + cellPadding + rowLineHeight - 1;
        cellLines[i].forEach(line => { doc.text(line, x + cellPadding, ly); ly += rowLineHeight; });
        x += colWidths[i];
      });

      y += rowHeight;
    });

    y += 6;
  }

  groups.forEach(g => {
    if (isDataTableGroup(g)) drawDataTableGroup(g);
    else drawFieldGroup(g);
  });

  doc.save(`${fileBaseName}.pdf`);
}

// Run the main extraction function
extractNetwrixFormConfig();

})();
