function setStatus(text) {
  document.getElementById('status').textContent = text;
}

function getSelectedFormat() {
  const checked = document.querySelector('input[name="format"]:checked');
  return checked ? checked.value : 'csv';
}

// Runs inside the Netwrix EPP page (not the popup). Sets a flag content.js reads
// to decide which format to export in. Must be self-contained (no outside
// references) since it is sent to chrome.scripting.executeScript as a function,
// not a separate file.
function setExportFormat(format) {
  window.__eppExportFormat = format;
}

async function runExtraction(tabId, format) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: setExportFormat,
    args: [format]
  });

  // Only load the (large) PDF library when the user actually asked for a PDF.
  const files = format === 'pdf' ? ['lib/jspdf.umd.min.js', 'content.js'] : ['content.js'];
  await chrome.scripting.executeScript({
    target: { tabId },
    files
  });
}

// Runs inside the Netwrix EPP page (not the popup). Clicks through sidebar items
// in order (e.g. "Device Control" then "Global Rights") to navigate before export
// runs. Must be self-contained (no outside references) since it is sent to
// chrome.scripting.executeScript as a function, not a separate file.
//
// Each subsequent label is searched for only within the previously clicked
// item's submenu (its next-sibling <ul>), not the whole sidebar. Some labels
// (e.g. "Dashboard") appear under multiple top-level sections, and once more
// than one section has been expanded in a session, a plain document-wide text
// match can click the wrong one.
function navigateToPath(labels) {
  return new Promise(async (resolve) => {
    let scope = document;
    for (const label of labels) {
      const spans = Array.from(scope.querySelectorAll('span')).filter(
        el => el.textContent.trim() === label
      );
      const span = spans.find(el => el.offsetParent !== null) || spans[0];
      if (!span) { resolve(false); return; }
      const li = span.closest('li');
      li.click();
      const submenu = li.nextElementSibling;
      scope = (submenu && submenu.tagName === 'UL') ? submenu : document;
      await new Promise(r => setTimeout(r, 700));
    }
    resolve(true);
  });
}

document.getElementById('exportCurrentBtn').addEventListener('click', async () => {
  setStatus('Exporting current page...');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await runExtraction(tab.id, getSelectedFormat());
  setStatus('Done.');
});

document.getElementById('helpLink').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: chrome.runtime.getURL('help.html') });
});

document.querySelectorAll('.navExport').forEach(button => {
  button.addEventListener('click', async () => {
    const labels = button.dataset.path.split(',');
    setStatus(`Opening ${button.textContent}...`);
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: navigateToPath,
      args: [labels]
    });

    setStatus('Exporting...');
    await runExtraction(tab.id, getSelectedFormat());
    setStatus('Done.');
  });
});

// PNG dashboard export drives the date-range picker via background.js (chrome.debugger),
// since the picker only reacts to genuinely trusted clicks that a content script can't
// generate. See background.js for why.
document.querySelectorAll('.pngExport').forEach(button => {
  button.addEventListener('click', async () => {
    const labels = button.dataset.path.split(',');
    const days = parseInt(button.dataset.days, 10);
    const rangeLabel = button.textContent.trim();
    setStatus(`Opening ${labels[labels.length - 1]}...`);
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: navigateToPath,
      args: [labels]
    });

    setStatus(`Setting range: ${rangeLabel}...`);
    const dashboardTitle = labels[labels.length - 1].toLowerCase().replace(/\s+/g, '_');
    const rangeSlug = rangeLabel.toLowerCase().replace(/\s+/g, '_');
    const fileBaseName = `${dashboardTitle}_${rangeSlug}`;

    const response = await chrome.runtime.sendMessage({
      action: 'exportDashboardPng',
      tabId: tab.id,
      days,
      fileBaseName
    });

    if (response && response.ok) {
      setStatus('Done.');
    } else {
      setStatus(`Failed: ${response ? response.error : 'no response'}`);
    }
  });
});
