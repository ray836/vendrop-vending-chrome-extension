const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const fullSource = fs.readFileSync(require.resolve('../content.js'), 'utf8');
const prefix = fullSource.slice(0, fullSource.indexOf('// Extract product information'));
const helpers = fullSource.slice(
  fullSource.indexOf('function productJsonLdNodes'),
  fullSource.indexOf('// Extract Sam\'s Club product information')
);

function run() {
  let pageText = 'Instant Savings Now $12.00 $16.00 Save $4.00 Ends Sep 06, 2026 Shipping Arrives Jul 22 Pickup As soon as today Delivery As soon as 1 hour Add to Cart';
  const body = {
    get innerText() { return pageText; },
    get textContent() { return pageText; },
  };
  const buyBox = {
    id: 'fixture-buy-box',
    tagName: 'DIV',
    classList: [],
    parentElement: body,
    get innerText() { return pageText; },
    get textContent() { return pageText; },
    getAttribute() { return null; },
    querySelector() { return null; },
  };
  const addButton = {
    disabled: false,
    textContent: 'Add to Cart',
    parentElement: buyBox,
    getAttribute() { return null; },
    getBoundingClientRect() { return { width: 100, height: 40 }; },
  };
  const document = {
    body,
    querySelector(selector) {
      if (selector === 'button[data-automation-id="atc"]') return addButton;
      if (selector === '[data-testid="buy-box"]') return buyBox;
      return null;
    },
    querySelectorAll(selector) {
      return selector === 'button' ? [addButton] : [];
    },
  };
  const context = vm.createContext({
    chrome: { runtime: { onMessage: { addListener() {} } } },
    console,
    document,
    window: {
      getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    },
  });
  vm.runInContext(`${prefix}\n${helpers}`, context);

  const status = {
    vendor_availability: 'unknown',
    vendor_on_sale: false,
    vendor_discount_amount: null,
    vendor_regular_case_cost: null,
    vendor_sale_ends_on: null,
    vendor_shipping_eligible: null,
    vendor_pickup_eligible: null,
    vendor_delivery_eligible: null,
    case_cost: 12,
  };
  context.applyVisibleVendorStatus(status);
  const { vendor_status_evidence: visibleEvidence, ...visibleStatus } = status;
  assert.deepEqual(visibleStatus, {
    vendor_availability: 'in_stock',
    vendor_on_sale: true,
    vendor_discount_amount: 4,
    vendor_regular_case_cost: 16,
    vendor_sale_ends_on: '2026-09-06',
    vendor_shipping_eligible: true,
    vendor_pickup_eligible: true,
    vendor_delivery_eligible: true,
    case_cost: 12,
  });
  assert.equal(visibleEvidence.scope.strategy, 'add_to_cart_ancestor');
  assert.equal(visibleEvidence.scope.selector, '#fixture-buy-box');
  assert.equal(visibleEvidence.fields.sale[0].source, 'visible_buy_box');

  pageText = '$12.00 This item is sold out Shipping Not available Pickup As soon as today Delivery As soon as 1 hour Add to Cart';
  addButton.disabled = true;
  const unavailable = {
    vendor_availability: 'unknown',
    vendor_on_sale: false,
    vendor_discount_amount: null,
    vendor_regular_case_cost: null,
    vendor_sale_ends_on: null,
    vendor_shipping_eligible: null,
    vendor_pickup_eligible: null,
    vendor_delivery_eligible: null,
    case_cost: 12,
  };
  context.applyVisibleVendorStatus(unavailable);
  assert.equal(unavailable.vendor_availability, 'out_of_stock');
  assert.equal(unavailable.vendor_shipping_eligible, false);
  assert.equal(unavailable.vendor_pickup_eligible, true);
  assert.equal(unavailable.vendor_delivery_eligible, true);
  assert.equal(unavailable.vendor_status_evidence.scope.strategy, 'add_to_cart_ancestor');
  addButton.disabled = false;

  const structured = {
    vendor_availability: 'unknown',
    vendor_on_sale: false,
    vendor_discount_amount: null,
    vendor_regular_case_cost: null,
    vendor_sale_ends_on: null,
    vendor_shipping_eligible: null,
    vendor_pickup_eligible: null,
    vendor_delivery_eligible: null,
  };
  context.applyStructuredVendorStatus(structured, {
    '@type': 'Product',
    offers: {
      availability: 'https://schema.org/InStock',
      price: 12,
      highPrice: 16,
      shippingDetails: {},
    },
  });
  const { vendor_status_evidence: structuredEvidence, ...structuredStatus } = structured;
  assert.deepEqual(structuredStatus, {
    vendor_availability: 'in_stock',
    vendor_on_sale: true,
    vendor_discount_amount: 4,
    vendor_regular_case_cost: 16,
    vendor_sale_ends_on: null,
    vendor_shipping_eligible: true,
    vendor_pickup_eligible: null,
    vendor_delivery_eligible: null,
  });
  assert.equal(structuredEvidence.fields.sale[0].source, 'json_ld');

  pageText = '$12.00 Item is unavailable for this warehouse Shipping Arrives tomorrow';
  addButton.disabled = true;
  context.applyVisibleVendorStatus(structured);
  assert.equal(structured.vendor_availability, 'in_stock');
  addButton.disabled = false;

  assert.deepEqual(
    { ...context.parseFulfillmentOptions('Shipping Arrives tomorrow Pickup Not available Delivery Not available Add to Cart') },
    { shipping: true, pickup: false, delivery: false }
  );
  assert.deepEqual(
    { ...context.parseFulfillmentOptions('Shipping Out of stock Pickup Not available Delivery Not available Shop similar') },
    { shipping: false, pickup: false, delivery: false }
  );

  assert.equal(
    context.parseSaleEndDate('Limit 50 Ends Sep 06', new Date('2026-07-18T12:00:00Z')),
    '2026-09-06'
  );
  assert.equal(
    context.parseSaleEndDate('Ends Jan 02', new Date('2026-07-18T12:00:00Z')),
    '2027-01-02'
  );

  const warehouseScope = {
    id: 'costco-fulfillment',
    tagName: 'DIV',
    classList: [],
    parentElement: body,
    innerText: 'How To Get It Warehouse West Valley Not Sold In This Warehouse',
    textContent: 'How To Get It Warehouse West Valley Not Sold In This Warehouse',
    getAttribute() { return null; },
  };
  const warehouseButton = {
    parentElement: warehouseScope,
    textContent: 'West Valley',
    getAttribute(name) {
      return name === 'aria-label' ? 'West Valley, current warehouse' : null;
    },
    getBoundingClientRect() { return { width: 100, height: 40 }; },
    closest() { return null; },
  };
  document.querySelectorAll = (selector) => {
    if (selector.includes('Button_locationselector_WarehouseSelector--submit')) return [warehouseButton];
    return selector === 'button' ? [addButton] : [];
  };
  const costcoStatus = {
    retailer: 'costco',
    vendor_availability: 'in_stock',
    vendor_pickup_eligible: null,
  };
  context.applyCostcoWarehouseStatus(costcoStatus);
  assert.equal(costcoStatus.vendor_availability, 'out_of_stock');
  assert.equal(costcoStatus.vendor_pickup_eligible, false);
  assert.equal(costcoStatus.vendor_status_evidence.fields.availability[0].source, 'costco_warehouse');

  console.log('vendor status fixture passed');
}

run();
