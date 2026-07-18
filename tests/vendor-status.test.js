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
  const addButton = {
    disabled: false,
    textContent: 'Add to Cart',
    getAttribute() { return null; },
    getBoundingClientRect() { return { width: 100, height: 40 }; },
  };
  const document = {
    body: {
      get innerText() { return pageText; },
      get textContent() { return pageText; },
    },
    querySelector(selector) {
      if (selector === 'button[data-automation-id="atc"]') return addButton;
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
  assert.deepEqual({ ...status }, {
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

  pageText = 'This item is sold out Shipping Not available Pickup As soon as today Delivery As soon as 1 hour Add to Cart';
  const unavailable = {
    vendor_availability: 'unknown',
    vendor_on_sale: false,
    vendor_discount_amount: null,
    vendor_regular_case_cost: null,
    vendor_sale_ends_on: null,
    vendor_shipping_eligible: null,
    vendor_pickup_eligible: null,
    vendor_delivery_eligible: null,
  };
  context.applyVisibleVendorStatus(unavailable);
  assert.equal(unavailable.vendor_availability, 'out_of_stock');
  assert.equal(unavailable.vendor_shipping_eligible, false);
  assert.equal(unavailable.vendor_pickup_eligible, true);
  assert.equal(unavailable.vendor_delivery_eligible, true);

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
  assert.deepEqual({ ...structured }, {
    vendor_availability: 'in_stock',
    vendor_on_sale: true,
    vendor_discount_amount: 4,
    vendor_regular_case_cost: 16,
    vendor_sale_ends_on: null,
    vendor_shipping_eligible: true,
    vendor_pickup_eligible: null,
    vendor_delivery_eligible: null,
  });

  assert.deepEqual(
    { ...context.parseFulfillmentOptions('Shipping Arrives tomorrow Pickup Not available Delivery Not available Add to Cart') },
    { shipping: true, pickup: false, delivery: false }
  );

  assert.equal(
    context.parseSaleEndDate('Limit 50 Ends Sep 06', new Date('2026-07-18T12:00:00Z')),
    '2026-09-06'
  );
  assert.equal(
    context.parseSaleEndDate('Ends Jan 02', new Date('2026-07-18T12:00:00Z')),
    '2027-01-02'
  );

  console.log('vendor status fixture passed');
}

run();
