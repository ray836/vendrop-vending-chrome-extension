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

  if (request.type === 'DELETE_DUPLICATE') {
    deleteDuplicate(request.id, request.mergeIntoId).then(sendResponse);
    return true; // async response
  }

  if (request.type === 'START_SELECTED_IMPORT') {
    startSelectedImport();
    sendResponse({ success: true, started: true });
    return false;
  }

  if (request.type === 'CANCEL_SELECTED_IMPORT') {
    importCancelRequested = true;
    getImportProgress().then((cur) => patchImportProgress({ ...cur, canceling: true }));
    sendResponse({ success: true });
    return false;
  }

  if (request.type === 'GET_IMPORT_PROGRESS') {
    getImportProgress().then((progress) => sendResponse({ success: true, progress }));
    return true; // async response
  }

  return false;
});

// Badge the toolbar icon with the number of tiles currently checked.
async function refreshBadge() {
  const r = await chrome.storage.local.get('selection');
  const count = Object.keys(r.selection || {}).length;
  await chrome.action.setBadgeText({ text: count ? String(count) : '' });
  await chrome.action.setBadgeBackgroundColor({ color: '#0067a0' });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.selection) refreshBadge();
});
refreshBadge();

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

// Only one job's results should be on screen at a time — a leftover "Import complete"
// panel sitting above a fresh "Refresh complete" one is just two summaries to
// disentangle. Clear the other job's finished state before starting.
async function clearFinishedJob(key, getFn) {
  const other = await getFn();
  if (other && !other.running) await chrome.storage.local.remove(key);
}

async function startCatalogUpdate() {
  if (updateRunning) return;
  updateRunning = true;
  cancelRequested = false;
  try {
    await clearFinishedJob('selectedImport', getImportProgress);
    await runCatalogUpdate();
  } catch (e) {
    console.error('[VenDrop] Catalog update failed:', e);
    await patchProgress({ running: false, done: true, error: String((e && e.message) || e), currentName: '' });
  } finally {
    updateRunning = false;
    // The run is over and the work tab has closed — surface the results rather than
    // leaving them to be discovered next time the popup happens to be opened.
    await showPopup();
  }
}

async function runCatalogUpdate() {
  const settings = await getSettings();

  await setProgress({
    running: true, done: false, canceling: false, phase: 'loading',
    total: 0, processed: 0, updated: 0, unchanged: 0, skipped: 0, failed: 0,
    currentName: '', error: null, errors: [], changes: [], duplicates: [],
    feed: [], startedAt: Date.now(),
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

  await withWorkTab(async (tabId) => {
    for (let i = 0; i < targets.length; i++) {
      if (cancelRequested) break;
      const item = targets[i];
      await patchProgress({ currentName: item.name });

      try {
        const scraped = await navigateAndScrape(tabId, item.vendorLink, showPopup);
        const result = await refreshProduct(settings, item, scraped);

        const outcome = !result.ok
          ? 'failed'
          : result.changedFields.length === 0
          ? 'existed'
          : 'updated';

        if (outcome === 'failed') {
          await bump('failed', item, result.error);
        } else if (outcome === 'existed') {
          await bump('unchanged', item);
        } else {
          await bump('updated', item);
          await recordChange(item, result);
        }

        await pushFeed(
          getProgress, patchProgress, scraped, item, outcome,
          result.error, result.changedFields,
          { ...(result.product || {}), previousCaseCost: result.previousCaseCost }
        );
      } catch (e) {
        await bump('failed', item, e.message);
        await pushFeed(getProgress, patchProgress, null, item, 'failed', e.message);
      }

      await patchProgress({ processed: i + 1 });
      if (!cancelRequested) await sleep(POLITE_DELAY_MS); // don't hammer the retailer
    }
  });

  // A refresh is the natural moment to surface duplicates: legacy rows carry no
  // vendorSku, so the same product can sit in the catalog twice without the import
  // path ever noticing.
  await patchProgress({ phase: 'duplicates' });
  const groups = await fetchDuplicates(settings);
  const { merged, remaining } = await autoMergeDuplicates(settings, groups);
  await patchProgress({ duplicates: remaining, merged });

  await patchProgress({
    running: false, done: true, canceling: false,
    canceled: cancelRequested, currentName: '', finishedAt: Date.now(),
  });
}

// Push a freshly-scraped page back onto its catalog row. Targeted by `id`, not by
// vendorSku: legacy rows have no SKU, so a SKU-keyed write would create a second
// row instead of updating the one we're refreshing.
async function refreshProduct(settings, item, scraped) {
  const caseCost = parseFloat(scraped && scraped.case_cost);
  const caseSize = parseInt(scraped && scraped.case_size);

  if (!isFinite(caseCost) || caseCost <= 0) {
    return { ok: false, error: 'Could not read a price from the page', changedFields: [] };
  }
  if (!isFinite(caseSize) || caseSize <= 0) {
    return { ok: false, error: 'Could not read a case size from the page', changedFields: [] };
  }

  const res = await fetch(`${settings.apiUrl}/api/catalog`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${settings.catalogToken}` },
    body: JSON.stringify({
      id: item.id,
      name: scraped.name || item.name,
      image: scraped.image || item.image,
      description: scraped.description || null,
      caseCost,
      caseSize,
      vendorSku: scraped.vendor_sku || null,
      barcode: scraped.barcode || null,
      vendorLink: scraped.url || item.vendorLink,
      images: scraped.images || [],
    }),
  });

  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    return {
      ok: false,
      changedFields: [],
      error: `API at ${settings.apiUrl} returned ${res.status} (not JSON) — is the app running on that port?`,
    };
  }

  if (!res.ok || !data.success) {
    const error = res.status === 401
      ? 'Unauthorized — check your token'
      : (data.error || `Refresh failed (${res.status})`);
    return { ok: false, error, changedFields: [] };
  }

  return {
    ok: true,
    changedFields: data.changedFields || [],
    product: data.product,
    previousCaseCost: data.previousCaseCost,
  };
}

// Keep a per-item record of what actually moved, so the summary can say
// "price, image" instead of an opaque "3 updated".
async function recordChange(item, result) {
  const p = result.product || {};
  const cur = (await getProgress()) || {};
  const changes = (cur.changes || []).slice(0, 99);
  changes.push({
    name: p.name || item.name,
    fields: result.changedFields,
    previousCaseCost: result.previousCaseCost ?? null,
    caseCost: p.caseCost ?? null,
    recommendedPrice: p.recommendedPrice ?? null,
  });
  await patchProgress({ changes });
}

// Remove one side of a duplicate pair. `mergeIntoId` is the row being kept: the API
// repoints any org products cloned from the deleted row onto it, so nobody's stocked
// product loses its catalog link. Also drops the row from the summary in-place.
async function deleteDuplicate(id, mergeIntoId) {
  const settings = await getSettings();
  try {
    const res = await fetch(`${settings.apiUrl}/api/catalog`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${settings.catalogToken}` },
      body: JSON.stringify({ id, mergeIntoId: mergeIntoId || null }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      return { success: false, error: data.error || `Delete failed (${res.status})` };
    }

    const cur = (await getProgress()) || {};
    const duplicates = (cur.duplicates || [])
      .map((g) => ({ ...g, products: g.products.filter((p) => p.id !== id) }))
      .filter((g) => g.products.length > 1);
    await patchProgress({ duplicates });

    return { success: true, reassignedClones: data.reassignedClones || 0 };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Resolve duplicates that are provably the same product, and only those.
 *
 * A shared barcode identifies one physical item — two rows carrying the same one are
 * the same thing, so merging them is safe to do unattended. The "same name + case
 * size" rule is a heuristic: it is what nearly matched Jack Link's Beef Sticks (20 ct)
 * to Tender Style Beef Steak (15 ct), and only the size check separated them. Deletion
 * is permanent and has no undo, so heuristic matches stay flagged for a human.
 *
 * Nothing is lost when a row is merged away: the org products cloned from it are
 * repointed onto the survivor, so their stock, prices, and sales history are untouched.
 */
async function autoMergeDuplicates(settings, groups) {
  const merged = [];
  const remaining = [];

  for (const group of groups) {
    const decisive = group.reason === 'barcode' && group.products.length === 2;
    if (!decisive) {
      remaining.push(group);
      continue;
    }

    const [keep, drop] = [...group.products].sort(compareKeepPreference);
    const res = await deleteDuplicate(drop.id, keep.id);

    if (res.success) {
      merged.push({
        kept: keep.name,
        keptAdded: keep.createdAt || null,
        deletedAdded: drop.createdAt || null,
        reassignedClones: res.reassignedClones || 0,
      });
    } else {
      // Couldn't merge it — hand it back to the human rather than dropping it silently.
      remaining.push(group);
    }
  }

  return { merged, remaining };
}

// Which row survives a merge. Usage first (the row an org actually picked is the
// canonical one), then age — the original entry outranks a later re-import.
function compareKeepPreference(a, b) {
  const use = (p) => ((p.usage && p.usage.clones) || 0) + ((p.usage && p.usage.unitsSold) || 0);
  if (use(a) !== use(b)) return use(b) - use(a);

  const age = (p) => (p.createdAt ? new Date(p.createdAt).getTime() : Infinity);
  return age(a) - age(b);
}

async function fetchDuplicates(settings) {
  try {
    const res = await fetch(`${settings.apiUrl}/api/catalog?duplicates=1`, {
      headers: { 'Authorization': `Bearer ${settings.catalogToken}` },
    });
    const data = await res.json();
    return res.ok && data.success ? data.data || [] : [];
  } catch (e) {
    return []; // never fail a whole refresh over the duplicate scan
  }
}

// ===== Foreground scrape tab =====
// Sam's Club does not reliably render prices in a background tab, so scraping
// happens in a real, focused tab. One tab is opened for the whole run and
// re-navigated per item; the user's original tab is restored when it finishes.

async function withWorkTab(fn) {
  let original = null;
  try {
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    original = active || null;
  } catch (e) {
    // No active tab we can return to; not fatal.
  }

  const tab = await chrome.tabs.create({ url: 'about:blank', active: true });
  try {
    return await fn(tab.id);
  } finally {
    try {
      await chrome.tabs.remove(tab.id);
    } catch (e) {
      // Tab may already be gone (user closed it).
    }
    if (original && original.id != null) {
      try {
        await chrome.tabs.update(original.id, { active: true });
      } catch (e) {
        // Original tab may have been closed mid-run.
      }
    }
  }
}

function waitForLoad(tabId, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      reject(new Error('Timed out loading page'));
    }, timeoutMs);

    const onUpdated = (id, info) => {
      if (id !== tabId || info.status !== 'complete') return;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timer);
      resolve();
    };

    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

// Navigate the work tab to a product page and scrape it via the content script.
// `onLoaded` runs once the page is up, before the settle delay.
async function navigateAndScrape(tabId, url, onLoaded) {
  await chrome.tabs.update(tabId, { url, active: true });
  await waitForLoad(tabId);
  if (onLoaded) await onLoaded();
  await sleep(2500); // let dynamically-rendered prices settle
  return scrapeWithRetry(tabId, 3);
}

// Focusing the work tab closes the popup, so re-open it on each product page to
// keep the run visible. Best-effort: throws if already open or window unfocused.
async function showPopup() {
  try {
    if (chrome.action.openPopup) await chrome.action.openPopup();
  } catch (e) {
    // Popup already open, or the browser window isn't focused — not fatal.
  }
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

// ===== Bulk import of tiles selected on listing pages =====
// Listing tiles don't carry case size, item number, or barcode, so each queued
// product page is actually visited and scraped with the same extractor the
// single-product flow uses.

let importRunning = false;
let importCancelRequested = false;

async function getImportProgress() {
  const r = await chrome.storage.local.get('selectedImport');
  return r.selectedImport || null;
}

async function patchImportProgress(patch) {
  const cur = (await getImportProgress()) || {};
  const next = { ...cur, ...patch };
  await chrome.storage.local.set({ selectedImport: next });
  return next;
}

async function bumpImport(kind, item, errMsg) {
  const cur = (await getImportProgress()) || {};
  const patch = { [kind]: (cur[kind] || 0) + 1 };
  if (errMsg) {
    const errors = (cur.errors || []).slice(0, 49);
    errors.push({ name: item && item.name, error: String(errMsg) });
    patch.errors = errors;
  }
  await patchImportProgress(patch);
}

async function startSelectedImport() {
  if (importRunning) return;
  importRunning = true;
  importCancelRequested = false;
  try {
    await clearFinishedJob('catalogUpdate', getProgress);
    await runSelectedImport();
  } catch (e) {
    console.error('[VenDrop] Selected import failed:', e);
    await patchImportProgress({ running: false, done: true, error: String((e && e.message) || e), currentName: '' });
  } finally {
    importRunning = false;
    await showPopup(); // results are the point — don't make the user go find them
  }
}

async function runSelectedImport() {
  const settings = await getSettings();
  const stored = await chrome.storage.local.get('selection');
  const items = Object.values(stored.selection || {});

  await chrome.storage.local.set({
    selectedImport: {
      running: true, done: false, canceling: false,
      total: items.length, processed: 0, added: 0, updated: 0, existed: 0, failed: 0,
      currentName: '', error: null, errors: [], results: [], feed: [], startedAt: Date.now(),
    },
  });

  if (!settings.catalogToken) {
    await patchImportProgress({ running: false, done: true, error: 'Missing catalog maintainer token — open Settings' });
    return;
  }
  if (!items.length) {
    await patchImportProgress({ running: false, done: true, error: 'Nothing selected' });
    return;
  }

  await withWorkTab(async (tabId) => {
    for (let i = 0; i < items.length; i++) {
      if (importCancelRequested) break;
      const item = items[i];
      await patchImportProgress({ currentName: item.name });

      let scraped = null;
      try {
        scraped = await navigateAndScrape(tabId, item.url, showPopup);
        const result = await postProduct(settings, scraped, item.url);

        if (result.ok) {
          const kind = result.action === 'created'
            ? 'added'
            : result.action === 'updated'
            ? 'updated'
            : 'existed';
          await bumpImport(kind, item);
          await recordResult(kind, result, item);
          await pushFeed(getImportProgress, patchImportProgress, scraped, item, kind, null, result.changedFields, result.product);
          await removeFromSelection(item.id); // keep only what still needs importing
        } else {
          await bumpImport('failed', item, result.error);
          await pushFeed(getImportProgress, patchImportProgress, scraped, item, 'failed', result.error);
        }
      } catch (e) {
        await bumpImport('failed', item, e.message);
        await pushFeed(getImportProgress, patchImportProgress, scraped, item, 'failed', e.message);
      }

      await patchImportProgress({ processed: i + 1 });
      if (!importCancelRequested) await sleep(POLITE_DELAY_MS); // don't hammer the retailer
    }
  });

  await patchImportProgress({
    running: false, done: true, canceling: false,
    canceled: importCancelRequested, currentName: '', finishedAt: Date.now(),
  });
}

// Between visiting a page and scraping it, a single item takes ~5s — so a card that
// clears after a couple of seconds leaves the popup blank most of the run. Nothing is
// cleared now: each finished item is pushed onto a running feed (newest first) that
// stays on screen, so a result can be read long after it scrolled past.
const POLITE_DELAY_MS = 1000;
const FEED_LIMIT = 100;

// `getFn`/`patchFn` pick which job's progress this lands on — the selected-import run
// and the catalog-refresh run keep separate storage keys, and writing to the wrong one
// means the popup renders nothing.
async function pushFeed(getFn, patchFn, scraped, item, outcome, error, changed, product) {
  const s = scraped || {};
  const p = product || {};

  const entry = {
    at: Date.now(),
    outcome,
    error: error || null,
    changed: changed || null,
    name: s.name || item.name,
    image: s.image || item.image || null,
    // What the extractor actually read off the page — not the API's echo of it, so a
    // bad scrape shows the bad value rather than a sanitized one.
    caseCost: s.case_cost ?? null,
    caseSize: s.case_size ?? null,
    vendorSku: s.vendor_sku || null,
    itemNumber: s.item_number || null,
    barcode: s.barcode || null,
    previousCaseCost: p.previousCaseCost ?? null,
    recommendedPrice: p.recommendedPrice ?? null,
  };

  const cur = (await getFn()) || {};
  const feed = [entry, ...(cur.feed || [])].slice(0, FEED_LIMIT);
  await patchFn({ feed });
}

// Keep what actually landed in the catalog, so the popup can show the details
// rather than just a count.
async function recordResult(kind, result, item) {
  const p = result.product || {};
  const cur = (await getImportProgress()) || {};
  const results = (cur.results || []).slice(0, 99);
  results.push({
    kind,
    name: p.name || item.name,
    url: item.url,
    image: p.image || null,
    caseCost: p.caseCost ?? null,
    caseSize: p.caseSize ?? null,
    recommendedPrice: p.recommendedPrice ?? null,
    vendorSku: p.vendorSku || null,
    barcode: p.barcode || null,
    category: p.category || null,
    previousCaseCost: result.previousCaseCost ?? null,
  });
  await patchImportProgress({ results });
}

async function removeFromSelection(id) {
  const r = await chrome.storage.local.get('selection');
  const selection = r.selection || {};
  delete selection[id];
  await chrome.storage.local.set({ selection });
}

async function postProduct(settings, scraped, url) {
  const missing = ['name', 'image', 'case_cost', 'case_size', 'vendor_sku']
    .filter((f) => !scraped || !scraped[f]);
  if (missing.length) {
    return { ok: false, error: `Missing ${missing.join(', ').replace(/_/g, ' ')} on the product page` };
  }

  const res = await fetch(`${settings.apiUrl}/api/catalog`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${settings.catalogToken}` },
    body: JSON.stringify({
      name: scraped.name,
      image: scraped.image,
      caseCost: parseFloat(scraped.case_cost),
      caseSize: parseInt(scraped.case_size),
      vendorSku: scraped.vendor_sku,
      barcode: scraped.barcode || null,
      vendorLink: scraped.url || url,
      category: 'Snacks',
      recommendedPriceMultiplier: 1.5,
      region: null,
      // Whole gallery — the API classifies it and keeps the single-unit shot
      // used to recognize this product in a machine photo.
      images: scraped.images || [],
    }),
  });

  // A non-JSON body means the request never reached the route (dead server, wrong
  // port, crashed middleware) — say so, rather than a bare status code.
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    return {
      ok: false,
      error: `API at ${settings.apiUrl} returned ${res.status} (not JSON) — is the app running on that port?`,
    };
  }

  if (!res.ok || !data.success) {
    const error = res.status === 401
      ? 'Unauthorized — check your token'
      : (data.error || `Import failed (${res.status})`);
    return { ok: false, error };
  }

  // action: "created" (new row) | "updated" (existing row, case cost changed)
  //       | "exists" (existing row, nothing changed)
  return {
    ok: true,
    action: data.action,
    product: data.product,
    previousCaseCost: data.previousCaseCost,
  };
}

// If the worker was killed mid-run, don't leave a phantom "running" state.
(async function reconcileStaleRun() {
  const cur = await getProgress();
  if (cur && cur.running) {
    await patchProgress({ running: false, done: true, interrupted: true, currentName: '' });
  }
  const imp = await getImportProgress();
  if (imp && imp.running) {
    await patchImportProgress({ running: false, done: true, interrupted: true, currentName: '' });
  }
})();

console.log('[VenDrop] Background service worker ready');
