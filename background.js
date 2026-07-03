// Background service worker for VenDrop Chrome Extension
// Handles extension lifecycle events

console.log('[VenDrop] Background service worker started');

// Listen for extension installation
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[VenDrop] Extension installed');

    // Set default API URL
    chrome.storage.sync.set({
      apiUrl: 'http://localhost:3000'
    });
  } else if (details.reason === 'update') {
    console.log('[VenDrop] Extension updated');
  }
});

// Listen for tab updates to detect when user navigates to supported pages
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Only act when the page has finished loading
  if (changeInfo.status === 'complete' && tab.url) {
    const isSupportedSite =
      tab.url.includes('samsclub.com') ||
      tab.url.includes('costco.com');

    if (isSupportedSite) {
      console.log('[VenDrop] Detected supported site:', tab.url);

      // Update extension icon to indicate it's active
      chrome.action.setIcon({
        tabId: tabId,
        path: {
          16: 'icons/icon16.png',
          48: 'icons/icon48.png',
          128: 'icons/icon128.png'
        }
      });
    }
  }
});

// Listen for messages from popup or content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'BACKGROUND_PING') {
    sendResponse({ success: true, message: 'Background script is running' });
    return false;
  }

  if (request.type === 'START_CATALOG_UPDATE') {
    // Fire-and-forget: the sweep runs in this service worker so it survives the
    // popup closing. Progress is written to storage and polled by the popup.
    startCatalogUpdate();
    sendResponse({ success: true, started: true });
    return false;
  }

  if (request.type === 'CANCEL_CATALOG_UPDATE') {
    cancelRequested = true;
    getProgress().then((cur) => patchProgress({ ...cur, canceling: true }));
    sendResponse({ success: true });
    return false;
  }

  if (request.type === 'GET_UPDATE_PROGRESS') {
    getProgress().then((progress) => sendResponse({ success: true, progress }));
    return true; // async response
  }

  return false;
});

// ===== Bulk catalog price sweep =====
// One click walks the whole catalog: open each item's vendor page as a quiet
// background tab, re-scrape its case cost, and PATCH the catalog when it changed.

let updateRunning = false;
let cancelRequested = false;

async function getSettings() {
  const r = await chrome.storage.sync.get(['catalogToken', 'apiUrl']);
  return {
    catalogToken: r.catalogToken || '',
    apiUrl: r.apiUrl || 'http://localhost:3000',
  };
}

async function getProgress() {
  const r = await chrome.storage.local.get('catalogUpdate');
  return r.catalogUpdate || null;
}

async function setProgress(p) {
  await chrome.storage.local.set({ catalogUpdate: p });
}

async function patchProgress(patch) {
  const cur = (await getProgress()) || {};
  const next = { ...cur, ...patch };
  await setProgress(next);
  return next;
}

async function bump(kind, item, errMsg) {
  const cur = (await getProgress()) || {};
  const patch = { [kind]: (cur[kind] || 0) + 1 };
  if (errMsg) {
    const errors = (cur.errors || []).slice(0, 49);
    errors.push({ name: item && item.name, error: String(errMsg) });
    patch.errors = errors;
  }
  await patchProgress(patch);
}

function isSupportedUrl(u) {
  return typeof u === 'string' && (u.includes('samsclub.com') || u.includes('costco.com'));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function startCatalogUpdate() {
  if (updateRunning) return;
  updateRunning = true;
  cancelRequested = false;
  try {
    await runCatalogUpdate();
  } catch (e) {
    console.error('[VenDrop] Catalog update failed:', e);
    await patchProgress({ running: false, done: true, error: String((e && e.message) || e), currentName: '' });
  } finally {
    updateRunning = false;
  }
}

async function runCatalogUpdate() {
  const settings = await getSettings();

  await setProgress({
    running: true, done: false, canceling: false, phase: 'loading',
    total: 0, processed: 0, updated: 0, unchanged: 0, skipped: 0, failed: 0,
    currentName: '', error: null, errors: [], startedAt: Date.now(),
  });

  if (!settings.catalogToken) {
    await patchProgress({ running: false, done: true, error: 'Missing catalog maintainer token — open Settings' });
    return;
  }

  // Fetch the whole catalog (maintainer Bearer path).
  let items;
  try {
    const res = await fetch(`${settings.apiUrl}/api/catalog`, {
      headers: { 'Authorization': `Bearer ${settings.catalogToken}` },
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(res.status === 401 ? 'Unauthorized — check your token' : (data.error || `List failed (${res.status})`));
    }
    items = data.data || [];
  } catch (e) {
    await patchProgress({ running: false, done: true, error: `Could not load catalog: ${e.message}` });
    return;
  }

  const targets = items.filter((it) => isSupportedUrl(it.vendorLink));
  const skippedNoLink = items.length - targets.length;
  await patchProgress({ phase: 'running', total: targets.length, skipped: skippedNoLink });

  for (let i = 0; i < targets.length; i++) {
    if (cancelRequested) break;
    const item = targets[i];
    await patchProgress({ currentName: item.name });

    try {
      const scraped = await openAndScrape(item.vendorLink);
      const newCost = parseFloat(scraped && scraped.case_cost);

      if (!isFinite(newCost) || newCost <= 0) {
        await bump('failed', item, 'Could not read a price from the page');
      } else {
        const oldCost = parseFloat(item.caseCost);
        if (isFinite(oldCost) && Math.abs(oldCost - newCost) < 0.01) {
          await bump('unchanged', item);
        } else {
          const res = await fetch(`${settings.apiUrl}/api/catalog`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${settings.catalogToken}` },
            body: JSON.stringify({ id: item.id, caseCost: newCost }),
          });
          const data = await res.json();
          if (!res.ok || !data.success) {
            await bump('failed', item, data.error || `Update failed (${res.status})`);
          } else {
            await bump('updated', item);
          }
        }
      }
    } catch (e) {
      await bump('failed', item, e.message);
    }

    await patchProgress({ processed: i + 1 });
    if (!cancelRequested && i < targets.length - 1) await sleep(1200); // be polite
  }

  await patchProgress({
    running: false, done: true, canceling: false,
    canceled: cancelRequested, currentName: '', finishedAt: Date.now(),
  });
}

// Open a vendor URL as an inactive tab, wait for it to load, scrape it via the
// content script, then close the tab. Resolves with the scraped productInfo.
function openAndScrape(url) {
  return new Promise((resolve, reject) => {
    chrome.tabs.create({ url, active: false }, (tab) => {
      if (chrome.runtime.lastError || !tab) {
        reject(new Error((chrome.runtime.lastError && chrome.runtime.lastError.message) || 'Could not open tab'));
        return;
      }
      const tabId = tab.id;
      let settled = false;

      const finish = (fn) => {
        if (settled) return;
        settled = true;
        chrome.tabs.onUpdated.removeListener(onUpdated);
        clearTimeout(timer);
        chrome.tabs.remove(tabId, () => void chrome.runtime.lastError);
        fn();
      };

      const timer = setTimeout(() => finish(() => reject(new Error('Timed out loading page'))), 30000);

      const onUpdated = (id, info) => {
        if (id !== tabId || info.status !== 'complete') return;
        chrome.tabs.onUpdated.removeListener(onUpdated);
        // Let dynamically-rendered prices settle, then scrape with a few retries.
        setTimeout(() => {
          scrapeWithRetry(tabId, 3).then(
            (productInfo) => finish(() => resolve(productInfo)),
            (err) => finish(() => reject(err))
          );
        }, 2500);
      };

      chrome.tabs.onUpdated.addListener(onUpdated);
    });
  });
}

function scrapeWithRetry(tabId, attempts) {
  return new Promise((resolve, reject) => {
    const tryOnce = (n) => {
      chrome.tabs.sendMessage(tabId, { type: 'GET_PRODUCT_INFO' }, (resp) => {
        if (chrome.runtime.lastError || !resp || !resp.success || !resp.productInfo) {
          if (n <= 1) {
            reject(new Error((chrome.runtime.lastError && chrome.runtime.lastError.message) || 'No product data on page'));
            return;
          }
          setTimeout(() => tryOnce(n - 1), 1200);
          return;
        }
        resolve(resp.productInfo);
      });
    };
    tryOnce(attempts);
  });
}

// If the worker was killed mid-sweep, don't leave a phantom "running" state.
(async function reconcileStaleRun() {
  const cur = await getProgress();
  if (cur && cur.running) {
    await patchProgress({ running: false, done: true, interrupted: true, currentName: '' });
  }
})();

console.log('[VenDrop] Background service worker ready');
