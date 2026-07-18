// Bridges the authenticated VenDrop Orders page to the extension service
// worker. The page emits a short-lived token scoped to one order; no permanent
// organization credential is exposed to or stored by this content script.

const ORDER_SIGNAL_ID = 'vendorpro-place-order-signal';
let lastSignalKey = '';

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

window.addEventListener('vendorpro:place-order', (event) => startPlacement(event.detail));
window.addEventListener('vendorpro:cancel-order', (event) => {
  const orderId = String(event.detail?.orderId || '');
  if (orderId) chrome.runtime.sendMessage({ type: 'CANCEL_CART_PLACEMENT', orderId });
});

const observer = new MutationObserver(() => startPlacement(placementFromNode()));
observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
startPlacement(placementFromNode());
