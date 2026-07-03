// UI Elements - Views
const settingsView = document.getElementById('settings-view');
const mainView = document.getElementById('main-view');
const notSupportedView = document.getElementById('not-supported-view');
const editFormView = document.getElementById('edit-form-view');

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

// State
let currentPageInfo = null;
let currentProductData = null;
let settings = null;

// Initialize popup
async function init() {
  // Load settings
  settings = await loadSettings();

  // Check if settings are configured
  if (!settings.catalogToken) {
    showView('settings');
    return;
  }

  // Get current tab info
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const currentTab = tabs[0];

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
  }

  // The catalog price sweep can run from any page, so keep it available on both
  // the main and not-supported views (but not while configuring / editing).
  const showPanel = viewName === 'main' || viewName === 'not-supported';
  catalogUpdatePanel.classList.toggle('hidden', !showPanel);
  if (showPanel) pollProgressOnce();
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
      })
    });

    const data = await response.json();

    if (response.ok && data.success) {
      return { success: true, data };
    } else if (response.status === 401) {
      throw new Error('Unauthorized — check your catalog maintainer token in Settings');
    } else {
      throw new Error(data.error || 'Failed to save product');
    }
  } catch (error) {
    console.error('Error saving product:', error);
    return { success: false, error: error.message };
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
      : `✓ Added to catalog: ${result.data.product.name}!`;
    showStatus(msg, 'success');

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
      : `✓ Added to catalog: ${result.data.product.name}!`;
    showStatus(msg, 'success', editStatusMessage);

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
  // No job has ever run: just show the button.
  if (!p) {
    updateProgress.classList.add('hidden');
    updateCatalogBtn.classList.remove('hidden');
    updateCatalogBtn.disabled = false;
    return;
  }

  if (p.running) {
    updateCatalogBtn.classList.add('hidden');
    updateSummary.classList.add('hidden');
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
      : 'Updating prices…';
    updateCurrent.textContent = p.currentName ? `Checking: ${p.currentName}` : '';
    cancelUpdateBtn.disabled = !!p.canceling;
    return;
  }

  // Finished (or interrupted): show the button again + a summary.
  updateProgress.classList.add('hidden');
  updateCatalogBtn.classList.remove('hidden');
  updateCatalogBtn.disabled = false;
  if (p.done) renderSummary(p);
}

function renderSummary(p) {
  const title = p.error
    ? 'Update failed'
    : p.canceled
    ? 'Update canceled'
    : p.interrupted
    ? 'Update interrupted'
    : 'Update complete';

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
    ${errorsHtml}
  `;
  updateSummary.classList.remove('hidden');
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

// Initialize on load
init();
