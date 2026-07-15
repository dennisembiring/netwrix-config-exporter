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
function navigateToPath(labels) {
  return new Promise(async (resolve) => {
    for (const label of labels) {
      const span = Array.from(document.querySelectorAll('span')).find(
        el => el.textContent.trim() === label
      );
      const li = span && span.closest('li');
      if (li) li.click();
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
