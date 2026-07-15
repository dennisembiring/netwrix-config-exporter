function setStatus(text) {
  document.getElementById('status').textContent = text;
}

async function runExtraction(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content.js']
  });
}

// Dijalankan di dalam halaman Netwrix EPP (bukan di popup). Mengklik item sidebar
// secara berurutan (mis. "Device Control" lalu "Global Rights") untuk berpindah
// halaman sebelum ekspor dijalankan. Harus mandiri (tanpa referensi luar) karena
// dikirim ke chrome.scripting.executeScript sebagai fungsi, bukan file terpisah.
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
  await runExtraction(tab.id);
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
    await runExtraction(tab.id);
    setStatus('Done.');
  });
});
