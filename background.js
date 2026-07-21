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
    startCatalogUpdate(request.locationIds || []);
    sendResponse({ success: true, started: true });
    return false;
  }

  if (request.type === 'GET_REFRESH_LOCATIONS') {
    getSettings()
      .then(fetchRefreshLocations)
      .then((locations) => sendResponse({ success: true, locations }))
      .catch((error) => sendResponse({ success: false, error: String(error?.message || error), locations: [] }));
    return true;
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

  if (request.type === 'START_CART_PLACEMENT') {
    handleStartCartPlacement(request.payload, sender).then(sendResponse);
    return true;
  }

  if (request.type === 'CANCEL_CART_PLACEMENT') {
    cancelCartPlacement(request.orderId).then(sendResponse);
    return true;
  }

  if (request.type === 'GET_CART_PLACEMENT_PROGRESS') {
    getCartPlacementProgress().then((progress) => sendResponse({ success: true, progress }));
    return true;
  }

  if (request.type === 'START_PURCHASE_HISTORY_SYNC') {
    handlePurchaseHistorySync(request.payload, sender).then(sendResponse);
    return true;
  }

  if (request.type === 'GET_PURCHASE_HISTORY_PROGRESS') {
    getPurchaseHistoryProgress().then((progress) => sendResponse({ success: true, progress }));
    return true;
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

// Count the server's actual fingerprint decision. Product fields are not a safe
// proxy: AI can refresh internal metadata while every public field stays identical.
async function bumpAnalysis(getFn, patchFn, analysis, item) {
  if (!analysis) return;
  const cur = (await getFn()) || {};
  const patch = analysis.aiUsed
    ? { aiUsed: (cur.aiUsed || 0) + 1 }
    : { aiReused: (cur.aiReused || 0) + 1 };
  if (analysis.aiUsed && analysis.succeeded === false) {
    patch.aiIncomplete = (cur.aiIncomplete || 0) + 1;
  }

  const usage = analysis.usage || {};
  patch.aiCalls = (cur.aiCalls || 0) + (usage.calls || 0);
  patch.aiInputTokens = (cur.aiInputTokens || 0) + (usage.inputTokens || 0);
  patch.aiOutputTokens = (cur.aiOutputTokens || 0) + (usage.outputTokens || 0);
  patch.aiReasoningTokens = (cur.aiReasoningTokens || 0) + (usage.reasoningTokens || 0);
  patch.aiEstimatedCostUsd = (cur.aiEstimatedCostUsd || 0) + (usage.estimatedCostUsd || 0);
  patch.aiDurationMs = (cur.aiDurationMs || 0) + (usage.durationMs || 0);

  const providerUsage = { ...(cur.aiProviderUsage || {}) };
  for (const provider of usage.providers || []) {
    const previous = providerUsage[provider.provider] || {};
    providerUsage[provider.provider] = {
      provider: provider.provider,
      calls: (previous.calls || 0) + (provider.calls || 0),
      inputTokens: (previous.inputTokens || 0) + (provider.inputTokens || 0),
      outputTokens: (previous.outputTokens || 0) + (provider.outputTokens || 0),
      reasoningTokens: (previous.reasoningTokens || 0) + (provider.reasoningTokens || 0),
      estimatedCostUsd: (previous.estimatedCostUsd || 0) + (provider.estimatedCostUsd || 0),
      durationMs: (previous.durationMs || 0) + (provider.durationMs || 0),
    };
  }
  patch.aiProviderUsage = providerUsage;

  if (Array.isArray(analysis.disabledProviders) && analysis.disabledProviders.length) {
    patch.disabledAiProviders = [...new Set([
      ...(cur.disabledAiProviders || []),
      ...analysis.disabledProviders,
    ])];
  }
  if (Array.isArray(analysis.disabledModels) && analysis.disabledModels.length) {
    patch.disabledAiModels = [...new Set([
      ...(cur.disabledAiModels || []),
      ...analysis.disabledModels,
    ])];
  }

  if (Array.isArray(analysis.failures) && analysis.failures.length) {
    const failures = (cur.aiFailures || []).slice(-199);
    for (const failure of analysis.failures) {
      failures.push({
        name: item?.name || 'Unnamed product',
        provider: failure.provider || 'unknown',
        model: failure.model || null,
        feature: failure.feature || 'catalog_analysis',
        kind: failure.kind || 'provider_error',
        reason: failure.reason || 'Unknown provider failure',
      });
    }
    patch.aiFailures = failures.slice(-200);
  }
  await patchFn(patch);
}

function isSupportedUrl(u) {
  return typeof u === 'string' && (u.includes('samsclub.com') || u.includes('costco.com'));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ===== Sam's Club order cart placement =====
// The VenDrop Orders page supplies a short-lived token scoped to one order.
// This flow opens one foreground product tab, adds the requested case quantity
// for each line, confirms the handoff, and deliberately stops on the cart page.

let cartPlacementRunning = false;
let cartPlacementCancelRequested = false;
let purchaseHistorySyncRunning = false;

async function getCartPlacementProgress() {
  const result = await chrome.storage.local.get('cartPlacement');
  return result.cartPlacement || null;
}

async function setCartPlacementProgress(progress) {
  await chrome.storage.local.set({ cartPlacement: progress });
}

async function patchCartPlacementProgress(patch) {
  const current = (await getCartPlacementProgress()) || {};
  const next = { ...current, ...patch };
  await setCartPlacementProgress(next);
  return next;
}

async function getPurchaseHistoryProgress() {
  const result = await chrome.storage.local.get('purchaseHistorySync');
  return result.purchaseHistorySync || null;
}

async function patchPurchaseHistoryProgress(patch, originTabId) {
  const current = (await getPurchaseHistoryProgress()) || {};
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ purchaseHistorySync: next });
  const targetTabId = originTabId || next.originTabId;
  if (targetTabId) {
    try {
      await chrome.tabs.sendMessage(targetTabId, {
        type: 'PURCHASE_HISTORY_SYNC_PROGRESS',
        detail: next,
      });
    } catch (e) {
      // The setup tab may be navigating or closed. Storage remains authoritative
      // and the page/popup can recover by polling it.
    }
  }
  return next;
}

function withTimeout(promise, timeoutMs, message) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

function normalizeApiBaseUrl(value) {
  try {
    const url = new URL(value);
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) return null;
    return url.origin;
  } catch (e) {
    return null;
  }
}

async function handlePurchaseHistorySync(payload, sender) {
  const apiBaseUrl = normalizeApiBaseUrl(payload?.apiBaseUrl);
  const syncId = String(payload?.syncId || '');
  const extensionToken = String(payload?.extensionToken || '');
  const requestedAt = String(payload?.requestedAt || '');
  if (!apiBaseUrl || !syncId || !extensionToken || !requestedAt) {
    return { success: false, error: 'Invalid purchase-history handoff' };
  }
  try {
    if (!sender?.tab?.id || !sender.tab.url || new URL(sender.tab.url).origin !== apiBaseUrl) {
      return { success: false, error: 'Purchase-history origin mismatch' };
    }
  } catch (e) {
    return { success: false, error: 'Invalid purchase-history origin' };
  }
  if (purchaseHistorySyncRunning) {
    const current = await getPurchaseHistoryProgress();
    return current?.syncId === syncId
      ? { success: true, alreadyRunning: true }
      : { success: false, error: 'A purchase-history sync is already running' };
  }

  const job = {
    syncId,
    extensionToken,
    apiBaseUrl,
    originTabId: sender.tab.id,
  };
  purchaseHistorySyncRunning = true;
  await chrome.storage.local.set({
    purchaseHistorySync: {
      syncId,
      originTabId: sender.tab.id,
      running: true,
      done: false,
      phase: 'starting',
      step: 0,
      totalSteps: 4,
      message: 'Starting purchase-history sync…',
      imported: 0,
      matched: 0,
      error: null,
      startedAt: Date.now(),
      finishedAt: null,
    },
  });
  runPurchaseHistorySync(job)
    .catch((error) => notifyPurchaseHistoryError(job, error))
    .finally(() => { purchaseHistorySyncRunning = false; });
  return { success: true, started: true };
}

function scrapePurchaseHistoryInTab(tabId) {
  return new Promise((resolve, reject) => {
    const attempt = (remaining) => {
      chrome.tabs.sendMessage(tabId, { type: 'SCRAPE_SAMS_PURCHASE_HISTORY' }, (response) => {
        if (chrome.runtime.lastError || !response) {
          if (remaining > 1) return setTimeout(() => attempt(remaining - 1), 1000);
          return reject(new Error(chrome.runtime.lastError?.message || 'Sam\'s Club purchase history did not respond'));
        }
        if (!response.success) return reject(new Error(response.error || 'Could not read purchase history'));
        resolve(response.items || []);
      });
    };
    attempt(5);
  });
}

async function runPurchaseHistorySync(job) {
  await patchPurchaseHistoryProgress({
    phase: 'opening-history',
    step: 1,
    message: 'Opening Sam\'s Club purchase history…',
  }, job.originTabId);
  const tab = await chrome.tabs.create({ url: 'about:blank', active: true });
  await patchPurchaseHistoryProgress({ workTabId: tab.id }, job.originTabId);
  const loaded = waitForLoad(tab.id, 45000);
  await chrome.tabs.update(tab.id, { url: 'https://www.samsclub.com/orders', active: true });
  await loaded;
  await sleep(2200);

  await patchPurchaseHistoryProgress({
    phase: 'reading-history',
    step: 2,
    message: 'Reading recent purchases…',
  }, job.originTabId);
  const items = await withTimeout(
    scrapePurchaseHistoryInTab(tab.id),
    45_000,
    'Sam\'s Club took too long to return purchase history. Make sure you are signed in and try again.'
  );
  await patchPurchaseHistoryProgress({
    phase: 'uploading',
    step: 3,
    message: items.length
      ? `Saving ${items.length} recent purchase item${items.length === 1 ? '' : 's'}…`
      : 'Saving your history connection…',
    imported: items.length,
  }, job.originTabId);

  const controller = new AbortController();
  const uploadTimeout = setTimeout(() => controller.abort(), 25_000);
  let result;
  try {
    result = await fetchJson(`${job.apiBaseUrl}/api/integrations/sams-club/purchase-history`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${job.extensionToken}`,
      },
      body: JSON.stringify({ syncId: job.syncId, items }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('VendorPro took too long to save purchase history. Try again.');
    throw error;
  } finally {
    clearTimeout(uploadTimeout);
  }

  await chrome.tabs.remove(tab.id).catch(() => {});
  await chrome.tabs.update(job.originTabId, { active: true }).catch(() => {});
  const complete = await patchPurchaseHistoryProgress({
    running: false,
    done: true,
    phase: 'complete',
    step: 4,
    message: result.imported === 0
      ? 'Done — no recent product purchases were found. You can still continue setup.'
      : result.matched === 0
        ? `Done — ${result.imported} purchases found. None match the catalog yet, and that’s okay.`
        : `Done — ${result.imported} purchases found; ${result.matched} match the catalog.`,
    imported: result.imported,
    matched: result.matched || 0,
    stored: result.stored,
    syncedAt: result.syncedAt,
    finishedAt: Date.now(),
  }, job.originTabId);
  try {
    await chrome.tabs.sendMessage(job.originTabId, {
      type: 'PURCHASE_HISTORY_SYNC_COMPLETE',
      detail: complete,
    });
  } catch (e) {
    // The setup page will recover the completed state from storage when it polls.
  }
}

async function notifyPurchaseHistoryError(job, error) {
  const message = String(error?.message || error || 'Purchase-history sync failed');
  console.error('[VenDrop] Purchase-history sync failed:', message);
  const failed = await patchPurchaseHistoryProgress({
    running: false,
    done: true,
    phase: 'failed',
    message,
    error: message,
    finishedAt: Date.now(),
  }, job.originTabId);
  try {
    await chrome.tabs.sendMessage(job.originTabId, {
      type: 'PURCHASE_HISTORY_SYNC_ERROR',
      detail: failed,
    });
  } catch (e) {
    // The setup page will recover the failed state from storage when it polls.
  }
}

async function handleStartCartPlacement(payload, sender) {
  const apiBaseUrl = normalizeApiBaseUrl(payload?.apiBaseUrl);
  const orderId = String(payload?.orderId || '');
  const extensionToken = String(payload?.extensionToken || '');
  const placedAt = String(payload?.placedAt || '');
  if (!apiBaseUrl || !orderId || !extensionToken || !placedAt) {
    return { success: false, error: 'Invalid cart placement handoff' };
  }

  // Only the app page that originated the message may choose the API origin.
  // The extension host permissions provide the second boundary.
  try {
    if (!sender?.tab?.url || new URL(sender.tab.url).origin !== apiBaseUrl) {
      return { success: false, error: 'Cart placement origin mismatch' };
    }
  } catch (e) {
    return { success: false, error: 'Invalid cart placement origin' };
  }

  const current = await getCartPlacementProgress();
  if (cartPlacementRunning || current?.running) {
    return current?.orderId === orderId
      ? { success: true, alreadyRunning: true }
      : { success: false, error: 'Another cart placement is already running' };
  }

  const job = { orderId, extensionToken, apiBaseUrl, placedAt };
  // Claim the worker synchronously before touching storage so startup
  // reconciliation cannot mistake this brand-new run for an interrupted one.
  cartPlacementRunning = true;
  cartPlacementCancelRequested = false;
  try {
    await setCartPlacementProgress({
      ...job,
      running: true,
      done: false,
      phase: 'loading-order',
      processed: 0,
      total: 0,
      currentName: '',
      removedCartItems: 0,
      error: null,
      startedAt: Date.now(),
    });
  } catch (error) {
    cartPlacementRunning = false;
    return { success: false, error: String(error?.message || error) };
  }
  runCartPlacement(job)
    .catch((error) => failCartPlacement(job, error))
    .finally(() => {
      cartPlacementRunning = false;
    });
  return { success: true, started: true };
}

async function cancelCartPlacement(orderId) {
  const current = await getCartPlacementProgress();
  if (!current?.running || (orderId && current.orderId !== orderId)) {
    return { success: true, running: false };
  }
  cartPlacementCancelRequested = true;
  await patchCartPlacementProgress({ phase: 'canceling' });
  return { success: true, canceling: true };
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  let data = null;
  try {
    data = await response.json();
  } catch (e) {
    throw new Error(`VenDrop returned ${response.status} instead of JSON`);
  }
  if (!response.ok || data?.success === false) {
    const error = new Error(data?.error || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function runCartPlacement(job) {
  const authorization = { Authorization: `Bearer ${job.extensionToken}` };
  const cartData = await fetchJson(
    `${job.apiBaseUrl}/api/orders/next-cart?orderId=${encodeURIComponent(job.orderId)}`,
    { headers: authorization }
  );
  if (!cartData.order) throw new Error('This order is no longer awaiting cart placement');

  const items = cartData.order.items || [];
  if (!items.length) throw new Error('The order has no items');
  for (const item of items) {
    let vendorHostname = '';
    try {
      vendorHostname = new URL(item.vendorLink).hostname.toLowerCase();
    } catch (e) {
      // Handled by the validation below.
    }
    const isSamsClub = vendorHostname === 'samsclub.com' || vendorHostname.endsWith('.samsclub.com');
    if (item.vendor !== 'samsclub' || !isSamsClub) {
      throw new Error(`${item.name || 'An item'} does not have a Sam's Club product link`);
    }
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 50) {
      throw new Error(`${item.name || 'An item'} has an unsupported case quantity`);
    }
  }

  await patchCartPlacementProgress({ phase: 'opening-cart-to-clear', total: items.length });
  const tab = await chrome.tabs.create({ url: 'about:blank', active: true });
  await patchCartPlacementProgress({ workTabId: tab.id });

  await navigateCartTab(tab.id, 'https://www.samsclub.com/cart');
  await patchCartPlacementProgress({
    phase: 'clearing-cart',
    currentName: '',
    currentQuantity: null,
  });
  await showPopup();
  await sleep(400);
  const clearResult = await clearSamsCartInTab(tab.id);
  await patchCartPlacementProgress({
    phase: 'cart-cleared',
    removedCartItems: Number(clearResult?.removedLineItems || 0),
  });
  await showPopup();
  await sleep(500);
  await patchCartPlacementProgress({ phase: 'adding-items' });

  for (let index = 0; index < items.length; index++) {
    if (cartPlacementCancelRequested) throw new Error('Cart placement was canceled');
    const item = items[index];
    await patchCartPlacementProgress({
      phase: 'opening-product',
      currentName: item.name,
      currentIndex: index,
      currentQuantity: item.quantity,
    });
    await navigateCartTab(tab.id, item.vendorLink);
    await patchCartPlacementProgress({ phase: 'adding-current-item', currentQuantity: 1 });
    await showPopup();
    await sleep(400); // make the status visible before the first cart click
    await addProductInTab(tab.id, { ...item, quantity: 1 });
    await patchCartPlacementProgress({ phase: 'item-complete', processed: index + 1 });
    await chrome.action.setBadgeBackgroundColor({ color: '#2563eb' });
    await chrome.action.setBadgeText({ text: `${index + 1}/${items.length}` });
  }

  if (cartPlacementCancelRequested) throw new Error('Cart placement was canceled');
  await patchCartPlacementProgress({
    phase: 'opening-cart-to-update',
    currentName: '',
    currentQuantity: null,
  });
  await navigateCartTab(tab.id, 'https://www.samsclub.com/cart');
  await patchCartPlacementProgress({ phase: 'updating-quantities' });
  await showPopup();
  await sleep(400);
  const quantityResult = await setCartQuantitiesInTab(tab.id, items);
  await patchCartPlacementProgress({
    phase: 'quantities-updated',
    totalCases: Number(quantityResult?.totalCases || 0),
  });
  await showPopup();
  await sleep(500);

  if (cartPlacementCancelRequested) throw new Error('Cart placement was canceled');
  await patchCartPlacementProgress({ phase: 'confirming', currentName: '' });
  try {
    await fetchJson(`${job.apiBaseUrl}/api/orders/${encodeURIComponent(job.orderId)}/confirm-placed`, {
      method: 'POST',
      headers: authorization,
    });
  } catch (error) {
    // A service-worker retry can reach an order that its prior run already
    // confirmed. The endpoint reports that idempotent case as 409.
    if (error.status !== 409) throw error;
  }

  await chrome.tabs.update(tab.id, { active: true });
  await patchCartPlacementProgress({
    running: false,
    done: true,
    phase: 'complete',
    currentName: '',
    extensionToken: null,
    finishedAt: Date.now(),
  });
  await chrome.action.setBadgeBackgroundColor({ color: '#16a34a' });
  await chrome.action.setBadgeText({ text: '✓' });
  await showPopup();
}

async function failCartPlacement(job, error) {
  const message = String(error?.message || error || 'Cart placement failed');
  console.error('[VenDrop] Cart placement failed:', message);
  try {
    await fetch(`${job.apiBaseUrl}/api/orders/${encodeURIComponent(job.orderId)}/cancel-placing`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${job.extensionToken}` },
    });
  } catch (cancelError) {
    console.warn('[VenDrop] Could not return order to draft:', cancelError);
  }
  await patchCartPlacementProgress({
    running: false,
    done: true,
    phase: cartPlacementCancelRequested ? 'canceled' : 'failed',
    error: message,
    currentName: '',
    extensionToken: null,
    finishedAt: Date.now(),
  });
  await chrome.action.setBadgeBackgroundColor({ color: '#dc2626' });
  await chrome.action.setBadgeText({ text: '!' });
}

async function navigateCartTab(tabId, url) {
  const loaded = waitForLoad(tabId, 45000);
  await chrome.tabs.update(tabId, { url, active: true });
  await loaded;
  await sleep(1800);
}

function addProductInTab(tabId, item) {
  return new Promise((resolve, reject) => {
    const attempt = (remaining) => {
      chrome.tabs.sendMessage(
        tabId,
        { type: 'ADD_CURRENT_PRODUCT_TO_CART', quantity: item.quantity, expectedName: item.name },
        (response) => {
          if (chrome.runtime.lastError || !response) {
            if (remaining > 1) return setTimeout(() => attempt(remaining - 1), 1000);
            return reject(new Error(chrome.runtime.lastError?.message || 'Sam\'s Club page did not respond'));
          }
          if (!response.success) return reject(new Error(response.error || `Could not add ${item.name}`));
          resolve(response);
        }
      );
    };
    attempt(3);
  });
}

function clearSamsCartInTab(tabId) {
  return new Promise((resolve, reject) => {
    const attempt = (remaining) => {
      chrome.tabs.sendMessage(tabId, { type: 'CLEAR_SAMS_CART' }, (response) => {
        if (chrome.runtime.lastError || !response) {
          if (remaining > 1) return setTimeout(() => attempt(remaining - 1), 1000);
          return reject(new Error(chrome.runtime.lastError?.message || 'Sam\'s Club cart did not respond'));
        }
        if (!response.success) return reject(new Error(response.error || 'Could not clear the Sam\'s Club cart'));
        resolve(response);
      });
    };
    attempt(3);
  });
}

function setCartQuantitiesInTab(tabId, items) {
  return new Promise((resolve, reject) => {
    // Do not replay this message: a lost response could happen after some plus
    // buttons were already clicked. The next explicit run starts by clearing the
    // cart, which is safer than risking duplicate quantity increments here.
    chrome.tabs.sendMessage(tabId, { type: 'SET_SAMS_CART_QUANTITIES', items }, (response) => {
      if (chrome.runtime.lastError || !response) {
        return reject(new Error(chrome.runtime.lastError?.message || 'Sam\'s Club cart did not respond'));
      }
      if (!response.success) return reject(new Error(response.error || 'Could not set the Sam\'s Club cart quantities'));
      resolve(response);
    });
  });
}

// Only one job's results should be on screen at a time — a leftover "Import complete"
// panel sitting above a fresh "Refresh complete" one is just two summaries to
// disentangle. Clear the other job's finished state before starting.
async function clearFinishedJob(key, getFn) {
  const other = await getFn();
  if (other && !other.running) await chrome.storage.local.remove(key);
}

async function startCatalogUpdate(locationIds = []) {
  if (updateRunning) return;
  updateRunning = true;
  cancelRequested = false;
  try {
    await clearFinishedJob('selectedImport', getImportProgress);
    await runCatalogUpdate(locationIds);
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

async function fetchRefreshLocations(settings) {
  if (!settings.catalogToken) return [];
  const res = await fetch(`${settings.apiUrl}/api/catalog/locations`, {
    headers: { 'Authorization': `Bearer ${settings.catalogToken}` },
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(res.status === 401 ? 'Unauthorized — check your token' : (data.error || `Location list failed (${res.status})`));
  }
  return data.data || [];
}

async function fetchCatalogForLocation(settings, vendorLocationId) {
  const query = vendorLocationId ? `?vendorLocationId=${encodeURIComponent(vendorLocationId)}` : '';
  const res = await fetch(`${settings.apiUrl}/api/catalog${query}`, {
    headers: { 'Authorization': `Bearer ${settings.catalogToken}` },
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(res.status === 401 ? 'Unauthorized — check your token' : (data.error || `List failed (${res.status})`));
  }
  return data.data || [];
}

function stableSentinelScore(item) {
  const seed = String(item.id || item.vendorSku || item.name || '');
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  // Sales and previously location-specific values are the most informative. The
  // deterministic hash keeps a rotating-looking sample without always taking the
  // first products returned by the API.
  const tier = (item.vendorOnSale ? 2 : 0) + (item.vendorOffer ? 1 : 0);
  return tier * 0x100000000 + (hash >>> 0);
}

function orderWithSentinelsFirst(targets, count = 10) {
  const sentinels = [...targets]
    .sort((a, b) => stableSentinelScore(b) - stableSentinelScore(a))
    .slice(0, Math.min(count, targets.length));
  const sentinelIds = new Set(sentinels.map((item) => item.id));
  return [...sentinels, ...targets.filter((item) => !sentinelIds.has(item.id))];
}

function offerSignature(product) {
  if (!product) return null;
  const cents = (value) => value == null || !isFinite(Number(value)) ? null : Math.round(Number(value) * 100);
  return JSON.stringify({
    caseCost: cents(product.caseCost),
    regularCaseCost: cents(product.vendorRegularCaseCost),
    discountAmount: cents(product.vendorDiscountAmount),
    saleEndsOn: product.vendorSaleEndsOn || null,
    availability: product.vendorAvailability || 'unknown',
    onSale: product.vendorOnSale === true,
    shipping: product.vendorShippingEligible ?? null,
    pickup: product.vendorPickupEligible ?? null,
    delivery: product.vendorDeliveryEligible ?? null,
  });
}

function canInferFromCurrentPrimary(products, primarySignatures) {
  return products.every((product) => primarySignatures.has(product.id));
}

function resolveRefreshCaseCost(scraped, item, vendorContext) {
  const scrapedCaseCost = parseFloat(scraped?.case_cost);
  if (isFinite(scrapedCaseCost) && scrapedCaseCost > 0) return scrapedCaseCost;
  if (!vendorContext) return parseFloat(item.caseCost);
  const expectedVendorLocationId = `vloc-${vendorContext.retailer}-${vendorContext.externalId}`;
  return item.vendorOffer?.vendorLocationId === expectedVendorLocationId
    ? parseFloat(item.caseCost)
    : NaN;
}

function setSamsClubInTab(tabId, location) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { type: 'SET_SAMS_CLUB', location }, (response) => {
      if (chrome.runtime.lastError || !response) {
        reject(new Error(chrome.runtime.lastError?.message || 'The Sam\'s Club page did not respond'));
        return;
      }
      if (!response.success) {
        reject(new Error(response.error || `Could not select ${location.name}`));
        return;
      }
      resolve(response.vendorContext);
    });
  });
}

async function switchWorkTabLocation(tabId, location) {
  await chrome.tabs.update(tabId, {
    url: `https://www.samsclub.com/club/${encodeURIComponent(location.externalId)}`,
    active: true,
  });
  await waitForLoad(tabId);
  await showPopup();
  await sleep(1200);
  const verified = await setSamsClubInTab(tabId, location);
  if (!verified || String(verified.externalId) !== String(location.externalId)) {
    throw new Error(`Sam's Club did not verify ${location.name} #${location.externalId}`);
  }
}

function verifiedScrapeContext(scraped, location) {
  if (!location) return null;
  const detected = scraped?.vendor_context;
  const detectedId = detected?.externalId ? String(detected.externalId) : '';
  if (detectedId && detectedId !== String(location.externalId)) {
    throw new Error(`Expected ${location.name} #${location.externalId}, but the page reported club #${detectedId}`);
  }
  if (!detectedId) {
    const expectedName = String(location.name || '').toLowerCase().replace(/sam['’]?s club/g, '').trim();
    const detectedName = String(detected?.name || '').toLowerCase();
    if (!expectedName || !detectedName.includes(expectedName)) {
      throw new Error(`Could not verify that the product price belongs to ${location.name}`);
    }
  }
  return {
    retailer: location.retailer,
    externalId: String(location.externalId),
    name: location.name,
    address: location.address || null,
    city: location.city || null,
    state: location.state || null,
    postalCode: location.postalCode || null,
    fulfillmentMode: 'pickup',
  };
}

async function inferRemainingOffers(settings, sourceLocationId, targetLocationId, productIds, refreshRunId) {
  const res = await fetch(`${settings.apiUrl}/api/catalog/offers/infer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${settings.catalogToken}` },
    body: JSON.stringify({ sourceLocationId, targetLocationId, productIds, refreshRunId }),
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || `Inference failed (${res.status})`);
  return data;
}

async function runCatalogUpdate(locationIds = []) {
  const settings = await getSettings();
  const refreshRunId = `refresh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  await setProgress({
    running: true, done: false, canceling: false, phase: 'loading',
    total: 0, processed: 0, updated: 0, unchanged: 0, skipped: 0, failed: 0,
    aiUsed: 0, aiReused: 0, aiIncomplete: 0,
    aiCalls: 0, aiInputTokens: 0, aiOutputTokens: 0, aiReasoningTokens: 0,
    aiEstimatedCostUsd: 0, aiDurationMs: 0, aiProviderUsage: {}, aiFailures: [],
    disabledAiProviders: [],
    disabledAiModels: [],
    currentName: '', error: null, errors: [], changes: [], duplicates: [],
    feed: [], startedAt: Date.now(), refreshRunId,
    locationTotal: 0, locationIndex: 0, currentLocation: '', inferred: 0,
    earlyExitedLocations: [],
  });

  if (!settings.catalogToken) {
    await patchProgress({ running: false, done: true, error: 'Missing catalog maintainer token — open Settings' });
    return;
  }

  let allLocations;
  try {
    allLocations = await fetchRefreshLocations(settings);
  } catch (e) {
    await patchProgress({ running: false, done: true, error: `Could not load purchasing clubs: ${e.message}` });
    return;
  }

  const requested = new Set(locationIds || []);
  const selectedLocations = requested.size
    ? allLocations.filter((location) => requested.has(location.id))
    : allLocations;
  if (requested.size && selectedLocations.length !== requested.size) {
    await patchProgress({ running: false, done: true, error: 'One or more selected purchasing clubs are no longer active' });
    return;
  }

  // Backward-compatible one-location/global pass until an organization configures
  // its first purchasing club. No unused geographic location is invented.
  const refreshLocations = selectedLocations.length ? selectedLocations : [null];
  let primaryItems;
  try {
    primaryItems = await fetchCatalogForLocation(settings, refreshLocations[0]?.id || null);
  } catch (e) {
    await patchProgress({ running: false, done: true, error: `Could not load catalog: ${e.message}` });
    return;
  }
  const primaryTargets = primaryItems.filter((item) => isSupportedUrl(item.vendorLink));
  const skippedNoLink = primaryItems.length - primaryTargets.length;
  await patchProgress({
    phase: 'running',
    total: primaryTargets.length * refreshLocations.length,
    skipped: skippedNoLink * refreshLocations.length,
    locationTotal: selectedLocations.length,
  });

  let processedCount = 0;
  const primarySignatures = new Map();

  await withWorkTab(async (tabId) => {
    for (let locationIndex = 0; locationIndex < refreshLocations.length; locationIndex++) {
      if (cancelRequested) break;
      const location = refreshLocations[locationIndex];
      if (location) await switchWorkTabLocation(tabId, location);
      const locationItems = locationIndex === 0
        ? primaryItems
        : await fetchCatalogForLocation(settings, location.id);
      const targets = locationItems.filter((item) => isSupportedUrl(item.vendorLink));
      const orderedTargets = locationIndex === 0 ? targets : orderWithSentinelsFirst(targets, 10);
      const sentinelCount = locationIndex === 0 ? 0 : Math.min(10, orderedTargets.length);
      let sentinelsMatch = locationIndex > 0;
      await patchProgress({
        locationIndex: location ? locationIndex + 1 : 0,
        currentLocation: location ? `${location.name} #${location.externalId}` : 'Legacy global fallback',
      });

      for (let i = 0; i < orderedTargets.length; i++) {
        if (cancelRequested) break;
        const item = orderedTargets[i];
        await patchProgress({ currentName: item.name });

        let result = null;
        let scraped = null;
        try {
          scraped = await navigateAndScrape(tabId, item.vendorLink, showPopup);
          const vendorContext = verifiedScrapeContext(scraped, location);
          result = await refreshProduct(settings, item, scraped, vendorContext, refreshRunId);

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

          if (outcome !== 'failed') {
            await bumpAnalysis(getProgress, patchProgress, result.analysis, item);
          }

          await pushFeed(
            getProgress, patchProgress, scraped, item, outcome,
            result.error, result.changedFields,
            {
              ...(result.product || {}),
              previousCaseCost: result.previousCaseCost,
              analysis: result.analysis || null,
            }
          );

          if (locationIndex === 0 && result.ok) {
            primarySignatures.set(item.id, offerSignature(result.product));
          } else if (locationIndex > 0 && i < sentinelCount) {
            const primarySignature = primarySignatures.get(item.id);
            if (!result.ok || !primarySignature || offerSignature(result.product) !== primarySignature) {
              sentinelsMatch = false;
            }
          }
        } catch (e) {
          if (locationIndex > 0 && i < sentinelCount) sentinelsMatch = false;
          await bump('failed', item, e.message);
          await pushFeed(getProgress, patchProgress, scraped, item, 'failed', e.message);
        }

        processedCount += 1;
        await patchProgress({ processed: processedCount });

        if (locationIndex > 0 && i + 1 === sentinelCount && sentinelsMatch && !cancelRequested) {
          const remaining = orderedTargets.slice(sentinelCount);
          // Only infer products whose primary-club value was successfully observed
          // during this run. One failed primary scrape makes a full secondary pass
          // safer than copying a stale value under fresh provenance.
          const primaryIsCurrent = canInferFromCurrentPrimary(remaining, primarySignatures);
          if (primaryIsCurrent) {
            try {
              const inferred = await inferRemainingOffers(
                settings,
                refreshLocations[0].id,
                location.id,
                remaining.map((product) => product.id),
                refreshRunId
              );
              if (inferred.copied !== remaining.length) {
                throw new Error(`Expected ${remaining.length} inferred offers, received ${inferred.copied}`);
              }
              processedCount += remaining.length;
              const cur = (await getProgress()) || {};
              await patchProgress({
                processed: processedCount,
                inferred: (cur.inferred || 0) + inferred.copied,
                earlyExitedLocations: [
                  ...(cur.earlyExitedLocations || []),
                  { id: location.id, name: location.name, sentinels: sentinelCount, inferred: inferred.copied },
                ],
              });
              break;
            } catch (e) {
              const cur = (await getProgress()) || {};
              const errors = (cur.errors || []).slice(0, 49);
              errors.push({
                name: location.name,
                error: `Early-exit inference was skipped; continuing the full refresh: ${e.message}`,
              });
              await patchProgress({ errors });
            }
          }
        }

        if (!cancelRequested) await sleep(POLITE_DELAY_MS); // don't hammer the retailer
      }
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
async function refreshProduct(settings, item, scraped, vendorContext = null, refreshRunId = null) {
  // Unavailable retailer pages often hide their price or pack size. Keep the last
  // known catalog values in that case so the refresh can still record "unavailable"
  // (and delivery/sale status) instead of failing before it reaches the API.
  const expectedVendorLocationId = vendorContext
    ? `vloc-${vendorContext.retailer}-${vendorContext.externalId}`
    : null;
  // A missing price may reuse a prior exact offer (for example, an unavailable
  // product page), but a global fallback must never be promoted to an observed
  // price for a brand-new club.
  const caseCost = resolveRefreshCaseCost(scraped, item, vendorContext);
  const caseSize = parseInt(scraped?.case_size || item.caseSize);

  if (!isFinite(caseCost) || caseCost <= 0) {
    return {
      ok: false,
      error: vendorContext
        ? `Could not read an exact price for ${vendorContext.name}`
        : 'Could not read a price from the page',
      changedFields: [],
    };
  }
  if (!isFinite(caseSize) || caseSize <= 0) {
    return { ok: false, error: 'Could not read a case size from the page', changedFields: [] };
  }

  const progress = (await getProgress()) || {};
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
      vendorAvailability: scraped.vendor_availability || 'unknown',
      vendorOnSale: scraped.vendor_on_sale === true,
      vendorDiscountAmount: scraped.vendor_discount_amount,
      vendorRegularCaseCost: scraped.vendor_regular_case_cost,
      vendorSaleEndsOn: scraped.vendor_sale_ends_on,
      vendorShippingEligible: scraped.vendor_shipping_eligible,
      vendorPickupEligible: scraped.vendor_pickup_eligible,
      vendorDeliveryEligible: scraped.vendor_delivery_eligible,
      vendorStatusEvidence: scraped.vendor_status_evidence || null,
      vendorContext,
      expectedVendorLocationId,
      refreshRunId,
      skipAiProviders: progress.disabledAiProviders || [],
      skipAiModels: progress.disabledAiModels || [],
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
    analysis: data.analysis || null,
  };
}

// Keep a per-item record of what actually moved, so the summary can say
// "price, image" instead of an opaque "3 updated".
async function recordChange(item, result) {
  const p = result.product || {};
  const cur = (await getProgress()) || {};
  const changes = (cur.changes || []).slice(0, 99);
  changes.push({
    standardProductId: p.id || item.id || null,
    name: p.name || item.name,
    fields: result.changedFields,
    previousCaseCost: result.previousCaseCost ?? null,
    caseCost: p.caseCost ?? null,
    recommendedPrice: p.recommendedPrice ?? null,
    assortmentStatus: p.assortmentStatus || null,
    components: p.components || [],
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
      aiUsed: 0, aiReused: 0, aiIncomplete: 0,
      aiCalls: 0, aiInputTokens: 0, aiOutputTokens: 0, aiReasoningTokens: 0,
      aiEstimatedCostUsd: 0, aiDurationMs: 0, aiProviderUsage: {}, aiFailures: [],
      disabledAiProviders: [],
      disabledAiModels: [],
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
          await bumpAnalysis(getImportProgress, patchImportProgress, result.analysis, item);
          await recordResult(kind, result, item);
          await pushFeed(
            getImportProgress,
            patchImportProgress,
            scraped,
            item,
            kind,
            null,
            result.changedFields,
            { ...(result.product || {}), analysis: result.analysis || null }
          );
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
    vendorAvailability: s.vendor_availability || 'unknown',
    vendorOnSale: s.vendor_on_sale === true,
    vendorDiscountAmount: s.vendor_discount_amount,
    vendorRegularCaseCost: s.vendor_regular_case_cost,
    vendorSaleEndsOn: s.vendor_sale_ends_on,
    vendorShippingEligible: s.vendor_shipping_eligible,
    vendorPickupEligible: s.vendor_pickup_eligible,
    vendorDeliveryEligible: s.vendor_delivery_eligible,
    vendorStatusEvidence: s.vendor_status_evidence || null,
    previousCaseCost: p.previousCaseCost ?? null,
    standardProductId: p.id || item.id || null,
    recommendedPrice: p.recommendedPrice ?? null,
    assortmentStatus: p.assortmentStatus || null,
    components: p.components || [],
    analysis: p.analysis || null,
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
    standardProductId: p.id || null,
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
    assortmentStatus: p.assortmentStatus || null,
    components: p.components || [],
    analysis: result.analysis || null,
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

  const progress = (await getImportProgress()) || {};
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
      description: scraped.description || null,
      vendorAvailability: scraped.vendor_availability || 'unknown',
      vendorOnSale: scraped.vendor_on_sale === true,
      vendorDiscountAmount: scraped.vendor_discount_amount,
      vendorRegularCaseCost: scraped.vendor_regular_case_cost,
      vendorSaleEndsOn: scraped.vendor_sale_ends_on,
      vendorShippingEligible: scraped.vendor_shipping_eligible,
      vendorPickupEligible: scraped.vendor_pickup_eligible,
      vendorDeliveryEligible: scraped.vendor_delivery_eligible,
      vendorStatusEvidence: scraped.vendor_status_evidence || null,
      vendorContext: scraped.vendor_context || null,
      expectedVendorLocationId: scraped.vendor_context?.externalId
        ? `vloc-${scraped.vendor_context.retailer}-${scraped.vendor_context.externalId}`
        : null,
      skipAiProviders: progress.disabledAiProviders || [],
      skipAiModels: progress.disabledAiModels || [],
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
    changedFields: data.changedFields || [],
    analysis: data.analysis || null,
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
  const cart = await getCartPlacementProgress();
  if (cart && cart.running && !cartPlacementRunning) {
    // Never silently replay cart clicks after Chrome kills a service worker;
    // doing so could duplicate cases already added. Return the order to draft
    // and leave the partial cart visible for explicit user review.
    try {
      if (cart.extensionToken && cart.apiBaseUrl && cart.orderId) {
        await fetch(`${cart.apiBaseUrl}/api/orders/${encodeURIComponent(cart.orderId)}/cancel-placing`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${cart.extensionToken}` },
        });
      }
    } catch (e) {
      console.warn('[VenDrop] Could not cancel interrupted cart placement:', e);
    }
    await patchCartPlacementProgress({
      running: false,
      done: true,
      interrupted: true,
      phase: 'failed',
      error: 'Chrome interrupted cart placement. Review the partial Sam\'s Club cart before trying again.',
      currentName: '',
      extensionToken: null,
      finishedAt: Date.now(),
    });
    await chrome.action.setBadgeBackgroundColor({ color: '#dc2626' });
    await chrome.action.setBadgeText({ text: '!' });
  }
  const history = await getPurchaseHistoryProgress();
  if (history?.running && !purchaseHistorySyncRunning) {
    await patchPurchaseHistoryProgress({
      running: false,
      done: true,
      phase: 'failed',
      message: 'Chrome interrupted purchase-history sync. Return to setup and try again.',
      error: 'Chrome interrupted purchase-history sync. Return to setup and try again.',
      finishedAt: Date.now(),
    }, history.originTabId);
  }
})();

console.log('[VenDrop] Background service worker ready');
