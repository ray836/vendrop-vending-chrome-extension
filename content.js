// Content script for detecting and extracting product information
// Runs on Sam's Club and Costco product pages

console.log('[VenDrop] Content script loaded');

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'GET_PRODUCT_INFO') {
    const productInfo = extractProductInfo();
    sendResponse({ success: true, productInfo });
  }
  return true; // Keep the message channel open for async response
});

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
    item_number: null,
    barcode: null,
    images: [],
    description: null,
    url_identifier: null,
    price_per_each: null
  };
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
    item_number: null,
    barcode: null,
    images: [],
    description: null,
    url_identifier: null,
    price_per_each: null
  };

  try {
    // Extract URL identifier from URL
    // Sam's Club URLs: https://www.samsclub.com/p/product-name/URL_ID or /ip/product-name/URL_ID
    const urlMatch = productInfo.url.match(/\/(?:p|ip)\/[^\/]+\/(\d+)/);
    if (urlMatch) {
      productInfo.url_identifier = urlMatch[1];
    }

    // Extract from structured data (JSON-LD) - most reliable
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    scripts.forEach(script => {
      try {
        const data = JSON.parse(script.textContent);
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
    // Strategy 1: Look in product name for patterns like "50 pk", "36 ct"
    if (productInfo.name) {
      const nameMatch = productInfo.name.match(/(\d+)\s*(pk|ct|count|pack|piece|pc)/i);
      if (nameMatch) {
        productInfo.case_size = nameMatch[1];
      }
    }

    // Strategy 2: Search entire page body
    if (!productInfo.case_size) {
      const bodyText = document.body.textContent;
      const sizeMatch = bodyText.match(/(\d+)\s*(ct|count|pack|pk|piece|pc)/i);
      if (sizeMatch) {
        productInfo.case_size = sizeMatch[1];
      }
    }

    // The catalog dedupes on vendor_sku, so it must be one namespace, always
    // present. The product id in the URL is exactly that. The on-page "Item #"
    // is scraped too, but only for display — it renders inconsistently, and
    // falling back to the URL id when it's missing silently mixed two different
    // id spaces, which is how duplicate catalog rows got created.
    const bodyText = document.body.textContent;
    productInfo.vendor_sku = productInfo.url_identifier;

    const itemNumberMatch = bodyText.match(/Item\s*#\s*:?\s*(\d{8,12})/i);
    if (itemNumberMatch) {
      productInfo.item_number = itemNumberMatch[1];
    }

    // Extract unit price (price per each) - optional field
    // Look for patterns like "$0.37/ea" or "$0.37 /ea"
    const unitPriceMatch = bodyText.match(/\$?(\d+\.\d{2})\s*\/\s*ea/i);
    if (unitPriceMatch) {
      productInfo.price_per_each = unitPriceMatch[1];
    }

    productInfo.images = collectGalleryImages(productInfo.image);
    productInfo.description = collectDescription();

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
    item_number: null,
    barcode: null,
    images: [],
    description: null,
    url_identifier: null,
    price_per_each: null
  };

  try {
    // Extract URL identifier from URL
    // Costco URLs: https://www.costco.com/product-name.product.PRODUCT_ID.html
    const urlMatch = productInfo.url.match(/\.product\.(\d+)\.html/);
    if (urlMatch) {
      productInfo.url_identifier = urlMatch[1];
    }

    // Extract from structured data (JSON-LD) - most reliable
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    scripts.forEach(script => {
      try {
        const data = JSON.parse(script.textContent);
        if (data['@type'] === 'Product') {
          productInfo.name = productInfo.name || data.name;
          productInfo.image = productInfo.image || data.image;

          // Extract barcode
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
      const nameMatch = productInfo.name.match(/(\d+)\s*(pk|ct|count|pack|piece|pc)/i);
      if (nameMatch) {
        productInfo.case_size = nameMatch[1];
      }
    }

    if (!productInfo.case_size) {
      const bodyText = document.body.textContent;
      const sizeMatch = bodyText.match(/(\d+)\s*(ct|count|pack|pk|piece|pc)/i);
      if (sizeMatch) {
        productInfo.case_size = sizeMatch[1];
      }
    }

    // Same rule as Sam's: the URL product id is the dedupe key; the on-page
    // item number is informational only.
    const bodyText = document.body.textContent;
    productInfo.vendor_sku = productInfo.url_identifier;

    const itemNumberMatch = bodyText.match(/Item\s*#\s*:?\s*(\d{6,12})/i);
    if (itemNumberMatch) {
      productInfo.item_number = itemNumberMatch[1];
    }

    // Extract unit price (optional)
    const unitPriceMatch = bodyText.match(/\$?(\d+\.\d{2})\s*\/\s*(ea|each)/i);
    if (unitPriceMatch) {
      productInfo.price_per_each = unitPriceMatch[1];
    }

    productInfo.images = collectGalleryImages(productInfo.image);
    productInfo.description = collectDescription();

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

// ===== Multi-select on listing pages =====
// Draws a checkbox on every product tile of a browse/search grid. Checked tiles
// are queued in storage; the popup then imports them one at a time by actually
// visiting each product page (listing tiles don't carry case size or barcode).

const SELECTION_KEY = 'selection';

function isSamsListingPage() {
  const { hostname, pathname } = window.location;
  if (!hostname.includes('samsclub.com')) return false;
  // Product pages have their own single-item flow.
  return !/^\/(ip|p)\//.test(pathname);
}

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
    if (/\/(ip|p)\/.+\/\d+/.test(url.pathname)) {
      return `${url.origin}${url.pathname}`;
    }
  }

  // Last resort: Midas hrefs also carry the plain product path at the very end.
  const m = raw.match(/\/(?:ip|p)\/[^?&#]+?\/\d+/);
  return m ? `${window.location.origin}${m[0]}` : null;
}

// "/ip/IQBAR-Plant-Protein-Bar-Variety-Pack-12-pk/13576516009" -> "IQBAR Plant Protein Bar Variety Pack 12 pk"
function nameFromUrl(url) {
  const m = url.match(/\/(?:ip|p)\/([^/]+)\/\d+/);
  return m ? decodeURIComponent(m[1]).replace(/-/g, ' ') : null;
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
  if (!isSamsListingPage()) return;

  const anchors = document.querySelectorAll('a[link-identifier]:not([data-vendrop-tile])');
  if (!anchors.length) return;

  injectSelectionStyles();
  const selection = await getSelection();
  let added = 0;
  let skipped = 0;

  anchors.forEach((anchor) => {
    const id = anchor.getAttribute('link-identifier');
    const url = resolveProductUrl(anchor);
    const mount = findTileMount(anchor);
    if (!id || !url || !mount) {
      skipped++;
      return;
    }

    anchor.setAttribute('data-vendrop-tile', id);

    // The anchor is an invisible click-capture overlay, so its own text is often
    // empty. The URL slug is a clean, always-present fallback — and it's only a
    // placeholder for the queue list; the real name comes from the product page.
    const name = anchor.textContent.trim() || nameFromUrl(url) || id;
    const item = { id, url, name };

    const box = document.createElement('label');
    box.className = 'vendrop-tile-check';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!selection[id];
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
    const id = box.parentElement?.querySelector('a[data-vendrop-tile]')?.getAttribute('data-vendrop-tile');
    const input = box.querySelector('input');
    if (!id || !input) return;
    input.checked = !!selection[id];
    box.classList.toggle('is-checked', input.checked);
  });
});

if (isSamsListingPage()) {
  decorateTiles();

  // Grids paginate, lazy-load, and re-render on SPA navigation, so keep watching.
  let pending = null;
  const observer = new MutationObserver(() => {
    clearTimeout(pending);
    pending = setTimeout(decorateTiles, 300);
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
