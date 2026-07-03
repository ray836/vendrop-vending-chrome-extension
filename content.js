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
    barcode: null,
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
    barcode: null,
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

    // Extract vendor SKU (Item Number)
    // Look for patterns like "Item #: 990000730" or "Item # 990000730"
    const bodyText = document.body.textContent;
    const itemNumberMatch = bodyText.match(/Item\s*#\s*:?\s*(\d{8,12})/i);
    if (itemNumberMatch) {
      productInfo.vendor_sku = itemNumberMatch[1];
    }

    // Fallback: Use URL identifier as vendor SKU
    if (!productInfo.vendor_sku && productInfo.url_identifier) {
      productInfo.vendor_sku = productInfo.url_identifier;
    }

    // Extract unit price (price per each) - optional field
    // Look for patterns like "$0.37/ea" or "$0.37 /ea"
    const unitPriceMatch = bodyText.match(/\$?(\d+\.\d{2})\s*\/\s*ea/i);
    if (unitPriceMatch) {
      productInfo.price_per_each = unitPriceMatch[1];
    }

    console.log('[VenDrop] Extracted Sam\'s Club product:', productInfo);
  } catch (error) {
    console.error('[VenDrop] Error extracting Sam\'s Club product:', error);
  }

  return productInfo;
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
    barcode: null,
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

    // Extract vendor SKU (Item Number)
    const bodyText = document.body.textContent;
    const itemNumberMatch = bodyText.match(/Item\s*#\s*:?\s*(\d{6,12})/i);
    if (itemNumberMatch) {
      productInfo.vendor_sku = itemNumberMatch[1];
    }

    // Fallback: Use URL identifier as vendor SKU
    if (!productInfo.vendor_sku && productInfo.url_identifier) {
      productInfo.vendor_sku = productInfo.url_identifier;
    }

    // Extract unit price (optional)
    const unitPriceMatch = bodyText.match(/\$?(\d+\.\d{2})\s*\/\s*(ea|each)/i);
    if (unitPriceMatch) {
      productInfo.price_per_each = unitPriceMatch[1];
    }

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
