// content.js
// Netwrix EPP menggunakan dua UI framework berbeda di halaman yang berbeda:
//  - Bootstrap-style (mis. Device Control, Content Aware Protection): .panel-epp / .card-title / .form-group
//  - ExtJS-style (mis. System Configuration): .x-panel / .x-panel-header / .form-row
//
// Dibungkus dalam IIFE karena Netwrix EPP adalah SPA (single-page app) yang tidak
// pernah reload halaman penuh saat berpindah antar policy/menu. Tanpa IIFE, deklarasi
// top-level (const/function) akan bentrok "Identifier has already been declared" saat
// script ini di-inject ulang oleh popup.js pada eksekusi kedua dan seterusnya di
// halaman yang sama, sehingga ekspor gagal total hingga extension di-reload manual.
(function () {

// Buka semua panel accordion yang sedang tertutup (mis. Policy Denylists, Policy
// Allowlists, DPI Monitored URL Categories di halaman Edit Policy) sebelum ekstraksi
// berjalan. Panel yang tertutup punya .card-body.epp-hidden (display:none) sehingga
// semua pemeriksaan offsetParent di ekstraktor akan melewatkannya begitu saja --
// tanpa langkah ini, hasil ekspor hanya berisi panel yang KEBETULAN sudah terbuka
// saat pengguna membuka halaman. Manipulasi class langsung dipakai (bukan .click())
// karena toggle collapse di app ini tidak merespons event yang di-dispatch skrip.
function expandAllCollapsedPanels() {
  document.querySelectorAll('.card-body.epp-hidden').forEach(body => {
    body.classList.remove('epp-hidden');
    const header = body.closest('.panel-epp')?.querySelector('.card-header');
    if (header) header.classList.remove('panel-collapsed', 'card-collapsed');
  });
}

// Buka semua tab Bootstrap (.tab-pane) sekaligus, bukan hanya tab yang sedang aktif,
// dengan menambahkan class "active show" ke semuanya. Tanpa ini, ekstraktor hanya
// melihat tab pertama/terakhir yang diklik pengguna (mis. hanya "MIME Type", padahal
// ada "Allowed Files", "E-mail Domain", "Deep Packet Inspection" di tab lain).
function expandAllTabs() {
  document.querySelectorAll('.tab-pane').forEach(pane => {
    pane.classList.add('active', 'show');
  });
}

// Setelah semua tab dipaksa terbuka bersamaan, tidak ada lagi satu nav-link ".active"
// yang valid secara global. Cari nama tab untuk sebuah elemen lewat id tab-pane
// terdekatnya, dicocokkan ke nav-link yang href-nya menunjuk id tersebut.
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
    if (node.nodeType === 1 && node.tagName === 'INPUT') break; // baris berikutnya milik radio lain
    text += node.textContent || "";
    node = node.nextSibling;
  }
  text = text.replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
  // Beberapa toggle radio (mis. Server Maintenance) tidak punya teks label sama sekali
  // di DOM (hanya value="0"/"1" tanpa sibling text terbaca) -- perlakukan sebagai boolean.
  if (!text && (radioEl.value === '0' || radioEl.value === '1')) {
    return radioEl.value === '1' ? 'ON' : 'OFF';
  }
  return text;
}

function pushRow(csvRows, panelTitle, configName, configValue) {
  if (!configName || configValue === undefined || configValue === "") return;
  let cleanPanel = panelTitle.replace(/"/g, '""');
  let cleanName = configName.replace(/"/g, '""');
  let cleanValue = configValue.toString().replace(/"/g, '""');
  csvRows.push(`"${cleanPanel}","${cleanName}","${cleanValue}"`);
}

// Ekstraksi untuk UI Bootstrap-style: .panel-epp / .card-title / .form-group
function extractBootstrapPanels(csvRows) {
  const panels = document.querySelectorAll('.panel-epp');

  panels.forEach(panel => {
    const panelTitleEl = panel.querySelector('.card-title');
    const panelTitle = panelTitleEl ? panelTitleEl.innerText.trim() : "General";

    // .form-group: pola lama (halaman list/filter). .mb-3.row: pola Bootstrap 5
    // yang dipakai halaman Edit/Detail (mis. Edit Policy, Edit Custom Class).
    const formGroups = panel.querySelectorAll('.form-group, .mb-3.row');
    const seenGroups = new Set();
    const handledRadioNames = new Set();

    formGroups.forEach(group => {
      if (seenGroups.has(group)) return;
      seenGroups.add(group);
      if (group.offsetParent === null) return; // lewati field tersembunyi (mis. panel Filters yang ditutup)

      const labelEl = group.querySelector('label.control-label, label:not(.btn)');

      // Radio button tanpa label pada .form-group itu sendiri
      const radioEl = group.querySelector('input[type="radio"]');
      if (!labelEl && radioEl) {
        const groupName = radioEl.name;
        if (handledRadioNames.has(groupName)) return;
        handledRadioNames.add(groupName);

        const groupRadios = panel.querySelectorAll(`input[type="radio"][name="${CSS.escape(groupName)}"]`);
        const checkedRadio = Array.from(groupRadios).find(r => r.checked);
        const configName = groupName.replace(/\[\]$/, '').replace(/[_-]/g, ' ').trim();
        const configValue = checkedRadio ? (getRadioOptionText(checkedRadio) || checkedRadio.value) : "";
        pushRow(csvRows, panelTitle, configName, configValue);
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

      pushRow(csvRows, panelTitle, configName, configValue);
    });
  });
}

// Ekstraksi untuk UI ExtJS-style: .x-panel / .x-panel-header / .form-row
function extractExtJsPanels(csvRows) {
  const panels = document.querySelectorAll('.x-panel');

  panels.forEach(panel => {
    const panelTitleEl = panel.querySelector('.x-panel-header');
    const panelTitle = panelTitleEl ? panelTitleEl.innerText.trim() : "General";

    // [class*="form-row"] menangkap juga varian seperti .form-row-noborder-system-status
    // (halaman System Status) selain .form-row / .form-row-noborder standar.
    const rows = panel.querySelectorAll('[class*="form-row"]');
    const handledRadioNames = new Set();

    rows.forEach(row => {
      if (row.offsetParent === null) return; // lewati field tersembunyi

      const labelEl = row.querySelector('label');

      // Radio button tanpa <label> terpisah, teks langsung di dalam .content
      const radioEl = row.querySelector('input[type="radio"]');
      if (!labelEl && radioEl) {
        const groupName = radioEl.name;
        if (handledRadioNames.has(groupName)) return;
        handledRadioNames.add(groupName);

        const groupRadios = panel.querySelectorAll(`input[type="radio"][name="${CSS.escape(groupName)}"]`);
        const checkedRadio = Array.from(groupRadios).find(r => r.checked);
        const configName = groupName.replace(/\[\]$/, '').replace(/[_-]/g, ' ').trim();
        const configValue = checkedRadio ? (getRadioOptionText(checkedRadio) || checkedRadio.value) : "";
        pushRow(csvRows, panelTitle, configName, configValue);
        return;
      }

      if (!labelEl) return;

      let configName = labelEl.innerText.replace(/:/g, '').trim();
      let configValue = "";

      const selectEls = row.querySelectorAll('select');
      if (selectEls.length > 0) {
        // Beberapa baris punya lebih dari satu <select> (mis. Time Zone: region + kota).
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
        // Toggle bergambar (mis. System Status): status ON/OFF disimpan di nama file
        // gambar (buttonon.png / buttonoff.png), bukan di atribut checked.
        const imgToggle = row.querySelector('input[type="image"]');
        const srcFilename = imgToggle.src.split('/').pop().split('?')[0].toLowerCase();
        if (srcFilename.includes('on')) configValue = 'ON';
        else if (srcFilename.includes('off')) configValue = 'OFF';
      } else {
        // Baris info read-only (mis. Server Information: Disk Space, Uptime) --
        // tidak ada input sama sekali, hanya teks polos di dalam .content
        // (atau variannya, mis. .content-system-status di halaman System Status).
        const contentEl = row.querySelector('[class*="content"]');
        if (contentEl) configValue = contentEl.innerText.trim();
      }

      pushRow(csvRows, panelTitle, configName, configValue);
    });
  });
}

// Ekstraksi daftar Device Rights (mis. Global Rights): baris berbentuk
// .rights-list-view .row.new-line, bukan .form-group biasa. Label ada di
// div.col-label (bukan .col-switch), nilai ada di <select> atau checkbox toggle.
function extractRightsListRows(csvRows) {
  const containers = document.querySelectorAll('.rights-list-view');

  containers.forEach(container => {
    const panelEl = container.closest('.panel-epp, .x-panel');
    const panelTitleEl = panelEl && (panelEl.querySelector('.card-title') || panelEl.querySelector('.x-panel-header'));
    const mainTitleEl = document.getElementById('maincontenttitle');
    const panelTitle = panelTitleEl ? panelTitleEl.innerText.trim() : (mainTitleEl ? mainTitleEl.innerText.trim() : "General");

    const rows = container.querySelectorAll('.row.new-line');
    rows.forEach(row => {
      if (row.offsetParent === null) return; // lewati field tersembunyi

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

      pushRow(csvRows, panelTitle, configName, configValue);
    });
  });
}

// Header kolom yang lebih layak dipakai sebagai pengenal baris (nama, bukan nomor urut).
const PREFERRED_IDENTIFIER_HEADERS = [
  'name', 'computer name', 'device name', 'policy', 'username', 'class name',
  'group name', 'title', 'user', 'computer'
];

function pickTableRowIdentifier(pairs) {
  let match = pairs.find(p => PREFERRED_IDENTIFIER_HEADERS.includes(p.header.toLowerCase()));
  if (match) return match;
  match = pairs.find(p => !/^\d+$/.test(p.value)); // hindari kolom angka urutan (mis. Priority)
  return match || pairs[0];
}

// Baca nilai cell tabel; deteksi toggle switch ON/OFF (dua <span> "on"/"off" yang
// selalu ada di DOM, status sebenarnya ada di checkbox tersembunyi di sampingnya).
function readTableCellValue(cell) {
  const toggleCheckbox = cell.querySelector('input[type="checkbox"].checkbox-status, input[type="checkbox"]');
  if (toggleCheckbox && cell.querySelector('.epp-btn-toggle')) {
    return toggleCheckbox.checked ? 'ON' : 'OFF';
  }
  return cell.innerText.trim();
}

// Ekstraksi kartu kebijakan (mis. eDiscovery Policies, Content Aware Policies versi kartu):
// .epp-policy-box berisi judul, prioritas, deskripsi, dan toggle status ON/OFF.
function extractPolicyCards(csvRows) {
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

    pushRow(csvRows, panelTitle, title, parts.join(' | '));
  });
}

// Ekstraksi daftar pseudo-checkbox (mis. MIME Type di halaman Allowlists/Denylists):
// .epp-pseudo-checkbox-group berisi <input type="checkbox"> + <label> sebagai saudara,
// bukan checkbox di dalam label seperti pola .form-group biasa.
function extractPseudoCheckboxGroups(csvRows) {
  const groups = document.querySelectorAll('.epp-pseudo-checkbox-group');

  groups.forEach(group => {
    if (group.offsetParent === null) return; // lewati tab yang sedang tidak aktif
    if (group.closest('.title_wrapper')) return; // lewati toggle "select all" pada widget dual-list (mis. DPI Monitored URL Categories)

    const checkbox = group.querySelector('input.pseudo-checkbox, input[type="checkbox"]');
    const labelEl = group.querySelector('label');
    if (!checkbox || !labelEl) return;

    const name = labelEl.innerText.trim();
    const value = checkbox.checked ? 'ON' : 'OFF';

    const container = group.closest('.container-fluid.epp_spacer_border_bottom') || group.closest('.container-fluid');
    const sectionHeading = container ? container.querySelector('h2, h3, h4') : null;
    const panelEl = group.closest('.panel-epp, .x-panel');
    const panelTitleEl = panelEl && (panelEl.querySelector('.card-title') || panelEl.querySelector('.x-panel-header'));
    // Cari nama tab lewat id tab-pane (bukan ".active" global), karena semua tab
    // dipaksa terbuka bersamaan oleh expandAllTabs() sebelum ekstraksi berjalan.
    const tabLabel = findTabLabelForElement(group);

    const parts = [panelTitleEl?.innerText.trim(), tabLabel, sectionHeading?.innerText.trim()].filter(Boolean);
    const category = parts.join(' - ') || 'Umum';

    pushRow(csvRows, category, name, value);
  });
}

// Ekstraksi ringkasan aturan Content Detection (mis. "X OR Y") di halaman Edit Policy:
// .cf_content_summary berisi <ul> daftar kondisi yang sudah terbaca alami via innerText.
function extractContentDetectionRules(csvRows) {
  const summaries = document.querySelectorAll('.cf_content_summary');

  summaries.forEach(summary => {
    if (summary.offsetParent === null) return;
    const ul = summary.querySelector('ul');
    if (!ul || !ul.textContent.trim()) return;

    const rule = ul.innerText.replace(/\s+/g, ' ').trim();
    const panelEl = summary.closest('.panel-epp, .x-panel');
    const panelTitleEl = panelEl && (panelEl.querySelector('.card-title') || panelEl.querySelector('.x-panel-header'));
    const panelTitle = panelTitleEl ? panelTitleEl.innerText.trim() : 'Umum';

    pushRow(csvRows, panelTitle, 'Content Detection Rule', rule);
  });
}

// Ekstraksi panel entitas (mis. Policy Entities: Departments/Groups/Computers/Users):
// .epp-panel-entities berisi daftar checkbox per kategori; hanya item yang
// dicentang yang diekstrak (item kosong = "berlaku untuk semua", tidak perlu dicatat).
function extractEntityLists(csvRows) {
  const panels = document.querySelectorAll('.epp-panel-entities');

  panels.forEach(panel => {
    if (panel.offsetParent === null) return;

    const categoryEl = panel.querySelector('.card-header .epp-center-label');
    const category = categoryEl ? categoryEl.innerText.trim() : 'Umum';

    const checkedLabels = Array.from(panel.querySelectorAll('.card-body input[type="checkbox"]:checked'))
      .map(cb => cb.closest('li')?.querySelector('.form-check-label, label')?.innerText.trim())
      .filter(Boolean);
    if (checkedLabels.length === 0) return;

    const parentPanelEl = panel.closest('.panel-epp, .x-panel');
    const parentTitleEl = parentPanelEl && (parentPanelEl.querySelector('.card-title') || parentPanelEl.querySelector('.x-panel-header'));
    const parentTitle = parentTitleEl ? parentTitleEl.innerText.trim() : 'Umum';

    pushRow(csvRows, parentTitle, category, checkedLabels.join(', '));
  });
}

// Ekstraksi <select multiple> tanpa <label> (mis. tab "Custom Content"/"Predefined
// Content"/"HIPAA" dsb. di Policy Denylists/Allowlists): item terpilih dirender
// select2 sebagai chip "(x) Nama", tanpa label field sama sekali. Karena tidak ada
// label, baris ini dilewati oleh extractBootstrapPanels dan perlu ditangani terpisah.
function extractLabellessMultiSelects(csvRows) {
  const selects = document.querySelectorAll('select[multiple]');

  selects.forEach(select => {
    const row = select.closest('.mb-3.row, .form-group');
    if (row) {
      if (row.offsetParent === null) return; // lewati tab yang tidak aktif
      if (row.querySelector('label.control-label, label:not(.btn)')) return; // sudah ditangani extractBootstrapPanels
    }

    const selectedOptions = Array.from(select.selectedOptions).map(o => o.textContent.trim()).filter(Boolean);
    if (selectedOptions.length === 0) return;

    const panelEl = select.closest('.panel-epp, .x-panel');
    const panelTitleEl = panelEl && (panelEl.querySelector('.card-title') || panelEl.querySelector('.x-panel-header'));
    const panelTitle = panelTitleEl ? panelTitleEl.innerText.trim() : 'Umum';
    const tabLabel = findTabLabelForElement(select);
    const category = [panelTitle, tabLabel].filter(Boolean).join(' - ') || panelTitle;

    pushRow(csvRows, category, 'Selected Items', selectedOptions.join(', '));
  });
}

// Ekstraksi tabel data (mis. daftar device di dalam Custom Class), yang tidak
// berbentuk .form-group/.form-row melainkan <table> dengan thead + tbody.
function extractDataTables(csvRows) {
  const tables = document.querySelectorAll('table');

  tables.forEach(table => {
    if (table.offsetParent === null) return; // lewati tabel tersembunyi (mis. template modal)

    const thead = table.querySelector('thead');
    const tbody = table.querySelector('tbody');
    if (!thead || !tbody) return;

    const headers = Array.from(thead.querySelectorAll('th')).map(th => th.innerText.trim());
    if (headers.every(h => !h)) return;

    const panelEl = table.closest('.panel-epp, .x-panel');
    const panelTitleEl = panelEl && (panelEl.querySelector('.card-title') || panelEl.querySelector('.x-panel-header'));
    const panelTitle = panelTitleEl ? panelTitleEl.innerText.trim() : "General";

    const bodyRows = tbody.querySelectorAll('tr');
    bodyRows.forEach(row => {
      const cells = row.querySelectorAll('td');
      if (cells.length === 0) return;

      // Gabungkan seluruh kolom baris ini menjadi satu record, bukan satu baris CSV per kolom.
      const pairs = [];
      cells.forEach((cell, cellIndex) => {
        const header = headers[cellIndex];
        if (!header || header.toLowerCase() === 'actions') return; // lewati kolom checkbox/aksi
        const value = readTableCellValue(cell);
        if (value) pairs.push({ header, value });
      });
      if (pairs.length === 0) return;

      // Kolom yang paling layak dipakai sebagai pengenal baris (mis. Policy, Computer Name).
      const identifierPair = pickTableRowIdentifier(pairs);
      const identifier = identifierPair.value;
      const rest = pairs.filter(p => p !== identifierPair).map(p => `${p.header}: ${p.value}`).join(' | ');
      pushRow(csvRows, panelTitle, identifier, rest);
    });
  });
}

function extractNetwrixFormConfig() {
  expandAllCollapsedPanels();
  expandAllTabs();

  let csvRows = [];
  csvRows.push('"Category/Panel","Configuration Name","Value/Status"');

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

  if (hasBootstrapPanels) extractBootstrapPanels(csvRows);
  if (hasExtJsPanels) extractExtJsPanels(csvRows);
  if (hasRightsList) extractRightsListRows(csvRows);
  if (hasPolicyCards) extractPolicyCards(csvRows);
  if (hasPseudoCheckboxGroups) extractPseudoCheckboxGroups(csvRows);
  if (hasContentDetectionRules) extractContentDetectionRules(csvRows);
  if (hasEntityLists) extractEntityLists(csvRows);
  if (hasLabellessMultiSelects) extractLabellessMultiSelects(csvRows);
  if (hasDataTables) extractDataTables(csvRows);

  if (csvRows.length <= 1) {
    alert("A configuration panel was found, but no fields could be extracted from this page.");
    return;
  }

  const csvContent = csvRows.join("\n");

  const mainTitleEl = document.getElementById('maincontenttitle');
  let pageTitle = mainTitleEl ? mainTitleEl.innerText.trim().toLowerCase().replace(/\s+/g, '_') : 'netwrix_config';

  downloadCSV(csvContent, `${pageTitle}.csv`);
}

function downloadCSV(csv, filename) {
  // Tambahkan BOM UTF-8 agar Excel tidak salah baca non-breaking space sebagai mojibake
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  link.style.visibility = 'hidden';

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// Jalankan fungsi ekstraksi utama
extractNetwrixFormConfig();

})();
