// Bridges the authenticated VenDrop Orders page to the extension service
// worker. The page emits a short-lived token scoped to one order; no permanent
// organization credential is exposed to or stored by this content script.

const ORDER_SIGNAL_ID = 'vendorpro-place-order-signal';
let lastSignalKey = '';
let lastHistorySyncKey = '';

function normalizePlacement(detail) {
  if (!detail || typeof detail !== 'object') return null;
  const orderId = String(detail.orderId || '');
  const extensionToken = String(detail.extensionToken || '');
  const apiBaseUrl = String(detail.apiBaseUrl || window.location.origin);
  const placedAt = String(detail.placedAt || '');
  if (!orderId || !extensionToken || !placedAt) return null;
  return { orderId, extensionToken, apiBaseUrl, placedAt };
}

function placementFromNode() {
  const node = document.getElementById(ORDER_SIGNAL_ID);
  if (!node) return null;
  return normalizePlacement({
    orderId: node.dataset.orderId,
    extensionToken: node.dataset.extensionToken,
    apiBaseUrl: node.dataset.apiBaseUrl,
    placedAt: node.dataset.placedAt,
  });
}

function startPlacement(detail) {
  const payload = normalizePlacement(detail);
  if (!payload) return;
  const key = `${payload.orderId}:${payload.placedAt}`;
  if (key === lastSignalKey) return;

  chrome.runtime.sendMessage({ type: 'START_CART_PLACEMENT', payload }, (response) => {
    if (chrome.runtime.lastError || !response?.success) {
      const error = chrome.runtime.lastError?.message || response?.error || 'Extension did not start the cart job';
      console.warn('[VenDrop] Could not start cart placement:', error);
      window.dispatchEvent(new CustomEvent('vendorpro:placement-error', {
        detail: { orderId: payload.orderId, error },
      }));
      return;
    }
    lastSignalKey = key;
    window.dispatchEvent(new CustomEvent('vendorpro:placement-ack', {
      detail: {
        orderId: payload.orderId,
        version: chrome.runtime.getManifest().version,
        alreadyRunning: Boolean(response.alreadyRunning),
      },
    }));
  });
}

function normalizeHistorySync(detail) {
  if (!detail || typeof detail !== 'object') return null;
  const syncId = String(detail.syncId || '');
  const extensionToken = String(detail.extensionToken || '');
  const apiBaseUrl = String(detail.apiBaseUrl || window.location.origin);
  const requestedAt = String(detail.requestedAt || '');
  const historyUrl = String(detail.historyUrl || 'https://www.samsclub.com/orders');
  if (!syncId || !extensionToken || !requestedAt) return null;
  return { syncId, extensionToken, apiBaseUrl, requestedAt, historyUrl };
}

function startHistorySync(detail) {
  const payload = normalizeHistorySync(detail);
  if (!payload) return;
  const key = `${payload.syncId}:${payload.requestedAt}`;
  if (key === lastHistorySyncKey) return;

  chrome.runtime.sendMessage({ type: 'START_PURCHASE_HISTORY_SYNC', payload }, (response) => {
    if (chrome.runtime.lastError || !response?.success) {
      const error = chrome.runtime.lastError?.message || response?.error || 'Extension did not start purchase-history sync';
      window.dispatchEvent(new CustomEvent('vendorpro:purchase-history-error', {
        detail: { syncId: payload.syncId, error },
      }));
      return;
    }
    lastHistorySyncKey = key;
    window.dispatchEvent(new CustomEvent('vendorpro:purchase-history-ack', {
      detail: { syncId: payload.syncId, version: chrome.runtime.getManifest().version },
    }));
  });
}

function publishHistoryProgress(progress, expectedSyncId) {
  if (!progress || (expectedSyncId && progress.syncId !== expectedSyncId)) return;
  if (progress.done && progress.phase === 'complete') {
    window.dispatchEvent(new CustomEvent('vendorpro:purchase-history-complete', { detail: progress }));
    return;
  }
  if (progress.done && progress.phase === 'failed') {
    window.dispatchEvent(new CustomEvent('vendorpro:purchase-history-error', { detail: progress }));
    return;
  }
  window.dispatchEvent(new CustomEvent('vendorpro:purchase-history-progress', { detail: progress }));
}

function requestHistoryProgress(detail) {
  const syncId = String(detail?.syncId || '');
  if (!syncId) return;
  chrome.runtime.sendMessage({ type: 'GET_PURCHASE_HISTORY_PROGRESS' }, (response) => {
    if (!chrome.runtime.lastError) publishHistoryProgress(response?.progress, syncId);
  });
}

window.addEventListener('vendorpro:place-order', (event) => startPlacement(event.detail));
window.addEventListener('vendorpro:sync-purchase-history', (event) => startHistorySync(event.detail));
window.addEventListener('vendorpro:get-purchase-history-progress', (event) => requestHistoryProgress(event.detail));
window.addEventListener('vendorpro:cancel-order', (event) => {
  const orderId = String(event.detail?.orderId || '');
  if (orderId) chrome.runtime.sendMessage({ type: 'CANCEL_CART_PLACEMENT', orderId });
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'PURCHASE_HISTORY_SYNC_PROGRESS') {
    publishHistoryProgress(message.detail);
  }
  if (message.type === 'PURCHASE_HISTORY_SYNC_COMPLETE') {
    window.dispatchEvent(new CustomEvent('vendorpro:purchase-history-complete', {
      detail: message.detail || {},
    }));
  }
  if (message.type === 'PURCHASE_HISTORY_SYNC_ERROR') {
    window.dispatchEvent(new CustomEvent('vendorpro:purchase-history-error', {
      detail: message.detail || {},
    }));
  }
});

const observer = new MutationObserver(() => startPlacement(placementFromNode()));
observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
startPlacement(placementFromNode());
