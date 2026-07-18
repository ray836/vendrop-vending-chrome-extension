const FIELD_LABEL = {
  caseCost: 'price',
  caseSize: 'case size',
  images: 'images',
  components: 'assortment',
  name: 'name',
  description: 'description',
  barcode: 'barcode',
  vendorSku: 'SKU',
  image: 'main image',
  vendorAvailability: 'availability',
  vendorOnSale: 'sale status',
  vendorDeliveryEligible: 'delivery',
};

// UI Elements - Views
const settingsView = document.getElementById('settings-view');
const mainView = document.getElementById('main-view');
const notSupportedView = document.getElementById('not-supported-view');
const editFormView = document.getElementById('edit-form-view');
const orderView = document.getElementById('order-view');
const orderStatusTitle = document.getElementById('order-status-title');
const orderStatusMessage = document.getElementById('order-status-message');
const orderProgressWrap = document.getElementById('order-progress-wrap');
const orderProgressCount = document.getElementById('order-progress-count');
const orderProgressBar = document.getElementById('order-progress-bar');
const orderCurrentName = document.getElementById('order-current-name');
const orderCurrentAction = document.getElementById('order-current-action');
const cancelOrderBtn = document.getElementById('cancel-order-btn');
const openCartLink = document.getElementById('open-cart-link');
let latestCartPlacement = null;

// UI Elements - Settings
const catalogTokenInput = document.getElementById('catalog-token-input');
const apiUrlInput = document.getElementById('api-url-input');
const saveSettingsBtn = document.getElementById('save-settings-btn');

// UI Elements - Main View
const addProductBtn = document.getElementById('add-product-btn');
const editBtn = document.getElementById('edit-btn');
const btnText = document.getElementById('btn-text');
const btnSpinner = document.getElementById('btn-spinner');
const statusMessage = document.getElementById('status-message');
const retailerBadge = document.getElementById('retailer-badge');
const pageStatus = document.getElementById('page-status');
const productPreview = document.getElementById('product-preview');
const previewImg = document.getElementById('preview-img');
const previewName = document.getElementById('preview-name');
const previewPrice = document.getElementById('preview-price');
const assortmentPreview = document.getElementById('assortment-preview');

// UI Elements - Edit Form
const editRetailerBadge = document.getElementById('edit-retailer-badge');
const productForm = document.getElementById('product-form');
const editName = document.getElementById('edit-name');
const editImage = document.getElementById('edit-image');
const editImagePreview = document.getElementById('edit-image-preview');
const editImagePreviewContainer = document.getElementById('image-preview-container');
const editCaseCost = document.getElementById('edit-case-cost');
const editCaseSize = document.getElementById('edit-case-size');
const editPricePerEach = document.getElementById('edit-price-per-each');
const editPriceMultiplier = document.getElementById('edit-price-multiplier');
const editVendorSku = document.getElementById('edit-vendor-sku');
const editBarcode = document.getElementById('edit-barcode');
const editCategory = document.getElementById('edit-category');
const editRegion = document.getElementById('edit-region');
const editShelfLife = document.getElementById('edit-shelf-life');
const cancelEditBtn = document.getElementById('cancel-edit-btn');
const saveProductBtn = document.getElementById('save-product-btn');
const saveBtnText = document.getElementById('save-btn-text');
const saveBtnSpinner = document.getElementById('save-btn-spinner');
const editStatusMessage = document.getElementById('edit-status-message');

// Settings Links
const showSettingsLink = document.getElementById('show-settings-link');
const showSettingsLinkAlt = document.getElementById('show-settings-link-alt');
const showSettingsLinkEdit = document.getElementById('show-settings-link-edit');

// UI Elements - Catalog price sweep
const catalogUpdatePanel = document.getElementById('catalog-update-panel');
const updateCatalogBtn = document.getElementById('update-catalog-btn');
const updateProgress = document.getElementById('update-progress');
const updateProgressLabel = document.getElementById('update-progress-label');
const updateProgressCount = document.getElementById('update-progress-count');
const updateProgressBar = document.getElementById('update-progress-bar');
const updateCurrent = document.getElementById('update-current');
const cancelUpdateBtn = document.getElementById('cancel-update-btn');
const updateSummary = document.getElementById('update-summary');
const updateDuplicates = document.getElementById('update-duplicates');
const updateExtracted = document.getElementById('update-extracted');

// UI Elements - Listing-page selection queue
const selectionPanel = document.getElementById('selection-panel');
const selectionCount = document.getElementById('selection-count');
const selectionList = document.getElementById('selection-list');
const clearSelectionLink = document.getElementById('clear-selection-link');
const importSelectedBtn = document.getElementById('import-selected-btn');
const importProgress = document.getElementById('import-progress');
const importProgressLabel = document.getElementById('import-progress-label');
const importProgressCount = document.getElementById('import-progress-count');
const importProgressBar = document.getElementById('import-progress-bar');
const importCurrent = document.getElementById('import-current');
const cancelImportBtn = document.getElementById('cancel-import-btn');
const importSummary = document.getElementById('import-summary');
const importExtracted = document.getElementById('import-extracted');

// State
let currentPageInfo = null;
let currentProductData = null;
let settings = null;

// Initialize popup
async function init() {
  // Surfaced so it's obvious at a glance whether the loaded build is current.
  document.getElementById('version-badge').textContent = `v${chrome.runtime.getManifest().version}`;

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const currentTab = tabs[0];
  const cartProgress = await getCartPlacementProgress();
  const isFinishedCartJobTab = cartProgress?.done && cartProgress?.workTabId === currentTab?.id;
  if (cartProgress?.running || isFinishedCartJobTab || isVendropOrdersPage(currentTab?.url)) {
    showView('order');
    renderCartPlacement(cartProgress);
    window.setInterval(async () => renderCartPlacement(await getCartPlacementProgress()), 700);
    return;
  }

  // Load settings
  settings = await loadSettings();

  // Check if settings are configured
  if (!settings.catalogToken) {
    showView('settings');
    return;
  }

  // During either bulk job the active tab is our own work tab, so don't present it
  // as a product the user picked — show the run instead. (The popup stays open across
  // the work tab's navigations, so init() runs once; the poll keeps it current.)
  const [importing, refreshing] = await Promise.all([
    isImportRunning(),
    isRefreshRunning(),
  ]);
  if (importing || refreshing) {
    showView('main');
    showJobRunning(refreshing ? 'Refreshing catalog…' : 'Bulk import in progress…');
    return;
  }

  // Get current tab info
  if (!currentTab?.url) {
    showView('not-supported');
    return;
  }

  // Check if we're on a supported site
  const pageInfo = detectRetailer(currentTab.url);

  if (!pageInfo.supported) {
    showView('not-supported');
    return;
  }

  currentPageInfo = pageInfo;
  showView('main');
  updatePageInfo(pageInfo);

  // Get product info from content script
  try {
    const response = await chrome.tabs.sendMessage(currentTab.id, { type: 'GET_PRODUCT_INFO' });
    if (response?.success && response.productInfo) {
      currentProductData = response.productInfo;
      console.log('[VenDrop] Product data received:', currentProductData);

      // A browse/search grid isn't a single product — it's the multi-select flow,
      // so don't nag about the fields a listing page was never going to have.
      if (!currentProductData.name) {
        productPreview.classList.add('hidden');
        pageStatus.textContent = 'Check the products you want, then add them below.';
        addProductBtn.disabled = true;
        editBtn.disabled = true;
        return;
      }

      // Show preview
      showProductPreview(currentProductData);

      // Check if data is complete
      const missingFields = getMissingRequiredFields(currentProductData);

      if (missingFields.length > 0) {
        // Data incomplete - show message and enable edit button only
        pageStatus.textContent = `Missing: ${missingFields.join(', ')}. Please use Review/Edit.`;
        editBtn.disabled = false;
        addProductBtn.disabled = true;
      } else {
        // Data complete - enable both buttons
        pageStatus.textContent = `Ready to import from ${pageInfo.name}`;
        editBtn.disabled = false;
        addProductBtn.disabled = false;
      }
    }
  } catch (error) {
    console.log('Could not get product info from content script:', error);
    pageStatus.textContent = 'Unable to detect product information';
  }
}

function isVendropOrdersPage(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    const isProduction = parsed.hostname === 'vendash-v.vercel.app';
    return (isLocal || isProduction) && parsed.pathname.startsWith('/web/orders');
  } catch (e) {
    return false;
  }
}

function getCartPlacementProgress() {
  return chrome.runtime.sendMessage({ type: 'GET_CART_PLACEMENT_PROGRESS' })
    .then((response) => response?.progress || null)
    .catch(() => null);
}

function renderCartPlacement(progress) {
  latestCartPlacement = progress;
  const phases = {
    'loading-order': 'Loading order details…',
    'opening-cart-to-clear': 'Opening your existing Sam\'s Club cart…',
    'clearing-cart': 'Removing existing cart items…',
    'cart-cleared': 'Existing cart cleared',
    'adding-items': 'Adding cases to Sam\'s Club…',
    'opening-product': 'Opening the next product page…',
    'adding-current-item': 'Adding this product…',
    'item-complete': 'Product added to the cart',
    'opening-cart-to-update': 'Opening the cart to set quantities…',
    'updating-quantities': 'Setting final case quantities…',
    'quantities-updated': 'Case quantities updated',
    confirming: 'Finishing the cart handoff…',
    'opening-cart': 'Opening your Sam\'s Club cart…',
    complete: 'Cart ready',
    canceling: 'Canceling…',
    canceled: 'Cart placement canceled',
    failed: 'Cart placement stopped',
  };
  orderStatusTitle.textContent = progress?.running ? 'Sam\'s Club cart in progress' : (phases[progress?.phase] || 'Sam\'s Club ordering');
  orderStatusMessage.textContent = progress?.error || phases[progress?.phase] || 'Click Add to Sam\'s Cart on the Orders page to begin.';

  const total = Number(progress?.total || 0);
  const processed = Number(progress?.processed || 0);
  orderProgressWrap.classList.toggle('hidden', total === 0);
  const currentIndex = Number(progress?.currentIndex || 0);
  const activeItem = progress?.running && progress?.currentName;
  orderProgressCount.textContent = progress?.phase === 'clearing-cart'
    ? 'Preparing a clean cart'
    : activeItem
    ? `Item ${Math.min(total, currentIndex + 1)} of ${total}`
    : `${processed} of ${total} complete`;
  orderProgressBar.style.width = total ? `${Math.min(100, (processed / total) * 100)}%` : '0%';
  orderCurrentName.textContent = progress?.currentName || '';
  const quantity = Number(progress?.currentQuantity || 0);
  orderCurrentAction.textContent = progress?.phase === 'cart-cleared'
    ? `${Number(progress?.removedCartItems || 0)} existing cart product${Number(progress?.removedCartItems || 0) === 1 ? '' : 's'} removed`
    : progress?.phase === 'quantities-updated'
    ? `${Number(progress?.totalCases || 0)} total case${Number(progress?.totalCases || 0) === 1 ? '' : 's'} ready`
    : progress?.phase === 'adding-current-item' && quantity
    ? 'Adding this product…'
    : (phases[progress?.phase] || '');
  cancelOrderBtn.classList.toggle('hidden', !progress?.running);
  cancelOrderBtn.dataset.orderId = progress?.orderId || '';
  openCartLink.classList.toggle('hidden', progress?.phase !== 'complete');
}

openCartLink.addEventListener('click', async (event) => {
  event.preventDefault();
  const tabId = latestCartPlacement?.workTabId;
  if (tabId != null) {
    try {
      await chrome.tabs.update(tabId, { url: 'https://www.samsclub.com/cart', active: true });
      window.close();
      return;
    } catch (error) {
      // The work tab may have been closed; fall through and open a new cart tab.
    }
  }
  await chrome.tabs.create({ url: 'https://www.samsclub.com/cart', active: true });
  window.close();
});

cancelOrderBtn.addEventListener('click', async () => {
  const orderId = cancelOrderBtn.dataset.orderId;
  if (!orderId) return;
  await chrome.runtime.sendMessage({ type: 'CANCEL_CART_PLACEMENT', orderId });
  renderCartPlacement(await getCartPlacementProgress());
});

// Load settings from storage
async function loadSettings() {
  const result = await chrome.storage.sync.get(['catalogToken', 'apiUrl']);
  return {
    catalogToken: result.catalogToken || '',
    apiUrl: result.apiUrl || 'http://localhost:3000'
  };
}

// Save settings to storage
async function saveSettings(catalogToken, apiUrl) {
  await chrome.storage.sync.set({
    catalogToken,
    apiUrl
  });
}

// Detect retailer from URL
function detectRetailer(url) {
  if (url.includes('samsclub.com')) {
    return {
      supported: true,
      retailer: 'samsclub',
      name: "Sam's Club",
      url: url
    };
  } else if (url.includes('costco.com')) {
    return {
      supported: true,
      retailer: 'costco',
      name: 'Costco',
      url: url
    };
  }
  return { supported: false };
}

// Check which required fields are missing
function getMissingRequiredFields(productData) {
  const requiredFields = ['name', 'image', 'case_cost', 'case_size', 'vendor_sku'];
  const missing = [];

  for (const field of requiredFields) {
    if (!productData[field]) {
      missing.push(field.replace('_', ' '));
    }
  }

  return missing;
}

// Show specific view
function showView(viewName) {
  settingsView.classList.add('hidden');
  mainView.classList.add('hidden');
  notSupportedView.classList.add('hidden');
  editFormView.classList.add('hidden');
  orderView.classList.add('hidden');

  switch (viewName) {
    case 'settings':
      settingsView.classList.remove('hidden');
      if (settings) {
        catalogTokenInput.value = settings.catalogToken || '';
        apiUrlInput.value = settings.apiUrl || 'http://localhost:3000';
      }
      break;
    case 'main':
      mainView.classList.remove('hidden');
      break;
    case 'not-supported':
      notSupportedView.classList.remove('hidden');
      break;
    case 'edit':
      editFormView.classList.remove('hidden');
      break;
    case 'order':
      orderView.classList.remove('hidden');
      break;
  }

  // The catalog price sweep can run from any page, so keep it available on both
  // the main and not-supported views (but not while configuring / editing).
  const showPanel = viewName === 'main' || viewName === 'not-supported';
  catalogUpdatePanel.classList.toggle('hidden', !showPanel);
  if (showPanel) {
    pollProgressOnce();
    renderSelection();
    pollImportOnce();
  } else {
    selectionPanel.classList.add('hidden');
  }
}

// Update page info in main view
function updatePageInfo(pageInfo) {
  retailerBadge.textContent = pageInfo.name;
  retailerBadge.className = `retailer-badge ${pageInfo.retailer}`;
  pageStatus.textContent = `Ready to import from ${pageInfo.name}`;
}

// Show product preview
function showProductPreview(productData) {
  if (productData.image) {
    previewImg.src = productData.image;
  }
  if (productData.name) {
    previewName.textContent = productData.name;
  }
  if (productData.case_cost) {
    previewPrice.textContent = `$${productData.case_cost}`;
  }
  productPreview.classList.remove('hidden');
  assortmentPreview.classList.add('hidden');
}

function renderAssortmentPreview(product) {
  if (!product || product.assortmentStatus === 'not_variety') {
    assortmentPreview.classList.add('hidden');
    assortmentPreview.innerHTML = '';
    return;
  }
  const components = (product.components || []).filter((component) => component.active !== false);
  const needsReview = product.assortmentStatus === 'needs_review';
  const productDetailUrl = buildProductDetailUrl(product.id);
  assortmentPreview.className = `assortment-preview${needsReview ? ' needs-review' : ''}`;
  assortmentPreview.innerHTML = `
    <div class="assortment-head">
      <span>Variety case</span>
      <span class="assortment-status">${needsReview ? 'Needs review' : 'Confirmed'}</span>
    </div>
    ${components.length ? `<ul class="assortment-list">${components.map((component) => `
      <li><span>${escapeHtml(component.name)}</span><strong>${component.quantityPerCase ?? '?'}</strong></li>
    `).join('')}</ul>` : '<p class="panel-hint">No reliable component list was extracted. Review this assortment in the catalog.</p>'}
    ${productDetailUrl ? `
      <a class="assortment-detail-link" href="${escapeHtml(productDetailUrl)}" target="_blank" rel="noopener noreferrer">
        Open product details
        <span aria-hidden="true">↗</span>
      </a>
    ` : ''}
  `;
  assortmentPreview.classList.remove('hidden');
}

function buildProductDetailUrl(standardProductId) {
  if (!standardProductId || !settings?.apiUrl) return null;

  try {
    return new URL(
      `/web/products/catalog/${encodeURIComponent(standardProductId)}`,
      settings.apiUrl
    ).toString();
  } catch {
    return null;
  }
}

// Populate edit form with product data
function populateEditForm(productData) {
  editName.value = productData.name || '';
  editImage.value = productData.image || '';
  editCaseCost.value = productData.case_cost || '';
  editCaseSize.value = productData.case_size || '';
  editPricePerEach.value = productData.price_per_each || '';
  editVendorSku.value = productData.vendor_sku || '';
  editBarcode.value = productData.barcode || '';
  editRegion.value = productData.region || '';
  editShelfLife.value = productData.shelf_life_days || '';

  // Show image preview if URL provided
  if (productData.image) {
    editImagePreview.src = productData.image;
    editImagePreviewContainer.classList.remove('hidden');
  }

  // Set retailer badge
  if (currentPageInfo) {
    editRetailerBadge.textContent = currentPageInfo.name;
    editRetailerBadge.className = `retailer-badge ${currentPageInfo.retailer}`;
  }
}

// Validate edit form
function validateForm() {
  let isValid = true;

  // Clear previous errors
  document.querySelectorAll('.field-error').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('input, select').forEach(el => el.classList.remove('error'));

  // Validate required fields
  if (!editName.value.trim()) {
    document.getElementById('error-name').classList.remove('hidden');
    editName.classList.add('error');
    isValid = false;
  }

  if (!editImage.value.trim()) {
    document.getElementById('error-image').classList.remove('hidden');
    editImage.classList.add('error');
    isValid = false;
  }

  if (!editCaseCost.value || parseFloat(editCaseCost.value) <= 0) {
    document.getElementById('error-case-cost').classList.remove('hidden');
    editCaseCost.classList.add('error');
    isValid = false;
  }

  if (!editCaseSize.value || parseInt(editCaseSize.value) <= 0) {
    document.getElementById('error-case-size').classList.remove('hidden');
    editCaseSize.classList.add('error');
    isValid = false;
  }

  if (!editVendorSku.value.trim()) {
    document.getElementById('error-vendor-sku').classList.remove('hidden');
    editVendorSku.classList.add('error');
    isValid = false;
  }

  return isValid;
}

// Show status message
function showStatus(message, type = 'success', targetElement = statusMessage) {
  targetElement.textContent = message;
  targetElement.className = type;
  targetElement.classList.remove('hidden');

  setTimeout(() => {
    targetElement.classList.add('hidden');
  }, 5000);
}

// Set button loading state
function setButtonLoading(button, textElement, spinnerElement, loading) {
  if (loading) {
    button.disabled = true;
    textElement.textContent = 'Saving...';
    spinnerElement.classList.remove('hidden');
  } else {
    button.disabled = false;
    textElement.textContent = textElement.id === 'btn-text' ? 'Add to Catalog' : 'Save to Catalog';
    spinnerElement.classList.add('hidden');
  }
}

// Save product to the shared catalog API.
// The catalog is app-maintained and global (not org-scoped), so we authenticate
// with the maintainer token as a Bearer header instead of sending an org ID.
function isLocalApiUrl(apiUrl) {
  try {
    const host = new URL(apiUrl).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch (_) {
    return false;
  }
}

function unreachableApiMessage(apiUrl) {
  return isLocalApiUrl(apiUrl)
    ? 'Could not reach the local VenDasher server. Make sure npm run dev is running, then try again.'
    : `Could not reach the VenDasher API at ${apiUrl}. Check the URL and your connection.`;
}

async function readCatalogApiResponse(response, apiUrl) {
  const body = await response.text();
  try {
    return JSON.parse(body);
  } catch (_) {
    if (isLocalApiUrl(apiUrl) && response.status >= 500) {
      throw new Error(`The local VenDasher server returned error ${response.status}. Restart npm run dev and try again.`);
    }
    throw new Error(`The VenDasher API returned ${response.status} with an invalid response. Try again shortly.`);
  }
}

async function saveProduct(productData) {
  if (!settings) return { success: false, error: 'Settings not loaded' };
  if (!settings.catalogToken) {
    return { success: false, error: 'Missing catalog maintainer token — open Settings' };
  }

  try {
    const response = await fetch(`${settings.apiUrl}/api/catalog`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.catalogToken}`,
      },
      body: JSON.stringify({
        name: productData.name,
        image: productData.image,
        caseCost: parseFloat(productData.case_cost),
        caseSize: parseInt(productData.case_size),
        vendorSku: productData.vendor_sku,
        barcode: productData.barcode || null,
        vendorLink: productData.url,
        category: productData.category || 'Snacks',
        recommendedPriceMultiplier: productData.price_multiplier || 1.5,
        region: productData.region || null,
        shelfLifeDays: productData.shelf_life_days ? parseInt(productData.shelf_life_days) : null,
        images: productData.images || [],
        description: productData.description || null,
        vendorAvailability: productData.vendor_availability || 'unknown',
        vendorOnSale: productData.vendor_on_sale === true,
        vendorDeliveryEligible: productData.vendor_delivery_eligible,
      })
    });

    const data = await readCatalogApiResponse(response, settings.apiUrl);

    if (response.ok && data.success) {
      return { success: true, data };
    } else if (response.status === 401) {
      throw new Error('Unauthorized — check your catalog maintainer token in Settings');
    } else {
      throw new Error(data.error || 'Failed to save product');
    }
  } catch (error) {
    console.error('Error saving product:', error);
    const message = error instanceof TypeError
      ? unreachableApiMessage(settings.apiUrl)
      : (error.message || 'Failed to save product');
    return { success: false, error: message };
  }
}

// Event Listeners - Settings
saveSettingsBtn.addEventListener('click', async () => {
  const catalogToken = catalogTokenInput.value.trim();
  const apiUrl = apiUrlInput.value.trim();

  if (!catalogToken) {
    alert('Please enter your catalog maintainer token');
    return;
  }

  if (!apiUrl) {
    alert('Please enter the API URL');
    return;
  }

  await saveSettings(catalogToken, apiUrl);
  settings = { catalogToken, apiUrl };

  // Re-initialize to show main view
  init();
});

// Settings links
[showSettingsLink, showSettingsLinkAlt, showSettingsLinkEdit].forEach(link => {
  link?.addEventListener('click', (e) => {
    e.preventDefault();
    showView('settings');
  });
});

// Event Listeners - Main View
editBtn.addEventListener('click', () => {
  populateEditForm(currentProductData);
  showView('edit');
});

addProductBtn.addEventListener('click', async () => {
  if (!currentProductData) return;

  setButtonLoading(addProductBtn, btnText, btnSpinner, true);
  statusMessage.classList.add('hidden');

  const result = await saveProduct(currentProductData);

  if (result.success) {
    const existed = result.data.action === 'exists';
    const msg = existed
      ? `✓ Already in catalog: ${result.data.product.name}`
      : result.data.action === 'updated'
        ? `✓ Refreshed catalog product: ${result.data.product.name}`
        : `✓ Added to catalog: ${result.data.product.name}!`;
    showStatus(msg, 'success');
    renderAssortmentPreview(result.data.product);

    // Disable buttons after successful save
    setTimeout(() => {
      addProductBtn.disabled = true;
      editBtn.disabled = true;
      btnText.textContent = existed ? 'Already in Catalog' : 'Added to Catalog';
    }, 2000);
  } else {
    showStatus(`✗ Error: ${result.error}`, 'error');
  }

  setButtonLoading(addProductBtn, btnText, btnSpinner, false);
});

// Event Listeners - Edit Form
editImage.addEventListener('input', () => {
  const url = editImage.value.trim();
  if (url) {
    editImagePreview.src = url;
    editImagePreviewContainer.classList.remove('hidden');
  } else {
    editImagePreviewContainer.classList.add('hidden');
  }
});

cancelEditBtn.addEventListener('click', () => {
  showView('main');
});

productForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  if (!validateForm()) {
    showStatus('Please fix the errors above', 'error', editStatusMessage);
    return;
  }

  setButtonLoading(saveProductBtn, saveBtnText, saveBtnSpinner, true);
  editStatusMessage.classList.add('hidden');

  // Collect form data
  const formData = {
    ...currentProductData,
    name: editName.value.trim(),
    image: editImage.value.trim(),
    case_cost: editCaseCost.value,
    case_size: editCaseSize.value,
    price_per_each: editPricePerEach.value || null,
    vendor_sku: editVendorSku.value.trim(),
    barcode: editBarcode.value.trim() || null,
    category: editCategory.value,
    price_multiplier: parseFloat(editPriceMultiplier.value) || 1.5,
    region: editRegion.value.trim() || null,
    shelf_life_days: editShelfLife.value.trim() || null
  };

  const result = await saveProduct(formData);

  if (result.success) {
    const existed = result.data.action === 'exists';
    const msg = existed
      ? `✓ Already in catalog: ${result.data.product.name}`
      : result.data.action === 'updated'
        ? `✓ Refreshed catalog product: ${result.data.product.name}`
        : `✓ Added to catalog: ${result.data.product.name}!`;
    showStatus(msg, 'success', editStatusMessage);
    renderAssortmentPreview(result.data.product);

    // Go back to main view after short delay
    setTimeout(() => {
      showView('main');
      // Update current product data
      currentProductData = formData;
      // Disable buttons
      addProductBtn.disabled = true;
      editBtn.disabled = true;
      btnText.textContent = existed ? 'Already in Catalog' : 'Added to Catalog';
    }, 2000);
  } else {
    showStatus(`✗ Error: ${result.error}`, 'error', editStatusMessage);
  }

  setButtonLoading(saveProductBtn, saveBtnText, saveBtnSpinner, false);
});

// ===== Catalog price sweep (bulk update) =====
// The job runs in the background service worker; the popup only triggers it and
// polls progress from storage, so closing/reopening the popup is safe.
let progressPollTimer = null;

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function renderProgress(p) {
  refreshIsRunning = !!(p && p.running);
  syncJobChrome();

  // No job has ever run: just show the button.
  if (!p) {
    updateProgress.classList.add('hidden');
    updateCatalogBtn.classList.remove('hidden');
    updateCatalogBtn.disabled = false;
    return;
  }

  if (p.running) {
    // The refresh owns the active tab — keep the single-product UI and the selection
    // queue out of the way, so the run is the only thing on screen.
    showJobRunning('Refreshing catalog…');
    selectionPanel.classList.add('hidden');

    updateCatalogBtn.classList.add('hidden');
    updateSummary.classList.add('hidden');
    updateDuplicates.classList.add('hidden');
    updateProgress.classList.remove('hidden');

    const total = p.total || 0;
    const processed = p.processed || 0;
    const pct = total > 0 ? Math.round((processed / total) * 100) : (p.phase === 'loading' ? 6 : 0);
    updateProgressBar.style.width = `${pct}%`;
    updateProgressCount.textContent = `${processed}/${total}`;
    updateProgressLabel.textContent = p.canceling
      ? 'Canceling…'
      : p.phase === 'loading'
      ? 'Loading catalog…'
      : p.phase === 'duplicates'
      ? 'Checking for duplicates…'
      : 'Refreshing catalog…';
    updateCurrent.textContent = p.currentName ? `Checking: ${p.currentName}` : '';
    renderFeedInto(updateExtracted, p.feed);
    cancelUpdateBtn.disabled = !!p.canceling;
    return;
  }

  // Finished (or interrupted): show the button again + a summary.
  updateProgress.classList.add('hidden');
  updateCatalogBtn.classList.remove('hidden');
  updateCatalogBtn.disabled = false;
  // Keep the feed up after the run — it's the record of what just happened.
  renderFeedInto(updateExtracted, p.feed);
  if (p.done) renderSummary(p);
}

function renderSummary(p) {
  const title = p.error
    ? 'Refresh failed'
    : p.canceled
    ? 'Refresh canceled'
    : p.interrupted
    ? 'Refresh interrupted'
    : 'Refresh complete';

  let errorsHtml = '';
  if (p.error) {
    errorsHtml = `<div class="summary-errors">${escapeHtml(p.error)}</div>`;
  } else if (p.errors && p.errors.length) {
    const rows = p.errors.slice(0, 5)
      .map((e) => `${escapeHtml(e.name || 'item')}: ${escapeHtml(e.error)}`)
      .join('<br>');
    const more = p.errors.length > 5 ? `<br>+${p.errors.length - 5} more` : '';
    errorsHtml = `<div class="summary-errors">${rows}${more}</div>`;
  }

  updateSummary.innerHTML = `
    <div class="summary-title">${title}</div>
    <div class="summary-row summary-updated"><span>Updated</span><span class="val">${p.updated || 0}</span></div>
    <div class="summary-row"><span>Unchanged</span><span class="val">${p.unchanged || 0}</span></div>
    <div class="summary-row"><span>Skipped (no vendor link)</span><span class="val">${p.skipped || 0}</span></div>
    <div class="summary-row summary-failed"><span>Failed</span><span class="val">${p.failed || 0}</span></div>
    ${renderChanges(p.changes)}
    ${renderMerged(p.merged)}
    ${errorsHtml}
  `;
  updateSummary.classList.remove('hidden');
  renderDuplicates(p.duplicates);
}

// Auto-merges are destructive and permanent, so they're always reported — never a
// silent side effect of hitting Refresh.
function renderMerged(merged) {
  if (!merged || !merged.length) return '';

  const rows = merged.map((m) => {
    const moved = m.reassignedClones
      ? ` &middot; ${m.reassignedClones} org product${m.reassignedClones === 1 ? '' : 's'} moved over`
      : '';
    return `
      <li class="result-item">
        <div class="result-body">
          <div class="result-name">${escapeHtml(m.kept)}</div>
          <div class="result-meta">
            <span>kept the ${formatDate(m.keptAdded)} entry, removed the ${formatDate(m.deletedAdded)} one${moved}</span>
          </div>
        </div>
      </li>`;
  }).join('');

  return `
    <div class="summary-row summary-merged"><span>Duplicates merged</span><span class="val">${merged.length}</span></div>
    <details class="result-details">
      <summary>View ${merged.length} merge${merged.length === 1 ? '' : 's'}</summary>
      <ul class="result-list">${rows}</ul>
    </details>
  `;
}

// What actually moved, per item — "3 updated" alone doesn't tell you whether a
// price shifted or a photo was swapped.
function renderChanges(changes) {
  if (!changes || !changes.length) return '';

  const rows = changes.map((c) => {
    const fields = (c.fields || []).map((f) => FIELD_LABEL[f] || f).join(', ');
    const priceMoved =
      (c.fields || []).includes('caseCost') && typeof c.previousCaseCost === 'number';
    const delta = priceMoved
      ? `<div class="result-change">Case cost ${money(c.previousCaseCost)} &rarr; ${money(c.caseCost)}${
          typeof c.recommendedPrice === 'number' ? ` &middot; sell ${money(c.recommendedPrice)}` : ''
        }</div>`
      : '';
    return `
      <li class="result-item">
        <div class="result-body">
          <div class="result-name">${escapeHtml(c.name || 'Unnamed')}</div>
          <div class="result-meta"><span>${escapeHtml(fields)}</span></div>
          ${delta}
        </div>
      </li>`;
  }).join('');

  return `
    <details class="result-details">
      <summary>View ${changes.length} change${changes.length === 1 ? '' : 's'}</summary>
      <ul class="result-list">${rows}</ul>
    </details>
  `;
}

// Suspected duplicate rows, flagged but never auto-deleted — a false positive here
// would delete a real product, so the choice stays with the maintainer.
function renderDuplicates(groups) {
  if (!groups || !groups.length) {
    updateDuplicates.classList.add('hidden');
    return;
  }

  updateDuplicates.innerHTML = `
    <div class="summary-title">Needs your call (${groups.length})</div>
    <p class="panel-hint">Exact barcode matches were merged automatically. These matched on name and case size only — a rule loose enough to catch two genuinely different products — so the choice is yours. Deleting is safe either way: org products move onto the row you keep, and no sales history is lost.</p>
    ${groups.map((g, gi) => {
      // The row an org has actually picked up is the one worth keeping, so surface it.
      const inUse = (prod) => (prod.usage?.clones || 0) > 0 || (prod.usage?.unitsSold || 0) > 0;
      return `
      <div class="dup-group">
        <div class="dup-reason">${g.reason === 'barcode' ? 'Same barcode' : 'Same name + case size'}</div>
        ${g.products.map((prod) => `
          <div class="dup-row">
            <div class="dup-body">
              <div class="result-name">${escapeHtml(prod.name)}</div>
              <div class="result-meta">
                <span>${money(prod.caseCost)} / ${prod.caseSize} ct</span>
                <span>Added ${formatDate(prod.createdAt)}</span>
              </div>
              <div class="result-meta">
                ${usageLabel(prod.usage)}
                ${inUse(prod) ? '<span class="dup-inuse">in use</span>' : ''}
              </div>
            </div>
            <button class="dup-delete" data-group="${gi}" data-id="${escapeHtml(prod.id)}">Delete</button>
          </div>
        `).join('')}
      </div>
    `;
    }).join('')}
  `;

  updateDuplicates.querySelectorAll('.dup-delete').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const group = groups[Number(btn.dataset.group)];
      // The survivor is whichever row in the group we're not deleting.
      const keep = group.products.find((prod) => prod.id !== id);

      btn.disabled = true;
      btn.textContent = 'Deleting…';
      const resp = await chrome.runtime.sendMessage({
        type: 'DELETE_DUPLICATE',
        id,
        mergeIntoId: keep ? keep.id : null,
      });

      if (resp && resp.success) {
        pollProgressOnce(); // re-renders from the trimmed duplicate list
      } else {
        btn.disabled = false;
        btn.textContent = 'Delete';
        showStatus(`✗ ${(resp && resp.error) || 'Delete failed'}`, 'error');
      }
    });
  });

  updateDuplicates.classList.remove('hidden');
}

async function pollProgressOnce() {
  let p = null;
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'GET_UPDATE_PROGRESS' });
    p = resp && resp.progress;
  } catch (e) {
    // Background worker asleep or no job yet — treat as idle.
  }
  renderProgress(p);

  const running = !!(p && p.running);
  if (running && !progressPollTimer) {
    progressPollTimer = setInterval(pollProgressOnce, 800);
  } else if (!running && progressPollTimer) {
    clearInterval(progressPollTimer);
    progressPollTimer = null;
  }
}

updateCatalogBtn.addEventListener('click', async () => {
  updateSummary.classList.add('hidden');
  updateCatalogBtn.disabled = true;
  try {
    await chrome.runtime.sendMessage({ type: 'START_CATALOG_UPDATE' });
  } catch (e) {
    // ignore — poll will reflect state
  }
  pollProgressOnce();
});

cancelUpdateBtn.addEventListener('click', async () => {
  cancelUpdateBtn.disabled = true;
  try {
    await chrome.runtime.sendMessage({ type: 'CANCEL_CATALOG_UPDATE' });
  } catch (e) {
    // ignore
  }
});

// ===== Listing-page selection queue =====
// Tiles checked on a browse/search grid land in storage.local. Importing them
// runs in the background worker (foreground tab per product), so the popup only
// triggers it and polls progress.
let importPollTimer = null;
let importState = null;

async function isRefreshRunning() {
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'GET_UPDATE_PROGRESS' });
    return !!(resp && resp.progress && resp.progress.running);
  } catch (e) {
    return false; // Background worker asleep — nothing is running.
  }
}

// A bulk job owns the active tab. Strip the single-product UI so a stale preview of
// whatever page the job happens to be on can't be mistaken for the current page —
// or, worse, imported by an Add button that's still live.
function showJobRunning(label) {
  retailerBadge.textContent = "Sam's Club";
  retailerBadge.className = 'retailer-badge samsclub';
  productPreview.classList.add('hidden');
  pageStatus.textContent = label;
  addProductBtn.disabled = true;
  editBtn.disabled = true;
}

// While a job runs, the only thing worth screen space is the run itself. `job-running`
// on <body> collapses the page header, the disabled Add/Review buttons, the settings
// link and the panel blurb (see popup.css), so the live product card fits without
// scrolling. Tracked per job so one finishing doesn't un-collapse while the other runs.
let refreshIsRunning = false;
let importIsRunning = false;

function syncJobChrome() {
  document.body.classList.toggle('job-running', refreshIsRunning || importIsRunning);
}

async function isImportRunning() {
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'GET_IMPORT_PROGRESS' });
    return !!(resp && resp.progress && resp.progress.running);
  } catch (e) {
    return false; // Background worker asleep — nothing is running.
  }
}

function syncSelectionPanel(count) {
  const visible = count > 0 || !!(importState && (importState.running || importState.done));
  selectionPanel.classList.toggle('hidden', !visible);
}

async function renderSelection() {
  const r = await chrome.storage.local.get('selection');
  const items = Object.values(r.selection || {});

  selectionCount.textContent = `${items.length} selected`;
  selectionList.innerHTML = '';

  items.forEach((item) => {
    const li = document.createElement('li');

    const name = document.createElement('span');
    name.className = 'selection-name';
    name.textContent = item.name || item.id;
    name.title = item.name || '';

    const remove = document.createElement('button');
    remove.className = 'selection-remove';
    remove.textContent = '✕';
    remove.title = 'Remove';
    remove.addEventListener('click', async () => {
      const cur = await chrome.storage.local.get('selection');
      const selection = cur.selection || {};
      delete selection[item.id];
      await chrome.storage.local.set({ selection });
      renderSelection();
    });

    li.appendChild(name);
    li.appendChild(remove);
    selectionList.appendChild(li);
  });

  const running = !!(importState && importState.running);
  importSelectedBtn.disabled = items.length === 0 || running;
  importSelectedBtn.textContent = items.length
    ? `Add ${items.length} to Catalog`
    : 'Add Selected to Catalog';

  syncSelectionPanel(items.length);
}

function renderImportProgress(p) {
  importState = p;
  importIsRunning = !!(p && p.running);
  syncJobChrome();

  if (!p) {
    importProgress.classList.add('hidden');
    importSelectedBtn.classList.remove('hidden');
    return;
  }

  if (p.running) {
    importSelectedBtn.classList.add('hidden');
    importSummary.classList.add('hidden');
    importProgress.classList.remove('hidden');

    const total = p.total || 0;
    const processed = p.processed || 0;
    importProgressBar.style.width = `${total > 0 ? Math.round((processed / total) * 100) : 0}%`;
    importProgressCount.textContent = `${processed}/${total}`;
    importProgressLabel.textContent = p.canceling ? 'Canceling…' : 'Importing…';
    importCurrent.textContent = p.currentName ? `Visiting: ${p.currentName}` : '';
    renderFeedInto(importExtracted, p.feed);
    cancelImportBtn.disabled = !!p.canceling;
    return;
  }

  importProgress.classList.add('hidden');
  importSelectedBtn.classList.remove('hidden');
  renderFeedInto(importExtracted, p.feed);
  if (p.done) renderImportSummary(p);
}

function renderImportSummary(p) {
  const title = p.error
    ? 'Import failed'
    : p.canceled
    ? 'Import canceled'
    : p.interrupted
    ? 'Import interrupted'
    : 'Import complete';

  let errorsHtml = '';
  if (p.error) {
    errorsHtml = `<div class="summary-errors">${escapeHtml(p.error)}</div>`;
  } else if (p.errors && p.errors.length) {
    const rows = p.errors.slice(0, 5)
      .map((e) => `${escapeHtml(e.name || 'item')}: ${escapeHtml(e.error)}`)
      .join('<br>');
    const more = p.errors.length > 5 ? `<br>+${p.errors.length - 5} more` : '';
    errorsHtml = `<div class="summary-errors">${rows}${more}</div>`;
  }

  importSummary.innerHTML = `
    <div class="summary-title">${title}</div>
    <div class="summary-row summary-added"><span>Added</span><span class="val">${p.added || 0}</span></div>
    <div class="summary-row summary-updated"><span>Updated (price changed)</span><span class="val">${p.updated || 0}</span></div>
    <div class="summary-row"><span>Unchanged</span><span class="val">${p.existed || 0}</span></div>
    <div class="summary-row summary-failed"><span>Failed</span><span class="val">${p.failed || 0}</span></div>
    ${renderResultsDetails(p.results)}
    ${errorsHtml}
  `;
  importSummary.classList.remove('hidden');
}

const KIND_LABEL = { added: 'Added', updated: 'Updated', existed: 'Unchanged', failed: 'Failed' };

// What the extractor actually read off the page, held on screen briefly after
// each item so a bad scrape is visible as it happens rather than in the summary.
// A running log of everything the job has processed, newest first. Each item takes
// ~5s to visit and scrape, so a card that cleared itself left the popup blank most of
// the time. Nothing is cleared here — results stack up and stay readable.
// Rows already on screen, per container. The popup re-polls every 800ms, and rebuilding
// innerHTML each time re-created every node — which re-fired the entry animation and
// forced the thumbnails to reload, so the whole list visibly blinked once a second.
// Only genuinely new entries get inserted now; existing rows are never touched.
const feedRendered = new Map();

const feedKey = (x) => `${x.at}|${x.name}`;

function renderFeedInto(el, feed) {
  if (!el) return;

  if (!feed || !feed.length) {
    el.classList.add('hidden');
    el.innerHTML = '';
    feedRendered.delete(el); // a new run resets the feed — start clean
    return;
  }

  let seen = feedRendered.get(el);
  if (!seen) {
    seen = new Set();
    feedRendered.set(el, seen);
    el.innerHTML = '';
  }

  // The feed is newest-first. Walk it oldest-to-newest and prepend, so the newest
  // entry ends up on top and each new row animates in exactly once.
  for (let i = feed.length - 1; i >= 0; i--) {
    const x = feed[i];
    const key = feedKey(x);
    if (seen.has(key)) continue;
    seen.add(key);

    const wrapper = document.createElement('div');
    wrapper.innerHTML = renderFeedItem(x);
    const node = wrapper.firstElementChild;
    if (node) el.prepend(node);
  }

  el.classList.remove('hidden');
}

function renderFeedItem(x) {
  const changed = Array.isArray(x.changed)
    ? x.changed.length
      ? `<span class="feed-changed">${escapeHtml(
          x.changed.map((f) => FIELD_LABEL[f] || f).join(', ')
        )}</span>`
      : '<span class="feed-nochange">no changes</span>'
    : '';

  const priceMoved =
    Array.isArray(x.changed) && x.changed.includes('caseCost') &&
    typeof x.previousCaseCost === 'number';

  return `
    <div class="feed-item">
      ${x.image ? `<img class="feed-thumb" src="${escapeHtml(x.image)}" alt="">` : '<div class="feed-thumb"></div>'}
      <div class="feed-body">
        <div class="feed-name">${escapeHtml(x.name || 'Unnamed')}</div>
        <div class="feed-meta">
          <span class="result-tag result-${x.outcome}">${KIND_LABEL[x.outcome] || x.outcome}</span>
          ${changed}
        </div>
        <div class="feed-meta feed-facts">
          <span>${x.caseCost ? `$${escapeHtml(String(x.caseCost))}` : '<em>no price</em>'}</span>
          <span>${x.caseSize ? `${escapeHtml(String(x.caseSize))} ct` : '<em>no size</em>'}</span>
          ${x.barcode ? `<span>${escapeHtml(x.barcode)}</span>` : ''}
        </div>
        ${renderAssortmentInline(x)}
        ${priceMoved ? `<div class="feed-delta">${money(x.previousCaseCost)} &rarr; ${money(parseFloat(x.caseCost))}${
          typeof x.recommendedPrice === 'number' ? ` &middot; sell ${money(x.recommendedPrice)}` : ''
        }</div>` : ''}
        ${x.error ? `<div class="feed-error">${escapeHtml(x.error)}</div>` : ''}
      </div>
    </div>`;
}

function renderAssortmentInline(value) {
  if (!value || !value.assortmentStatus || value.assortmentStatus === 'not_variety') return '';
  const components = (value.components || []).filter((component) => component.active !== false);
  const total = components.reduce((sum, component) => sum + (Number(component.quantityPerCase) || 0), 0);
  const label = value.assortmentStatus === 'confirmed'
    ? `Variety confirmed · ${components.length} components · ${total} total`
    : `Variety needs review · ${components.length} components`;
  return `<div class="${value.assortmentStatus === 'confirmed' ? 'extract-changed' : 'extract-error'}">${escapeHtml(label)}</div>`;
}

function renderExtracted(x) {
  renderExtractedInto(importExtracted, x);
}

function renderExtractedInto(el, x) {
  if (!el) return;
  if (!x) {
    el.classList.add('hidden');
    return;
  }

  const field = (label, value) => `
    <div class="extract-row">
      <span class="extract-label">${label}</span>
      <span class="extract-value ${value ? '' : 'missing'}">${value ? escapeHtml(String(value)) : 'not found'}</span>
    </div>`;

  // On a refresh, the headline is what MOVED — that's the whole point of the run.
  const changedHtml = Array.isArray(x.changed)
    ? x.changed.length
      ? `<div class="extract-changed">Changed: ${escapeHtml(
          x.changed.map((f) => FIELD_LABEL[f] || f).join(', ')
        )}</div>`
      : '<div class="extract-nochange">No changes</div>'
    : '';

  el.innerHTML = `
    <div class="extract-head">
      ${x.image ? `<img class="extract-thumb" src="${escapeHtml(x.image)}" alt="">` : '<div class="extract-thumb"></div>'}
      <div>
        <div class="extract-name">${escapeHtml(x.name || 'Unnamed')}</div>
        <span class="result-tag result-${x.outcome}">${KIND_LABEL[x.outcome] || x.outcome}</span>
      </div>
    </div>
    ${changedHtml}
    ${field('Case cost', x.caseCost ? `$${x.caseCost}` : null)}
    ${field('Case size', x.caseSize)}
    ${field('SKU (dedupe key)', x.vendorSku)}
    ${field('Item #', x.itemNumber)}
    ${field('Barcode', x.barcode)}
    ${x.pricePerEach ? field('Unit price', `$${x.pricePerEach}`) : ''}
    ${x.error ? `<div class="extract-error">${escapeHtml(x.error)}</div>` : ''}
  `;
  el.classList.remove('hidden');
}

function money(n) {
  return typeof n === 'number' ? `$${n.toFixed(2)}` : '—';
}

function formatDate(iso) {
  if (!iso) return 'unknown';
  const d = new Date(iso);
  return isNaN(d) ? 'unknown' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// Sales only reach a catalog row through an org product cloned from it, so a row with
// no clones can never have sales — say "not picked by any org" rather than a bare "0".
function usageLabel(u) {
  if (!u || !u.clones) return '<span class="dup-unused">Not picked by any org</span>';

  const orgs = `${u.clones} org product${u.clones === 1 ? '' : 's'}`;
  const sales = u.unitsSold
    ? `${u.unitsSold} sold${u.lastSaleAt ? `, last ${formatDate(u.lastSaleAt)}` : ''}`
    : 'no sales yet';
  return `<span>${orgs} &middot; ${sales}</span>`;
}

// Collapsed by default: the counts are the headline, the per-item detail is there
// when you want to check what actually landed.
function renderResultsDetails(results) {
  if (!results || !results.length) return '';

  const rows = results.map((r) => {
    const unit = typeof r.caseCost === 'number' && r.caseSize
      ? ` &middot; ${money(r.caseCost / r.caseSize)}/ea`
      : '';
    const priceChange = r.kind === 'updated' && typeof r.previousCaseCost === 'number'
      ? `<div class="result-change">Case cost ${money(r.previousCaseCost)} &rarr; ${money(r.caseCost)}</div>`
      : '';

    return `
      <li class="result-item">
        ${r.image ? `<img class="result-thumb" src="${escapeHtml(r.image)}" alt="">` : '<div class="result-thumb"></div>'}
        <div class="result-body">
          <div class="result-name">${escapeHtml(r.name || 'Unnamed')}</div>
          <div class="result-meta">
            <span class="result-tag result-${r.kind}">${KIND_LABEL[r.kind] || r.kind}</span>
            <span>${money(r.caseCost)} / ${r.caseSize || '?'} ct${unit}</span>
          </div>
          <div class="result-meta">
            <span>Sell ${money(r.recommendedPrice)}</span>
            ${r.vendorSku ? `<span>SKU ${escapeHtml(r.vendorSku)}</span>` : ''}
            ${r.category ? `<span>${escapeHtml(r.category)}</span>` : ''}
          </div>
          ${r.barcode ? `<div class="result-meta"><span>Barcode ${escapeHtml(r.barcode)}</span></div>` : ''}
          ${renderAssortmentInline(r)}
          ${priceChange}
        </div>
      </li>`;
  }).join('');

  return `
    <details class="result-details">
      <summary>View ${results.length} item${results.length === 1 ? '' : 's'}</summary>
      <ul class="result-list">${rows}</ul>
    </details>
  `;
}

async function pollImportOnce() {
  let p = null;
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'GET_IMPORT_PROGRESS' });
    p = resp && resp.progress;
  } catch (e) {
    // Background worker asleep or no job yet — treat as idle.
  }
  renderImportProgress(p);
  await renderSelection();

  const running = !!(p && p.running);
  if (running && !importPollTimer) {
    importPollTimer = setInterval(pollImportOnce, 800);
  } else if (!running && importPollTimer) {
    clearInterval(importPollTimer);
    importPollTimer = null;
  }
}

importSelectedBtn.addEventListener('click', async () => {
  importSummary.classList.add('hidden');
  importSelectedBtn.disabled = true;
  try {
    await chrome.runtime.sendMessage({ type: 'START_SELECTED_IMPORT' });
  } catch (e) {
    // ignore — poll will reflect state
  }
  pollImportOnce();
});

cancelImportBtn.addEventListener('click', async () => {
  cancelImportBtn.disabled = true;
  try {
    await chrome.runtime.sendMessage({ type: 'CANCEL_SELECTED_IMPORT' });
  } catch (e) {
    // ignore
  }
});

clearSelectionLink.addEventListener('click', async (e) => {
  e.preventDefault();
  await chrome.storage.local.remove(['selection', 'selectedImport']);
  importState = null;
  importSummary.classList.add('hidden');
  renderSelection();
});

// Reflect checkboxes ticked on the page while the popup is open.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.selection) renderSelection();
});

// Initialize on load
init();
