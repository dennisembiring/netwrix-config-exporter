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
  // There can be two .datetimepicker-days elements in the DOM (one per date
  // input on the dashboard), but only one is actually open/visible at a time.
  // Picking the wrong one silently clicks an invisible calendar that never
  // changes what's on screen, which looked like "next never advances the month".
  const pickers = Array.from(document.querySelectorAll('.datetimepicker-days'))
    .filter(el => el.offsetParent !== null);
  const picker = pickers[0];
  if (!picker) return { pickerCount: pickers.length };
  const centerOf = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };
  const header = picker.querySelector('.switch');
  const dayCell = Array.from(picker.querySelectorAll('td.day:not(.old):not(.new)'))
    .find(td => parseInt(td.textContent.trim(), 10) === targetDay);
  return {
    pickerCount: pickers.length,
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

// Opens the picker, navigates to the target month, clicks the target day, and
// returns the field's resulting value (does not throw on mismatch -- the
// caller retries, since a single click occasionally lands on the wrong day
// for reasons not fully understood, possibly a layout shift between reading
// the cell's coordinates and the click landing).
async function attemptSetDashboardStartDate(tabId, targetDate, history) {
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
    if (!state || !state.headerText) {
      throw new Error(`Calendar did not open (visible picker count: ${state ? state.pickerCount : 'n/a'}). History: ${JSON.stringify(history)}`);
    }
    const { month, year } = parseCalendarHeader(state.headerText);
    const diff = (targetYear - year) * 12 + (targetMonth - month);
    history.push({ pickerCount: state.pickerCount, headerText: state.headerText, parsedMonth: month, parsedYear: year, diff, hasDay: !!state.day, hasPrev: !!state.prev, hasNext: !!state.next, next: state.next });

    if (diff === 0) {
      if (!state.day) {
        throw new Error(`Target day ${targetDay} not found in the calendar for "${state.headerText}". History: ${JSON.stringify(history)}`);
      }
      await cdpClick(tabId, state.day.x, state.day.y);
      break;
    }
    if (attempt === maxNavigationClicks) {
      throw new Error(`Could not reach the target month (wanted ${targetYear}-${targetMonth + 1}). History: ${JSON.stringify(history)}`);
    }

    const navButton = diff < 0 ? state.prev : state.next;
    if (!navButton) {
      throw new Error(`Calendar navigation arrow not found (diff=${diff}, header="${state.headerText}"). History: ${JSON.stringify(history)}`);
    }
    await cdpClick(tabId, navButton.x, navButton.y);
    await new Promise(r => setTimeout(r, 250));
  }

  await new Promise(r => setTimeout(r, 700));
  return runInPage(tabId, pageReadStartDateValue);
}

async function setDashboardStartDate(tabId, targetDate) {
  const expectedIso = targetDate.toISOString().slice(0, 10);
  const history = [];
  const maxRetries = 4;
  let clickDate = targetDate;

  for (let retry = 1; retry <= maxRetries; retry++) {
    const actualValue = await attemptSetDashboardStartDate(tabId, clickDate, history);
    if (actualValue === expectedIso) return;
    history.push({ retry, clicked: clickDate.toISOString().slice(0, 10), mismatch: actualValue });
    if (retry === maxRetries) {
      throw new Error(`Date field shows "${actualValue}", expected "${expectedIso}", after ${maxRetries} attempts. History: ${JSON.stringify(history)}`);
    }
    // The mismatch was exactly the same every retry with an unchanged target,
    // which points to a deterministic off-by-one in the page itself (its own
    // "today" default also runs a day behind), not a flaky click. Measure the
    // actual offset and compensate on the next click instead of repeating the
    // same click and expecting a different result.
    const offsetDays = Math.round((Date.parse(actualValue + 'T00:00:00Z') - Date.parse(expectedIso + 'T00:00:00Z')) / 86400000);
    clickDate = new Date(clickDate.getTime() - offsetDays * 86400000);
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
