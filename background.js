// background.js
// Automates the dashboard date-range picker via chrome.debugger so preset PNG
// exports (1 week / 2 weeks / 1 month) work without the user manually clicking
// calendar days. The picker only reacts to genuinely trusted mouse events --
// content-script-dispatched clicks are silently ignored, confirmed by testing
// -- so this uses the same CDP Input domain a real browser-automation tool
// uses to generate trusted-equivalent clicks. This is also why the
// "debugger" permission is required and why Chrome shows a visible
// "started debugging this browser" infobar while an export runs.

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

async function attachDebugger(tabId) {
  await chrome.debugger.attach({ tabId }, '1.3');
}

async function detachDebugger(tabId) {
  try {
    await chrome.debugger.detach({ tabId });
  } catch (e) {
    // Already detached; nothing to do.
  }
}

async function cdpClick(tabId, x, y) {
  await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}

async function runInPage(tabId, func, args = []) {
  const results = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  return results[0]?.result;
}

// --- Functions injected into the page (must be self-contained) ---

function pageGetStartDateInputCenter() {
  const el = document.querySelector('input[name="startServerDate"]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function pageReadCalendarState(targetDay) {
  const picker = document.querySelector('.datetimepicker-days');
  if (!picker) return null;
  const centerOf = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };
  const header = picker.querySelector('.switch');
  const dayCell = Array.from(picker.querySelectorAll('td.day:not(.old):not(.new)'))
    .find(td => parseInt(td.textContent.trim(), 10) === targetDay);
  return {
    headerText: header ? header.textContent.trim() : null,
    prev: centerOf(picker.querySelector('.prev')),
    next: centerOf(picker.querySelector('.next')),
    day: centerOf(dayCell),
  };
}

function pageReadStartDateValue() {
  return document.querySelector('input[name="startServerDate"]')?.value || null;
}

// --- End of injected functions ---

function parseCalendarHeader(headerText) {
  const [monthName, yearStr] = headerText.split(' ');
  return { month: MONTH_NAMES.indexOf(monthName), year: parseInt(yearStr, 10) };
}

function isoDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d;
}

async function setDashboardStartDate(tabId, targetDate) {
  const inputCenter = await runInPage(tabId, pageGetStartDateInputCenter);
  if (!inputCenter) throw new Error('Start date field not found on this page.');
  await cdpClick(tabId, inputCenter.x, inputCenter.y);
  await new Promise(r => setTimeout(r, 400));

  const targetDay = targetDate.getDate();
  const targetMonth = targetDate.getMonth();
  const targetYear = targetDate.getFullYear();

  const maxNavigationClicks = 14;
  for (let attempt = 0; attempt <= maxNavigationClicks; attempt++) {
    const state = await runInPage(tabId, pageReadCalendarState, [targetDay]);
    if (!state || !state.headerText) throw new Error('Calendar did not open.');
    const { month, year } = parseCalendarHeader(state.headerText);
    const diff = (targetYear - year) * 12 + (targetMonth - month);

    if (diff === 0) {
      if (!state.day) throw new Error('Target day not found in the calendar.');
      await cdpClick(tabId, state.day.x, state.day.y);
      break;
    }
    if (attempt === maxNavigationClicks) throw new Error('Could not reach the target month.');

    const navButton = diff < 0 ? state.prev : state.next;
    if (!navButton) throw new Error('Calendar navigation arrow not found.');
    await cdpClick(tabId, navButton.x, navButton.y);
    await new Promise(r => setTimeout(r, 250));
  }

  await new Promise(r => setTimeout(r, 700));
  const expectedIso = targetDate.toISOString().slice(0, 10);
  const actualValue = await runInPage(tabId, pageReadStartDateValue);
  if (actualValue !== expectedIso) {
    throw new Error(`Date field shows "${actualValue}", expected "${expectedIso}".`);
  }
}

async function capturePng(tabId) {
  const tab = await chrome.tabs.get(tabId);
  return chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action !== 'exportDashboardPng') return false;

  (async () => {
    const { tabId, days, fileBaseName } = message;
    let attached = false;
    try {
      await attachDebugger(tabId);
      attached = true;
      await setDashboardStartDate(tabId, isoDaysAgo(days));
      await new Promise(r => setTimeout(r, 1000)); // let the charts finish re-rendering
      const dataUrl = await capturePng(tabId);
      await detachDebugger(tabId);
      attached = false;
      await chrome.downloads.download({ url: dataUrl, filename: `${fileBaseName}.png` });
      sendResponse({ ok: true });
    } catch (err) {
      if (attached) await detachDebugger(tabId);
      sendResponse({ ok: false, error: err.message });
    }
  })();

  return true; // keep the message channel open for the async response
});
