// Content script for detecting and extracting product information
// Runs on Sam's Club and Costco product pages

console.log('[VenDrop] Content script loaded');

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'GET_PRODUCT_INFO') {
    const productInfo = extractProductInfo();
    sendResponse({ success: true, productInfo });
    return false;
  }
  if (request.type === 'GET_VENDOR_LOCATION') {
    sendResponse({ success: true, vendorContext: extractSamsClubLocationContext() });
    return false;
  }
  if (request.type === 'SET_SAMS_CLUB') {
    setCurrentSamsClub(request.location)
      .then((vendorContext) => sendResponse({ success: true, vendorContext }))
      .catch((error) => sendResponse({ success: false, error: String(error?.message || error) }));
    return true;
  }
  if (request.type === 'ADD_CURRENT_PRODUCT_TO_CART') {
    addCurrentSamsProductToCart(request.quantity)
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: String(error?.message || error) }));
    return true;
  }
  if (request.type === 'CLEAR_SAMS_CART') {
    clearCurrentSamsCart()
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: String(error?.message || error) }));
    return true;
  }
  if (request.type === 'SET_SAMS_CART_QUANTITIES') {
    setCurrentSamsCartQuantities(request.items)
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: String(error?.message || error) }));
    return true;
  }
  if (request.type === 'SCRAPE_SAMS_PURCHASE_HISTORY') {
    scrapeSamsPurchaseHistory()
      .then((items) => sendResponse({ success: true, items }))
      .catch((error) => sendResponse({ success: false, error: String(error?.message || error) }));
    return true;
  }
  return false;
});

function isVisible(element) {
  if (!element) return false;
  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
}

function buttonLabel(button) {
  return [button.getAttribute('aria-label'), button.getAttribute('title'), button.textContent]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractSamsClubLocationContext() {
  if (!window.location.hostname.endsWith('samsclub.com')) return null;

  const clubPage = window.location.pathname.match(/^\/club\/(\d{3,8})(?:-|\/|$)/);
  let externalId = clubPage ? clubPage[1] : null;
  let name = null;

  const headings = Array.from(document.querySelectorAll('h1, h2'));
  const clubHeading = headings.find((element) => /Sam['’]?s Club\s*#?\d*/i.test(element.textContent || ''));
  if (clubHeading) {
    const text = (clubHeading.textContent || '').replace(/\s+/g, ' ').trim();
    const idMatch = text.match(/#(\d{3,8})/);
    externalId = externalId || idMatch?.[1] || null;
    name = text.replace(/\s*#\d{3,8}.*$/, '').trim();
  }

  if (!name) {
    const controls = Array.from(document.querySelectorAll('button, [role="button"], a'));
    const selectedClub = controls.find((element) => {
      if (!isVisible(element)) return false;
      const label = buttonLabel(element);
      return /Sam['’]?s Club/i.test(label) &&
        !/homepage|find another|nearby|make this my club/i.test(label);
    });
    if (selectedClub) {
      const label = buttonLabel(selectedClub);
      const match = label.match(/([^|,]*?Sam['’]?s Club)(?:\s*#(\d{3,8}))?/i);
      if (match) {
        name = match[1].replace(/\s+/g, ' ').trim();
        externalId = externalId || match[2] || null;
      }
    }
  }

  if (!externalId) {
    const scripts = Array.from(document.scripts).slice(0, 80);
    for (const script of scripts) {
      const text = script.textContent || '';
      const match = text.match(/"(?:selectedClubId|preferredClubId|clubId|clubNumber)"\s*:\s*"?(\d{3,8})"?/i);
      if (match) {
        externalId = match[1];
        break;
      }
    }
  }

  if (!externalId && !name) return null;
  return {
    retailer: 'samsclub',
    externalId,
    name: name || `Sam's Club #${externalId}`,
    fulfillmentMode: 'pickup',
  };
}

async function setCurrentSamsClub(location) {
  if (!window.location.hostname.endsWith('samsclub.com')) {
    throw new Error('Open a Sam\'s Club page before selecting a club');
  }
  const expectedId = String(location?.externalId || '');
  const pageClub = window.location.pathname.match(/^\/club\/(\d{3,8})(?:-|\/|$)/)?.[1];
  if (!expectedId || pageClub !== expectedId) {
    throw new Error('The club page does not match the requested purchasing location');
  }

  const makeClubButtons = Array.from(document.querySelectorAll('button')).filter((button) =>
    isVisible(button) && /make this my club/i.test(buttonLabel(button))
  );
  if (makeClubButtons.length > 1) throw new Error('More than one club-selection control was found');
  if (makeClubButtons.length === 1) {
    makeClubButtons[0].click();
    const deadline = Date.now() + 10000;
    let selectionConfirmed = false;
    while (Date.now() < deadline) {
      const stillVisible = isVisible(makeClubButtons[0]) &&
        /make this my club/i.test(buttonLabel(makeClubButtons[0]));
      if (!stillVisible) {
        selectionConfirmed = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!selectionConfirmed) throw new Error('Sam\'s Club did not save the requested club');
  }

  const context = extractSamsClubLocationContext();
  if (!context || context.externalId !== expectedId) {
    throw new Error('Sam\'s Club did not confirm the requested club');
  }
  return { ...location, ...context, externalId: expectedId, fulfillmentMode: 'pickup' };
}

function cartItemCount() {
  const candidates = Array.from(document.querySelectorAll('h1, h2, button[aria-label], [aria-label*="cart" i]'));
  for (const element of candidates) {
    const label = buttonLabel(element);
    const patterns = [
      /\bcart\s*\((\d+)\s+items?\)/i,
      /\bcart contains\s+(\d+)\s+items?\b/i,
    ];
    for (const pattern of patterns) {
      const match = label.match(pattern);
      if (match) return Number(match[1]);
    }
  }
  return null;
}

function findCartRemoveControls(root = document) {
  return Array.from(root.querySelectorAll('button, a')).filter((control) => {
    const labels = [control.getAttribute('aria-label'), control.getAttribute('title'), control.textContent]
      .filter(Boolean)
      .map((label) => String(label).replace(/\s+/g, ' ').trim());
    return labels.some((label) => /^remove$/i.test(label)) && isVisible(control) && !control.disabled;
  });
}

function findRemoveConfirmation() {
  const dialogs = Array.from(document.querySelectorAll('[role="dialog"], dialog'))
    .filter((dialog) => isVisible(dialog));
  for (const dialog of dialogs) {
    const controls = findCartRemoveControls(dialog);
    if (controls.length === 1) return controls[0];
  }
  return null;
}

function cartLooksEmpty() {
  const count = cartItemCount();
  if (count === 0) return true;
  const cartRegion = document.querySelector('main, [role="main"], [aria-label="Cart" i]') || document.body;
  const text = (cartRegion?.innerText || cartRegion?.textContent || '').replace(/\s+/g, ' ');
  return /\bcart\s*\(0\s+items?\)|\byour cart is empty\b|\ba full cart is a happy cart\b/i.test(text);
}

async function waitForCartState(timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const controls = findCartRemoveControls();
    if (controls.length || cartLooksEmpty()) return controls;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return findCartRemoveControls();
}

async function waitForRemoval(clickedControl, previousCount, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let confirmationClicked = false;
  while (Date.now() < deadline) {
    if (!confirmationClicked) {
      const confirmation = findRemoveConfirmation();
      if (confirmation && confirmation !== clickedControl) {
        confirmation.click();
        confirmationClicked = true;
      }
    }

    const confirmation = findRemoveConfirmation();
    const remaining = findCartRemoveControls().filter((control) => control !== confirmation);
    if (!clickedControl.isConnected || remaining.length < previousCount || cartLooksEmpty()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Sam\'s Club did not remove an existing cart item');
}

async function waitForVerifiedEmpty(timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // Saved-for-later rows can have their own Remove controls. A verified zero
    // active-cart count is authoritative and must not delete those saved items.
    if (cartLooksEmpty()) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

async function clearCurrentSamsCart() {
  if (!window.location.hostname.endsWith('samsclub.com') || !window.location.pathname.startsWith('/cart')) {
    throw new Error('Open the Sam\'s Club cart before clearing it');
  }

  await waitForCartState();
  let removedLineItems = 0;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (cartLooksEmpty()) break;
    const controls = findCartRemoveControls();
    if (!controls.length) {
      // Sam's Club re-renders each fulfillment group asynchronously. Check a
      // second time before declaring the cart empty.
      await new Promise((resolve) => setTimeout(resolve, 700));
      const settledControls = findCartRemoveControls();
      if (!settledControls.length) break;
    }

    const currentControls = findCartRemoveControls();
    const control = currentControls[0];
    if (!control) break;
    const previousCount = currentControls.length;
    control.click();
    await waitForRemoval(control, previousCount);
    removedLineItems += 1;
  }

  if (!await waitForVerifiedEmpty()) {
    throw new Error('Could not verify that the Sam\'s Club cart is empty');
  }

  return { removedLineItems };
}

function normalizeProductName(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function samsProductId(value) {
  const text = String(value || '');
  const pathMatch = text.match(/\/(?:p|ip)\/[^/?#]+\/(\d{6,})/i);
  if (pathMatch) return pathMatch[1];
  let decoded = text;
  try {
    decoded = decodeURIComponent(text);
  } catch (error) {
    // A malformed tracking URL should still fall back to name matching.
  }
  const decodedMatch = decoded.match(/\/(?:p|ip)\/[^/?#]+\/(\d{6,})/i);
  return decodedMatch ? decodedMatch[1] : null;
}

function parsedHistoryDate(text) {
  const patterns = [
    /(?:order(?:ed)?|purchase(?:d)?|date)\s*(?:on|:)?\s*((?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+\d{4})/i,
    /(?:order(?:ed)?|purchase(?:d)?|date)\s*(?:on|:)?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
    /((?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+\d{4})/i,
    /(\d{1,2}\/\d{1,2}\/\d{4})/,
  ];
  for (const pattern of patterns) {
    const match = String(text || '').match(pattern);
    if (!match) continue;
    const date = new Date(match[1]);
    if (Number.isFinite(date.getTime())) return date;
  }
  return null;
}

function historyOrderContainer(anchor) {
  let node = anchor;
  for (let depth = 0; node && node !== document.body && depth < 10; depth += 1) {
    const text = (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
    if (text.length < 12000 && parsedHistoryDate(text) && /\b(order|purchase|receipt)\b/i.test(text)) {
      return node;
    }
    node = node.parentElement;
  }
  return anchor.parentElement;
}

async function revealPurchaseHistory() {
  for (let pass = 0; pass < 8; pass += 1) {
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
    await new Promise((resolve) => setTimeout(resolve, 700));
    const more = Array.from(document.querySelectorAll('button, a')).find((element) => {
      const label = buttonLabel(element);
      return isVisible(element) && /^(load|show|view) more(?: orders| purchases)?$/i.test(label);
    });
    if (!more) break;
    more.click();
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
  window.scrollTo({ top: 0, behavior: 'instant' });
}

async function scrapeSamsPurchaseHistory() {
  if (!window.location.hostname.endsWith('samsclub.com') || !window.location.pathname.startsWith('/orders')) {
    throw new Error('Open Sam\'s Club purchase history before syncing');
  }
  const pageText = (document.body.innerText || '').replace(/\s+/g, ' ');
  if (/\bsign in\b/i.test(pageText) && !/\b(order|purchase) history\b/i.test(pageText)) {
    throw new Error('Sign in to Sam\'s Club in the opened tab, then return to VendorPro and try again');
  }

  await revealPurchaseHistory();
  const main = document.querySelector('main, [role="main"]') || document.body;
  const anchors = Array.from(main.querySelectorAll('a[href]'));
  const items = [];
  const seen = new Set();
  for (const anchor of anchors) {
    const productUrl = resolveProductUrl(anchor);
    const vendorSku = productIdFromUrl(productUrl);
    if (!productUrl || !vendorSku) continue;

    const container = historyOrderContainer(anchor);
    const containerText = (container?.innerText || container?.textContent || '').replace(/\s+/g, ' ').trim();
    const purchasedAt = parsedHistoryDate(containerText);
    if (!purchasedAt) continue;
    const ageDays = (Date.now() - purchasedAt.getTime()) / 86400000;
    if (ageDays < -7 || ageDays > 366) continue;

    const orderMatch = containerText.match(/(?:order|receipt)\s*(?:#|number|no\.?|id)?\s*[:#]?\s*([A-Z0-9-]{5,})/i);
    const quantityMatch = containerText.match(/\b(?:qty|quantity)\s*[:x]?\s*(\d{1,3})\b/i);
    const heading = container?.querySelector('[data-automation-id*="title" i], [data-testid*="title" i], h2, h3, h4');
    const productName = (anchor.getAttribute('aria-label') || anchor.textContent || heading?.textContent || nameFromUrl(productUrl) || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!productName) continue;

    const externalOrderId = orderMatch?.[1] || purchasedAt.toISOString().slice(0, 10);
    const baseLineId = `${externalOrderId}:${vendorSku}`;
    let externalLineId = baseLineId;
    let duplicate = 2;
    while (seen.has(externalLineId)) externalLineId = `${baseLineId}:${duplicate++}`;
    seen.add(externalLineId);
    items.push({
      externalLineId,
      externalOrderId,
      vendorSku,
      productName,
      productUrl,
      quantity: Math.max(1, Math.min(100, Number(quantityMatch?.[1] || 1))),
      purchasedAt: purchasedAt.toISOString(),
    });
  }
  return items.slice(0, 600);
}

function findIncreaseQuantityButton(root = document) {
  const selectors = [
    'button[data-automation-id="increase-quantity"]',
    'button[data-automation-id="increment-quantity"]',
    'button[data-testid="increase-quantity"]',
    'button[aria-label*="Increase quantity" i]',
    'button[aria-label*="Increment" i]',
    'button[aria-label*="Add one" i]',
  ];
  for (const selector of selectors) {
    const button = root.querySelector(selector);
    if (button && isVisible(button) && !button.disabled) return button;
  }

  return Array.from(root.querySelectorAll('button')).find((button) => {
    const labels = [button.getAttribute('aria-label'), button.getAttribute('title'), button.textContent]
      .filter(Boolean)
      .map((label) => String(label).replace(/\s+/g, ' ').trim());
    return isVisible(button) && !button.disabled && labels.some((label) => (
      /\b(increase|increment|add one|quantity plus)\b/i.test(label) || /^\+$/.test(label)
    ));
  }) || null;
}

function findCartRowForItem(item) {
  const expectedId = samsProductId(item?.vendorLink);
  const expectedName = normalizeProductName(item?.name);
  const links = Array.from(document.querySelectorAll('a[href]'));
  const linkCandidates = links.filter((link) => {
    const href = link.getAttribute('href') || link.href || '';
    if (expectedId && samsProductId(href) === expectedId) return true;
    const linkName = normalizeProductName(link.textContent || link.getAttribute('aria-label'));
    return expectedName && linkName && (
      linkName === expectedName || linkName.includes(expectedName) || expectedName.includes(linkName)
    );
  });
  const titleCandidates = Array.from(document.querySelectorAll(
    '[data-automation-id*="product-title" i], [data-testid*="product-title" i], h3, h4'
  )).filter((element) => {
    const title = normalizeProductName(element.textContent || element.getAttribute('aria-label'));
    return expectedName && title && (
      title === expectedName || title.includes(expectedName) || expectedName.includes(title)
    );
  });
  const candidates = [...linkCandidates, ...titleCandidates];

  for (const candidate of candidates) {
    let row = candidate;
    while (row && row !== document.body) {
      if (findIncreaseQuantityButton(row)) return row;
      row = row.parentElement;
    }
  }
  return null;
}

async function waitForCartItemCount(expected, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cartItemCount() === expected) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

async function setCurrentSamsCartQuantities(items) {
  if (!window.location.hostname.endsWith('samsclub.com') || !window.location.pathname.startsWith('/cart')) {
    throw new Error('Open the Sam\'s Club cart before setting quantities');
  }
  if (!Array.isArray(items) || !items.length) throw new Error('No cart quantities were provided');

  const desiredItems = items.map((item) => ({
    name: String(item?.name || ''),
    vendorLink: String(item?.vendorLink || ''),
    quantity: Number(item?.quantity),
  }));
  for (const item of desiredItems) {
    if (!item.name || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 50) {
      throw new Error(`Invalid cart quantity for ${item.name || 'a product'}`);
    }
  }

  const initialTotal = desiredItems.length;
  if (!await waitForCartItemCount(initialTotal, 12000)) {
    throw new Error(`Expected ${initialTotal} products in the clean cart before setting quantities`);
  }

  let currentTotal = initialTotal;
  for (const item of desiredItems) {
    for (let quantity = 1; quantity < item.quantity; quantity++) {
      const row = findCartRowForItem(item);
      const increase = row && findIncreaseQuantityButton(row);
      if (!increase) throw new Error(`Could not find the quantity control for ${item.name}`);
      increase.click();
      currentTotal += 1;
      if (!await waitForCartItemCount(currentTotal)) {
        throw new Error(`Sam\'s Club did not update the quantity for ${item.name}`);
      }
    }
  }

  const expectedTotal = desiredItems.reduce((total, item) => total + item.quantity, 0);
  if (cartItemCount() !== expectedTotal) {
    throw new Error(`Expected ${expectedTotal} total cases in the Sam\'s Club cart`);
  }
  return { totalCases: expectedTotal, productCount: desiredItems.length };
}

function findAddToCartButton() {
  const direct = document.querySelector('button[data-automation-id="atc"]');
  if (direct && isVisible(direct) && !direct.disabled) return direct;
  return Array.from(document.querySelectorAll('button')).find((button) => {
    const label = buttonLabel(button);
    return isVisible(button) && !button.disabled && (/^add to cart\b/i.test(label) || /^add\b.*\bto cart\b/i.test(label));
  }) || null;
}

async function waitForCartControl(timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const increase = findIncreaseQuantityButton();
    if (increase) return increase;
    const add = findAddToCartButton();
    if (add) return add;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

async function addCurrentSamsProductToCart(quantity) {
  if (!window.location.hostname.endsWith('samsclub.com')) {
    throw new Error('This cart flow only supports Sam\'s Club products');
  }
  const requested = Number(quantity);
  if (!Number.isInteger(requested) || requested < 1 || requested > 50) {
    throw new Error('Invalid case quantity');
  }

  const addButton = findAddToCartButton();
  if (!addButton) {
    const unavailable = /out of stock|not available|sold out/i.test(document.body.innerText);
    throw new Error(unavailable ? 'This item is unavailable at Sam\'s Club' : 'Could not find the Add to Cart button');
  }

  addButton.click();
  for (let added = 1; added < requested; added++) {
    await new Promise((resolve) => setTimeout(resolve, 700));
    const control = await waitForCartControl();
    if (!control) throw new Error(`Added 1 of ${requested} cases, but could not find the quantity control`);
    control.click();
  }

  // Give Sam's cart state time to persist before the work tab navigates away.
  await new Promise((resolve) => setTimeout(resolve, 1200));
  return { quantityAdded: requested };
}

/**
 * Pick the count that represents sellable packages in the outer case.
 *
 * Retailer titles can contain more than one count. For example, Extra gum is
 * described as "15 pc., 18 pk.": 15 is the number of sticks inside each pack,
 * while 18 is the number of packs in the case. The old first-match regex chose
 * 15 and made the component total look inconsistent. Prefer explicit package
 * counts over generic item counts, and generic counts over pieces; when the same
 * unit appears more than once, the right-most count is normally the outer case.
 */
function extractCaseSizeFromText(text) {
  if (!text) return null;

  const candidates = [];
  const pattern = /(\d+)\s*(pk|pack|ct|count|pc|piece)\b/gi;
  let match;
  while ((match = pattern.exec(String(text))) !== null) {
    const unit = match[2].toLowerCase();
    const priority = unit === 'pk' || unit === 'pack'
      ? 3
      : unit === 'ct' || unit === 'count'
      ? 2
      : 1;
    candidates.push({ value: match[1], priority, index: match.index });
  }

  candidates.sort((a, b) => b.priority - a.priority || b.index - a.index);
  return candidates[0]?.value || null;
}

function extractUnitMeasureFromText(text) {
  const match = String(text || '').match(/(?:^|[^\d])(\d+(?:\.\d+)?)\s*(fl\.?\s*oz|oz|ounces?|grams?|g|milliliters?|ml)\b/i);
  if (!match) return null;
  const value = Number(match[1]);
  if (!isFinite(value) || value <= 0) return null;
  const raw = match[2].toLowerCase().replace(/[.\s]/g, '');
  const unit = raw === 'floz'
    ? 'fl_oz'
    : raw === 'g' || raw.startsWith('gram')
    ? 'g'
    : raw === 'ml' || raw.startsWith('milliliter')
    ? 'ml'
    : 'oz';
  return { value, unit };
}

function inferPackageTypeFromText(text) {
  const normalized = String(text || '').toLowerCase();
  if (/\b(pouch|pouches|bag|bags)\b/.test(normalized)) return 'pouch';
  if (/\b(bottle|bottles)\b/.test(normalized)) return 'bottle';
  if (/\b(can|cans)\b/.test(normalized)) return 'can';
  if (/\b(bar|bars)\b/.test(normalized)) return 'bar';
  if (/\b(cup|cups)\b/.test(normalized)) return 'cup';
  return null;
}

// Extract product information from the current page
function extractProductInfo() {
  const url = window.location.href;

  if (url.includes('samsclub.com')) {
    return extractSamsClubProduct();
  } else if (url.includes('costco.com')) {
    return extractCostcoProduct();
  }

  return {
    url,
    name: null,
    image: null,
    case_cost: null,
    case_size: null,
    vendor_sku: null,
    retailer: null,
    retailer_product_id: null,
    retailer_item_number: null,
    case_gtin: null,
    unit_gtin: null,
    unit_size_value: null,
    unit_size_unit: null,
    package_type: null,
    item_number: null,
    barcode: null,
    images: [],
    description: null,
    url_identifier: null,
    price_per_each: null,
    vendor_availability: 'unknown',
    vendor_on_sale: false,
    vendor_discount_amount: null,
    vendor_regular_case_cost: null,
    vendor_sale_ends_on: null,
    vendor_shipping_eligible: null,
    vendor_pickup_eligible: null,
    vendor_delivery_eligible: null
  };
}

function productJsonLdNodes(data) {
  if (Array.isArray(data)) return data.flatMap(productJsonLdNodes);
  if (!data || typeof data !== 'object') return [];
  return [data, ...productJsonLdNodes(data['@graph'] || [])];
}

function parseSaleEndDate(text, referenceDate = new Date()) {
  const match = String(text || '').match(
    /\bEnds?\s+([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?\b/i
  );
  if (!match) return null;

  const monthKey = match[1].slice(0, 3).toLowerCase();
  const months = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };
  const month = months[monthKey];
  const day = Number(match[2]);
  if (month === undefined || !Number.isInteger(day)) return null;

  const hasYear = Boolean(match[3]);
  let year = hasYear ? Number(match[3]) : referenceDate.getUTCFullYear();
  let candidate = new Date(Date.UTC(year, month, day));
  if (
    candidate.getUTCMonth() !== month ||
    candidate.getUTCDate() !== day
  ) return null;

  const today = Date.UTC(
    referenceDate.getUTCFullYear(),
    referenceDate.getUTCMonth(),
    referenceDate.getUTCDate()
  );
  if (!hasYear && candidate.getTime() < today) {
    year += 1;
    candidate = new Date(Date.UTC(year, month, day));
  }

  return candidate.toISOString().slice(0, 10);
}

function parseFulfillmentOptions(text) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  const chooser = normalized.match(
    /\bShipping\b(.{0,180}?)\bPickup\b(.{0,180}?)\bDelivery\b(.{0,180}?)(?=\b(?:Shipping|Pickup|Delivery|Curbside Pickup|Club Pickup|Add to Cart)\b|$)/i
  );
  if (!chooser) {
    return { shipping: null, pickup: null, delivery: null };
  }

  const availability = (details) =>
    /\b(not available|unavailable|not eligible|ineligible)\b/i.test(details)
      ? false
      : true;

  return {
    shipping: availability(chooser[1]),
    pickup: availability(chooser[2]),
    delivery: availability(chooser[3]),
  };
}

function emptyVendorStatusEvidence() {
  return { version: 1, scope: null, fields: {} };
}

function vendorStatusEvidence(productInfo) {
  if (!productInfo.vendor_status_evidence) {
    productInfo.vendor_status_evidence = emptyVendorStatusEvidence();
  }
  return productInfo.vendor_status_evidence;
}

function elementDiagnosticSelector(element) {
  if (!element) return null;
  if (element.id) return `#${element.id}`;
  const stableAttributes = ['data-testid', 'data-automation-id', 'aria-label'];
  for (const attribute of stableAttributes) {
    const value = element.getAttribute?.(attribute);
    if (value) return `${element.tagName.toLowerCase()}[${attribute}="${String(value).slice(0, 120)}"]`;
  }
  const classes = Array.from(element.classList || []).slice(0, 3);
  return `${element.tagName?.toLowerCase() || 'element'}${classes.map((name) => `.${name}`).join('')}`;
}

function recordVendorStatusEvidence(productInfo, field, evidence) {
  const diagnostics = vendorStatusEvidence(productInfo);
  const current = diagnostics.fields[field] || [];
  diagnostics.fields[field] = [...current, {
    source: evidence.source,
    selector: evidence.selector || null,
    text: String(evidence.text || '').replace(/\s+/g, ' ').trim().slice(0, 300),
    value: evidence.value,
  }].slice(-5);
}

function findVendorStatusScope(productInfo) {
  const addButton = findAddToCartButton();
  const currentPrice = Number(productInfo.case_cost);
  const pricePattern = Number.isFinite(currentPrice)
    ? new RegExp(`\\$\\s*${currentPrice.toFixed(2).replace('.', '\\.')}(?!\\d)`)
    : /\$\s*\d+(?:\.\d{2})?/;

  if (addButton) {
    let candidate = addButton.parentElement;
    while (candidate && candidate !== document.body) {
      const text = (candidate.innerText || candidate.textContent || '').replace(/\s+/g, ' ').trim();
      const hasCurrentPrice = pricePattern.test(text);
      const hasPurchaseDetails = /\b(?:shipping|pickup|delivery|curbside|add to cart)\b/i.test(text);
      // The smallest ancestor containing the current price and purchase controls is
      // the buy box. Stop before a page-level container can absorb recommendations.
      if (hasCurrentPrice && hasPurchaseDetails && text.length <= 8000) {
        return { element: candidate, strategy: 'add_to_cart_ancestor' };
      }
      candidate = candidate.parentElement;
    }
  }

  const selectors = [
    '[data-testid="buy-box"]',
    '[data-automation-id="buy-box"]',
    '[data-testid="product-details"]',
    '[data-automation-id="product-details"]',
    '.product-buy-box',
    '.product-details',
  ];
  for (const selector of selectors) {
    const candidate = document.querySelector(selector);
    const text = (candidate?.innerText || candidate?.textContent || '').replace(/\s+/g, ' ').trim();
    if (candidate && pricePattern.test(text) && text.length <= 8000) {
      return { element: candidate, strategy: `selector:${selector}` };
    }
  }

  return null;
}

function applyStructuredVendorStatus(productInfo, data) {
  if (productInfo._structured_vendor_status_applied) return;
  for (const node of productJsonLdNodes(data)) {
    if (node['@type'] !== 'Product') continue;
    const offers = Array.isArray(node.offers) ? node.offers : [node.offers].filter(Boolean);
    for (const offer of offers) {
      const availability = String(offer.availability || '').toLowerCase();
      if (availability.includes('instock') || availability.includes('limitedavailability')) {
        productInfo.vendor_availability = 'in_stock';
        recordVendorStatusEvidence(productInfo, 'availability', {
          source: 'json_ld', text: String(offer.availability || ''), value: 'in_stock',
        });
      } else if (availability.includes('outofstock') || availability.includes('soldout') || availability.includes('discontinued')) {
        productInfo.vendor_availability = 'out_of_stock';
        recordVendorStatusEvidence(productInfo, 'availability', {
          source: 'json_ld', text: String(offer.availability || ''), value: 'out_of_stock',
        });
      }

      const currentPrice = Number(offer.price);
      const regularPrice = Number(
        offer.highPrice || offer.listPrice || offer.priceSpecification?.priceBeforeDiscount
      );
      if (currentPrice > 0 && regularPrice > currentPrice) {
        productInfo.vendor_on_sale = true;
        productInfo.vendor_discount_amount = Math.round((regularPrice - currentPrice) * 100) / 100;
        productInfo.vendor_regular_case_cost = Math.round(regularPrice * 100) / 100;
        recordVendorStatusEvidence(productInfo, 'sale', {
          source: 'json_ld',
          text: `current ${currentPrice}; regular ${regularPrice}`,
          value: {
            onSale: true,
            discountAmount: productInfo.vendor_discount_amount,
            regularCaseCost: productInfo.vendor_regular_case_cost,
          },
        });
      }
      if (typeof offer.priceValidUntil === 'string' && /^\d{4}-\d{2}-\d{2}/.test(offer.priceValidUntil)) {
        productInfo.vendor_sale_ends_on = offer.priceValidUntil.slice(0, 10);
        recordVendorStatusEvidence(productInfo, 'saleEndsOn', {
          source: 'json_ld', text: offer.priceValidUntil, value: productInfo.vendor_sale_ends_on,
        });
      }
      if (offer.shippingDetails) {
        productInfo.vendor_shipping_eligible = true;
        recordVendorStatusEvidence(productInfo, 'shipping', {
          source: 'json_ld', text: 'shippingDetails present', value: true,
        });
      }
    }
    Object.defineProperty(productInfo, '_structured_vendor_status_applied', {
      value: true,
      writable: true,
      enumerable: false,
      configurable: true,
    });
    return;
  }
}

function applyVisibleVendorStatus(productInfo) {
  const scope = findVendorStatusScope(productInfo);
  const evidence = vendorStatusEvidence(productInfo);
  evidence.scope = scope
    ? { strategy: scope.strategy, selector: elementDiagnosticSelector(scope.element) }
    : { strategy: 'none', selector: null };

  // Do not fall back to document.body here. Product pages contain recommendation
  // cards with their own sales, availability and fulfillment copy.
  if (!scope) {
    if (productInfo.vendor_availability === 'unknown' && findAddToCartButton()) {
      productInfo.vendor_availability = 'in_stock';
      recordVendorStatusEvidence(productInfo, 'availability', {
        source: 'add_to_cart_button', text: 'Visible enabled Add to Cart button', value: 'in_stock',
      });
    }
    return;
  }

  const root = scope.element;
  const scopeText = (root.innerText || root.textContent || '')
    .replace(/\s+/g, ' ')
    .trim();

  const unavailableMatch = scopeText.match(/\b(out of stock|sold out|currently unavailable|item is unavailable)\b/i);
  if (unavailableMatch) {
    productInfo.vendor_availability = 'out_of_stock';
    recordVendorStatusEvidence(productInfo, 'availability', {
      source: 'visible_buy_box', selector: elementDiagnosticSelector(root), text: unavailableMatch[0], value: 'out_of_stock',
    });
  } else if (productInfo.vendor_availability === 'unknown' && findAddToCartButton()) {
    productInfo.vendor_availability = 'in_stock';
    recordVendorStatusEvidence(productInfo, 'availability', {
      source: 'add_to_cart_button', selector: elementDiagnosticSelector(root), text: 'Visible enabled Add to Cart button', value: 'in_stock',
    });
  }

  const saleElement = root.querySelector(
    'del, s, [data-automation-id*="strike" i], [data-testid*="strike" i], [class*="strikethrough" i], [class*="was-price" i]'
  );
  const saleCopyMatch = scopeText.match(/\b(instant savings|member savings|sale price|save \$\s*\d|was \$\s*\d)\b/i);
  if (
    saleElement ||
    saleCopyMatch
  ) {
    productInfo.vendor_on_sale = true;
    recordVendorStatusEvidence(productInfo, 'sale', {
      source: 'visible_buy_box',
      selector: elementDiagnosticSelector(saleElement || root),
      text: saleElement?.textContent || saleCopyMatch?.[0] || '',
      value: { onSale: true },
    });
  }

  const currentCaseCost = Number(productInfo.case_cost);
  const struckPriceMatch = String(saleElement?.textContent || '').match(
    /\$\s*(\d+(?:\.\d{1,2})?)/
  );
  const visiblePricePair = scopeText.match(
    /\bNow\s*\$\s*(\d+(?:\.\d{1,2})?)\s+\$\s*(\d+(?:\.\d{1,2})?)/i
  );
  const regularCaseCost = Number(struckPriceMatch?.[1] || visiblePricePair?.[2]);
  if (
    Number.isFinite(regularCaseCost) &&
    regularCaseCost > 0 &&
    (!Number.isFinite(currentCaseCost) || regularCaseCost > currentCaseCost)
  ) {
    productInfo.vendor_on_sale = true;
    productInfo.vendor_regular_case_cost = Math.round(regularCaseCost * 100) / 100;
    recordVendorStatusEvidence(productInfo, 'regularCaseCost', {
      source: 'visible_buy_box',
      selector: elementDiagnosticSelector(saleElement || root),
      text: struckPriceMatch?.[0] || visiblePricePair?.[0] || '',
      value: productInfo.vendor_regular_case_cost,
    });
  }

  // Sam's renders savings as "$6 off" beside the current price. Costco and some
  // Sam's layouts use "Save $6" instead. Keep the dollar value separate from the
  // current case cost so the app can show an unambiguous savings badge.
  const discountMatch = scopeText.match(/\$\s*(\d+(?:\.\d{1,2})?)\s*off\b/i) ||
    scopeText.match(/\bsave\s*\$\s*(\d+(?:\.\d{1,2})?)/i);
  if (discountMatch) {
    const amount = Number(discountMatch[1]);
    if (Number.isFinite(amount) && amount > 0) {
      productInfo.vendor_on_sale = true;
      productInfo.vendor_discount_amount = Math.round(amount * 100) / 100;
      if (!productInfo.vendor_regular_case_cost && currentCaseCost > 0) {
        productInfo.vendor_regular_case_cost = Math.round((currentCaseCost + amount) * 100) / 100;
      }
      recordVendorStatusEvidence(productInfo, 'discountAmount', {
        source: 'visible_buy_box', selector: elementDiagnosticSelector(root), text: discountMatch[0], value: productInfo.vendor_discount_amount,
      });
    }
  }

  const visibleSaleEndsOn = parseSaleEndDate(scopeText);
  if (visibleSaleEndsOn) {
    productInfo.vendor_sale_ends_on = visibleSaleEndsOn;
    recordVendorStatusEvidence(productInfo, 'saleEndsOn', {
      source: 'visible_buy_box', selector: elementDiagnosticSelector(root), text: `Ends ${visibleSaleEndsOn}`, value: visibleSaleEndsOn,
    });
  }

  const fulfillment = parseFulfillmentOptions(scopeText);
  if (fulfillment.shipping != null) productInfo.vendor_shipping_eligible = fulfillment.shipping;
  if (fulfillment.pickup != null) productInfo.vendor_pickup_eligible = fulfillment.pickup;
  if (fulfillment.delivery != null) productInfo.vendor_delivery_eligible = fulfillment.delivery;
  for (const [field, value] of Object.entries(fulfillment)) {
    if (value != null) {
      recordVendorStatusEvidence(productInfo, field, {
        source: 'visible_buy_box', selector: elementDiagnosticSelector(root), text: field, value,
      });
    }
  }
}

// Extract Sam's Club product information
function extractSamsClubProduct() {
  const productInfo = {
    url: window.location.href,
    name: null,
    image: null,
    case_cost: null,
    case_size: null,
    vendor_sku: null,
    retailer: 'samsclub',
    retailer_product_id: null,
    retailer_item_number: null,
    case_gtin: null,
    unit_gtin: null,
    unit_size_value: null,
    unit_size_unit: null,
    package_type: null,
    item_number: null,
    barcode: null,
    images: [],
    description: null,
    url_identifier: null,
    price_per_each: null,
    vendor_availability: 'unknown',
    vendor_on_sale: false,
    vendor_discount_amount: null,
    vendor_regular_case_cost: null,
    vendor_sale_ends_on: null,
    vendor_shipping_eligible: null,
    vendor_pickup_eligible: null,
    vendor_delivery_eligible: null,
    vendor_context: extractSamsClubLocationContext()
  };

  try {
    // Extract URL identifier from URL
    // Sam's Club URLs: https://www.samsclub.com/p/product-name/URL_ID or /ip/product-name/URL_ID
    const urlMatch = productInfo.url.match(/\/(?:p|ip)\/[^\/]+\/(\d+)/);
    if (urlMatch) {
      productInfo.url_identifier = urlMatch[1];
      productInfo.retailer_product_id = urlMatch[1];
    }

    // Extract from structured data (JSON-LD) - most reliable
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    scripts.forEach(script => {
      try {
        const data = JSON.parse(script.textContent);
        applyStructuredVendorStatus(productInfo, data);
        if (data['@type'] === 'Product') {
          productInfo.name = productInfo.name || data.name;
          productInfo.image = productInfo.image || data.image;

          // Extract barcode (GTIN-13, GTIN-12, UPC, EAN)
          productInfo.barcode = productInfo.barcode ||
                                data.gtin13 ||
                                data.gtin12 ||
                                data.gtin ||
                                data.upc ||
                                data.ean || null;

          // Extract price from offers
          if (data.offers?.price && !productInfo.case_cost) {
            productInfo.case_cost = data.offers.price.toString();
          }
        }
      } catch (e) {
        // Ignore parse errors
      }
    });

    // Extract product name from multiple selectors
    if (!productInfo.name) {
      const nameSelectors = [
        'h1[itemprop="name"]',
        'h1.product-name',
        'h1.product-title',
        '[data-automation-id="product-title"]',
        'h1',
        'meta[property="og:title"]'
      ];

      for (const selector of nameSelectors) {
        if (selector.startsWith('meta')) {
          const meta = document.querySelector(selector);
          if (meta?.content) {
            productInfo.name = meta.content.trim();
            break;
          }
        } else {
          const element = document.querySelector(selector);
          if (element?.textContent) {
            productInfo.name = element.textContent.trim();
            break;
          }
        }
      }
    }

    // Extract product image from multiple selectors
    if (!productInfo.image) {
      const imageSelectors = [
        'img[itemprop="image"]',
        '.product-image img',
        '[data-automation-id="product-image"] img',
        '.primary-image img',
        'meta[property="og:image"]'
      ];

      for (const selector of imageSelectors) {
        if (selector.startsWith('meta')) {
          const meta = document.querySelector(selector);
          if (meta?.content) {
            productInfo.image = meta.content;
            break;
          }
        } else {
          const img = document.querySelector(selector);
          if (img?.src || img?.dataset?.src) {
            productInfo.image = img.src || img.dataset.src;
            break;
          }
        }
      }
    }

    // Extract case cost (main product price)
    if (!productInfo.case_cost) {
      const priceSelectors = [
        '[itemprop="price"]',
        'span[data-automation-id="product-price"]',
        'div[data-automation-id="product-price"]',
        '.sc-price-heading',
        '.Price-characteristic'
      ];

      for (const selector of priceSelectors) {
        const element = document.querySelector(selector);
        if (element) {
          const priceText = element.textContent || element.getAttribute('content');
          const priceMatch = priceText?.match(/\$?(\d+\.\d{2})/);
          if (priceMatch) {
            const price = parseFloat(priceMatch[1]);
            if (price >= 1.00) {
              productInfo.case_cost = priceMatch[1];
              break;
            }
          }
        }
      }
    }

    // Fallback: Look for prominent price in main content
    if (!productInfo.case_cost) {
      const mainContent = document.querySelector('main, [role="main"], .product-details');
      if (mainContent) {
        const allPrices = mainContent.textContent.match(/\$(\d+\.\d{2})/g);
        if (allPrices && allPrices.length > 0) {
          for (const priceStr of allPrices) {
            const price = parseFloat(priceStr.replace('$', ''));
            if (price >= 1.00) {
              productInfo.case_cost = price.toFixed(2);
              break;
            }
          }
        }
      }
    }

    // Extract case size
    // Strategy 1: Prefer the outer package count when a title contains both an
    // inner-unit count and a case count (for example "15 pc., 18 pk.").
    if (productInfo.name) {
      productInfo.case_size = extractCaseSizeFromText(productInfo.name);
    }

    // Strategy 2: Search entire page body
    if (!productInfo.case_size) {
      const bodyText = document.body.textContent;
      productInfo.case_size = extractCaseSizeFromText(bodyText);
    }

    // The catalog dedupes on vendor_sku, so it must be one namespace, always
    // present. The product id in the URL is exactly that. The on-page "Item #"
    // is scraped too, but only for display — it renders inconsistently, and
    // falling back to the URL id when it's missing silently mixed two different
    // id spaces, which is how duplicate catalog rows got created.
    const bodyText = document.body.textContent;
    productInfo.vendor_sku = productInfo.retailer_product_id;

    const itemNumberMatch = bodyText.match(/Item\s*#\s*:?\s*(\d{8,12})/i);
    if (itemNumberMatch) {
      productInfo.item_number = itemNumberMatch[1];
      productInfo.retailer_item_number = itemNumberMatch[1];
    }

    productInfo.case_gtin = productInfo.barcode;
    const unitMeasure = extractUnitMeasureFromText(productInfo.name);
    productInfo.unit_size_value = unitMeasure?.value ?? null;
    productInfo.unit_size_unit = unitMeasure?.unit ?? null;
    productInfo.package_type = inferPackageTypeFromText(productInfo.name);

    // Extract unit price (price per each) - optional field
    // Look for patterns like "$0.37/ea" or "$0.37 /ea"
    const unitPriceMatch = bodyText.match(/\$?(\d+\.\d{2})\s*\/\s*ea/i);
    if (unitPriceMatch) {
      productInfo.price_per_each = unitPriceMatch[1];
    }

    productInfo.images = collectGalleryImages(productInfo.image);
    productInfo.description = collectDescription();
    applyVisibleVendorStatus(productInfo);

    console.log('[VenDrop] Extracted Sam\'s Club product:', productInfo);
  } catch (error) {
    console.error('[VenDrop] Error extracting Sam\'s Club product:', error);
  }

  return productInfo;
}

// The vendor's product blurb. JSON-LD carries it cleanly on both retailers; the
// meta description is a decent fallback.
function collectDescription() {
  let description = null;

  document.querySelectorAll('script[type="application/ld+json"]').forEach((script) => {
    try {
      const data = JSON.parse(script.textContent);
      if (data['@type'] === 'Product' && data.description && !description) {
        description = String(data.description).trim();
      }
    } catch (e) {
      // Ignore parse errors
    }
  });

  if (!description) {
    const meta = document.querySelector('meta[name="description"], meta[property="og:description"]');
    if (meta?.content) description = meta.content.trim();
  }

  return description ? description.slice(0, 2000) : null;
}

// Collect every product photo in the page's gallery, not just the hero.
//
// The hero shot is the case (a 40-pack carton); what sits in a vending machine
// slot is a single unit, and that picture is almost always a secondary carousel
// image. The API classifies these and keeps the useful ones, so err on the side
// of collecting too many here — sorting them out is not this script's job.
function collectGalleryImages(heroUrl) {
  const urls = [];

  const push = (url) => {
    if (!url || typeof url !== 'string') return;
    if (!/^https?:\/\//.test(url)) return;
    const clean = normalizeAssetUrl(url);
    if (!urls.includes(clean)) urls.push(clean);
  };

  // The hero/primary shot first, so it stays the lead image.
  push(heroUrl);

  // The gallery rail: alt="thumbnail image 1 of <product>", ... This alt is the only
  // trustworthy marker on the page. A product page also serves ~20 RECOMMENDATION
  // images of entirely different products (Cheez-It, OREO, Snickers) off the same CDN,
  // plus customer photos — and at least one related-product shot ("MadeGood Drizzled
  // Bar") whose alt starts with the same brand as the product itself. Matching on the
  // CDN host, or on the product name, would pull other people's products into this
  // product's gallery.
  // Filtered in JS rather than with a case-insensitive attribute selector: an
  // unsupported selector throws, and the throw is swallowed by the caller's catch —
  // which would silently leave the gallery empty all over again.
  document.querySelectorAll('img[alt]').forEach((img) => {
    if (/^thumbnail image\b/i.test(img.alt)) push(img.src || img.dataset?.src);
  });

  // The main viewer. Its id is hero-image-default-N or hero-image-zoom-N depending on
  // zoom state — matching only one variant found nothing on half the pages.
  document.querySelectorAll('img[id^="hero-image-"]').forEach((img) => {
    push(img.src || img.dataset?.src);
  });

  // JSON-LD is a single image string on Sam's, but other retailers give an array.
  document.querySelectorAll('script[type="application/ld+json"]').forEach((script) => {
    try {
      const data = JSON.parse(script.textContent);
      if (data['@type'] === 'Product') {
        const imgs = Array.isArray(data.image) ? data.image : [data.image];
        imgs.forEach(push);
      }
    } catch (e) {
      // Ignore parse errors
    }
  });

  return urls.slice(0, 10);
}

// These CDNs serve one asset at any size via query params, so the bare path is the
// full-resolution original. Stripping the query makes a 117px thumbnail and the 1500px
// hero of the same photo dedupe to a single entry — and means we store the original
// rather than a postage stamp.
function normalizeAssetUrl(url) {
  return /samsclubimages\.com|walmartimages\.com/.test(url) ? url.split('?')[0] : url;
}

// Extract Costco product information
function extractCostcoProduct() {
  const productInfo = {
    url: window.location.href,
    name: null,
    image: null,
    case_cost: null,
    case_size: null,
    vendor_sku: null,
    retailer: 'costco',
    retailer_product_id: null,
    retailer_item_number: null,
    case_gtin: null,
    unit_gtin: null,
    unit_size_value: null,
    unit_size_unit: null,
    package_type: null,
    item_number: null,
    barcode: null,
    images: [],
    description: null,
    url_identifier: null,
    price_per_each: null,
    vendor_availability: 'unknown',
    vendor_on_sale: false,
    vendor_discount_amount: null,
    vendor_regular_case_cost: null,
    vendor_sale_ends_on: null,
    vendor_shipping_eligible: null,
    vendor_pickup_eligible: null,
    vendor_delivery_eligible: null
  };

  try {
    // Extract URL identifier from URL
    // Costco supports both the legacy `.product.ID.html` URL and the current
    // `/p/-/slug/ID` route.
    const urlMatch = productInfo.url.match(/\.product\.(\d+)\.html/) ||
      productInfo.url.match(/\/p\/(?:-\/)?[^?#]*?\/(\d+)(?:[?#]|$)/);
    if (urlMatch) {
      productInfo.url_identifier = urlMatch[1];
      productInfo.retailer_product_id = urlMatch[1];
    }

    // Extract from structured data (JSON-LD) - most reliable
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    scripts.forEach(script => {
      try {
        const data = JSON.parse(script.textContent);
        applyStructuredVendorStatus(productInfo, data);
        for (const node of productJsonLdNodes(data)) {
          if (node['@type'] !== 'Product') continue;
          productInfo.name = productInfo.name || node.name;
          const structuredImage = Array.isArray(node.image) ? node.image[0] : node.image;
          productInfo.image = productInfo.image || structuredImage;
          productInfo.retailer_item_number = productInfo.retailer_item_number ||
                                            (node.sku != null ? String(node.sku) : null) ||
                                            (node.productID != null ? String(node.productID) : null);

          // Extract barcode
          productInfo.barcode = productInfo.barcode ||
                                node.gtin14 ||
                                node.gtin13 ||
                                node.gtin12 ||
                                node.gtin ||
                                node.upc ||
                                node.ean || null;

          // Extract price from offers
          const offers = Array.isArray(node.offers) ? node.offers : [node.offers].filter(Boolean);
          const pricedOffer = offers.find((offer) => Number(offer?.price) > 0);
          if (pricedOffer && !productInfo.case_cost) {
            productInfo.case_cost = pricedOffer.price.toString();
          }
          break;
        }
      } catch (e) {
        // Ignore parse errors
      }
    });

    // Extract product name
    if (!productInfo.name) {
      const nameSelectors = [
        'h1[itemprop="name"]',
        'h1.product-title',
        'h1',
        'meta[property="og:title"]'
      ];

      for (const selector of nameSelectors) {
        if (selector.startsWith('meta')) {
          const meta = document.querySelector(selector);
          if (meta?.content) {
            productInfo.name = meta.content.trim();
            break;
          }
        } else {
          const element = document.querySelector(selector);
          if (element?.textContent) {
            productInfo.name = element.textContent.trim();
            break;
          }
        }
      }
    }

    // Extract product image
    if (!productInfo.image) {
      const imageSelectors = [
        'img[itemprop="image"]',
        '.product-image img',
        'meta[property="og:image"]'
      ];

      for (const selector of imageSelectors) {
        if (selector.startsWith('meta')) {
          const meta = document.querySelector(selector);
          if (meta?.content) {
            productInfo.image = meta.content;
            break;
          }
        } else {
          const img = document.querySelector(selector);
          if (img?.src || img?.dataset?.src) {
            productInfo.image = img.src || img.dataset.src;
            break;
          }
        }
      }
    }

    // Extract case cost
    if (!productInfo.case_cost) {
      const priceSelectors = [
        '[itemprop="price"]',
        '.price',
        '.product-price',
        '.your-price'
      ];

      for (const selector of priceSelectors) {
        const element = document.querySelector(selector);
        if (element) {
          const priceText = element.textContent || element.getAttribute('content');
          const priceMatch = priceText?.match(/\$?(\d+\.\d{2})/);
          if (priceMatch) {
            const price = parseFloat(priceMatch[1]);
            if (price >= 1.00) {
              productInfo.case_cost = priceMatch[1];
              break;
            }
          }
        }
      }
    }

    // Extract case size from product name or page
    if (productInfo.name) {
      productInfo.case_size = extractCaseSizeFromText(productInfo.name);
    }

    if (!productInfo.case_size) {
      const bodyText = document.body.textContent;
      productInfo.case_size = extractCaseSizeFromText(bodyText);
    }

    // Same rule as Sam's: the URL product id is the dedupe key; the on-page
    // item number is informational only.
    const bodyText = document.body.textContent;
    productInfo.vendor_sku = productInfo.retailer_product_id;

    const itemNumberMatch = bodyText.match(/Item\s*#?\s*:?\s*(\d{5,12})/i);
    if (itemNumberMatch) {
      productInfo.item_number = itemNumberMatch[1];
      productInfo.retailer_item_number = productInfo.retailer_item_number || itemNumberMatch[1];
    }

    productInfo.item_number = productInfo.item_number || productInfo.retailer_item_number;
    productInfo.case_gtin = productInfo.barcode;
    const unitMeasure = extractUnitMeasureFromText(productInfo.name);
    productInfo.unit_size_value = unitMeasure?.value ?? null;
    productInfo.unit_size_unit = unitMeasure?.unit ?? null;
    productInfo.package_type = inferPackageTypeFromText(productInfo.name);

    // Extract unit price (optional)
    const unitPriceMatch = bodyText.match(/\$?(\d+\.\d{2})\s*\/\s*(ea|each)/i);
    if (unitPriceMatch) {
      productInfo.price_per_each = unitPriceMatch[1];
    }

    productInfo.images = collectGalleryImages(productInfo.image);
    productInfo.description = collectDescription();
    applyVisibleVendorStatus(productInfo);

    console.log('[VenDrop] Extracted Costco product:', productInfo);
  } catch (error) {
    console.error('[VenDrop] Error extracting Costco product:', error);
  }

  return productInfo;
}

// Automatically extract product info when page loads
const productInfo = extractProductInfo();
if (productInfo.name) {
  console.log('[VenDrop] Product detected:', productInfo);
}

// ===== Multi-select on retailer product cards =====
// Draws a checkbox on every product card we can see — search/category results,
// homepage carousels, recommendations, and cards on product pages. Checked cards
// are queued in storage; the popup then imports them one at a time by actually
// visiting each product page (cards don't carry case size or barcode).

const SELECTION_KEY = 'selection';

function isSamsClubPage() {
  return window.location.hostname.includes('samsclub.com');
}

function isCostcoPage() {
  return window.location.hostname.includes('costco.com');
}

function isSupportedRetailerPage() {
  return isSamsClubPage() || isCostcoPage();
}

// Sam's currently puts `link-identifier` on its full-card click target, but that
// attribute has changed before. The product href is the durable contract. Keep
// the old selector as a fallback for sponsored redirect links whose real `/ip/`
// path only appears inside the `rd` query parameter.
const PRODUCT_LINK_SELECTOR = [
  'a[href*="/ip/"]',
  'a[href*="/p/"]',
  'a[href*=".product."]',
  'a[link-identifier]',
].join(',');

// A tile's href is often a Midas ad-tracking redirect for sponsored products,
// with the real product URL buried in the `rd` param. Prefer that over the href.
function resolveProductUrl(anchor) {
  const raw = anchor.getAttribute('href');
  if (!raw) return null;

  let url = null;
  try {
    url = new URL(raw, window.location.origin);
  } catch (e) {
    url = null;
  }

  if (url) {
    const redirect = url.searchParams.get('rd');
    if (redirect) {
      try {
        url = new URL(redirect, window.location.origin);
      } catch (e) {
        // Fall through to the raw-string scan below.
      }
    }
    if (isSamsClubPage() && /\/(ip|p)\/.+\/\d+/.test(url.pathname)) {
      return `${url.origin}${url.pathname}`;
    }
    if (isCostcoPage() && (
      /\/p\/(?:-\/)?[^?#]+\/\d+$/.test(url.pathname) ||
      /\.product\.\d+\.html$/.test(url.pathname)
    )) return `${url.origin}${url.pathname}`;
  }

  // Last resort: Midas hrefs also carry the plain product path at the very end.
  if (isSamsClubPage()) {
    const m = raw.match(/\/(?:ip|p)\/[^?&#]+?\/\d+/);
    return m ? `${window.location.origin}${m[0]}` : null;
  }
  const m = raw.match(/(?:\/p\/(?:-\/)?[^?&#]+?\/\d+|\/[^?&#]*\.product\.\d+\.html)/);
  return m ? `${window.location.origin}${m[0]}` : null;
}

// "/ip/IQBAR-Plant-Protein-Bar-Variety-Pack-12-pk/13576516009" -> "IQBAR Plant Protein Bar Variety Pack 12 pk"
function nameFromUrl(url) {
  const m = isCostcoPage()
    ? url.match(/\/p\/(?:-\/)?([^/]+)\/\d+/) || url.match(/\/([^/]+)\.product\.\d+\.html/)
    : url.match(/\/(?:ip|p)\/([^/]+)\/\d+/);
  return m ? decodeURIComponent(m[1]).replace(/-/g, ' ') : null;
}

function productIdFromUrl(url) {
  if (!url) return null;
  const m = isCostcoPage()
    ? url.match(/\.product\.(\d+)\.html/) || url.match(/\/p\/(?:-\/)?[^?#]*?\/(\d+)(?:[?#]|$)/)
    : url.match(/\/(?:ip|p)\/[^/?#]+\/(\d+)/);
  if (!m) return null;
  return m[1];
}

function selectionIdFromUrl(url) {
  const productId = productIdFromUrl(url);
  return productId ? `${isCostcoPage() ? 'costco' : 'samsclub'}:${productId}` : null;
}

// Grid tiles and sponsored-banner tiles nest the anchor differently, so find the
// nearest positioned ancestor rather than assuming a fixed depth. That is the
// element the anchor's `absolute` fill is sized against — i.e. the tile itself.
function findTileMount(anchor) {
  let el = anchor.parentElement;
  while (el && el !== document.body) {
    if (getComputedStyle(el).position !== 'static') return el;
    el = el.parentElement;
  }
  return anchor.parentElement;
}

async function getSelection() {
  const r = await chrome.storage.local.get(SELECTION_KEY);
  return r[SELECTION_KEY] || {};
}

async function setSelected(item, selected) {
  const selection = await getSelection();
  if (selected) {
    selection[item.id] = item;
  } else {
    delete selection[item.id];
  }
  await chrome.storage.local.set({ [SELECTION_KEY]: selection });
}

function injectSelectionStyles() {
  if (document.getElementById('vendrop-tile-styles')) return;
  const style = document.createElement('style');
  style.id = 'vendrop-tile-styles';
  // z-index must beat the tile's click-capture anchor (z-1), and opacity is
  // pinned because the anchor's `hide-sibling-opacity` class dims its siblings.
  style.textContent = `
    .vendrop-tile-check {
      position: absolute;
      top: 6px;
      left: 6px;
      z-index: 5;
      width: 26px;
      height: 26px;
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.95);
      border: 1px solid #c9ced6;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.18);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      opacity: 1 !important;
    }
    .vendrop-tile-check input {
      width: 16px;
      height: 16px;
      margin: 0;
      cursor: pointer;
      accent-color: #0067a0;
    }
    .vendrop-tile-check.is-checked {
      background: #0067a0;
      border-color: #0067a0;
    }
  `;
  (document.head || document.documentElement).appendChild(style);
}

async function decorateTiles() {
  if (!isSupportedRetailerPage()) return;

  const anchors = document.querySelectorAll(PRODUCT_LINK_SELECTOR);
  if (!anchors.length) return;

  injectSelectionStyles();
  const selection = await getSelection();
  let added = 0;
  let skipped = 0;

  anchors.forEach((anchor) => {
    const url = resolveProductUrl(anchor);
    const id = selectionIdFromUrl(url);
    const mount = findTileMount(anchor);
    if (!id || !url || !mount) {
      skipped++;
      return;
    }

    // A product can have an image link and a title link inside the same card.
    // Decorate the card once, but allow the same product to appear in a second
    // carousel or grid elsewhere on the page.
    const alreadyDecorated = Array.from(mount.children).some((child) =>
      child.classList?.contains('vendrop-tile-check') && child.dataset.vendropId === id
    );
    if (alreadyDecorated) return;

    anchor.setAttribute('data-vendrop-tile', id);

    // The anchor is an invisible click-capture overlay, so its own text is often
    // empty. The URL slug is a clean, always-present fallback — and it's only a
    // placeholder for the queue list; the real name comes from the product page.
    const name = anchor.textContent.trim() ||
      mount.querySelector('h2, h3, [data-automation-id*="title"]')?.textContent?.trim() ||
      nameFromUrl(url) ||
      id;
    const image = mount.querySelector('img')?.currentSrc || mount.querySelector('img')?.src || null;
    const item = { id, url, name, image, retailer: isCostcoPage() ? 'costco' : 'samsclub' };

    const box = document.createElement('label');
    box.className = 'vendrop-tile-check';
    box.dataset.vendropId = id;
    box.title = selection[id] ? `Remove ${name} from VenDrop` : `Add ${name} to VenDrop`;

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!selection[id];
    input.setAttribute('aria-label', `Select ${name} for VenDrop`);
    box.classList.toggle('is-checked', input.checked);

    // The whole tile is one big navigation target, so every event that could
    // bubble up to it has to be stopped or checking a box navigates away.
    const swallow = (e) => e.stopPropagation();
    box.addEventListener('click', (e) => {
      e.stopPropagation();
      if (e.target !== input) e.preventDefault();
    });
    box.addEventListener('mousedown', swallow);
    box.addEventListener('mouseup', swallow);
    box.addEventListener('pointerdown', swallow);

    input.addEventListener('change', async (e) => {
      e.stopPropagation();
      box.classList.toggle('is-checked', input.checked);
      box.title = input.checked ? `Remove ${name} from VenDrop` : `Add ${name} to VenDrop`;
      await setSelected(item, input.checked);
    });

    box.appendChild(input);
    mount.appendChild(box);
    added++;
  });

  console.log(`[VenDrop] Decorated ${added} tile(s), skipped ${skipped}`);
}

// Keep checkboxes in sync when the popup clears or changes the queue.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[SELECTION_KEY]) return;
  const selection = changes[SELECTION_KEY].newValue || {};
  document.querySelectorAll('.vendrop-tile-check').forEach((box) => {
    const id = box.dataset.vendropId;
    const input = box.querySelector('input');
    if (!id || !input) return;
    input.checked = !!selection[id];
    box.classList.toggle('is-checked', input.checked);
  });
});

if (isSupportedRetailerPage()) {
  decorateTiles();

  // Grids, carousels, recommendations, and SPA navigation all re-render without
  // a full page load, so keep watching for newly visible product cards.
  let pending = null;
  const observer = new MutationObserver(() => {
    clearTimeout(pending);
    pending = setTimeout(decorateTiles, 300);
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
