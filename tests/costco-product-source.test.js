const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const fullSource = fs.readFileSync(require.resolve('../content.js'), 'utf8');
const extractorSource = fullSource.slice(0, fullSource.indexOf('// Automatically extract product info when page loads'));
const listingSource = fullSource.slice(
  fullSource.indexOf('function isSamsClubPage()'),
  fullSource.indexOf('function findTileMount(anchor)')
);
const source = `${extractorSource}\n${listingSource}`;

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [{
    '@type': 'Product',
    name: 'Cheez-It Crackers, Cheddar, 1.5 oz, 45 Count',
    image: ['https://images.example/cheez-it.jpg'],
    sku: 663439,
    gtin12: '024100171717',
    offers: [{ price: '18.49', availability: 'https://schema.org/InStock' }],
  }],
};

const document = {
  body: { textContent: 'Item 663439 Cheez-It 45 count', innerText: 'Item 663439 Cheez-It 45 count' },
  scripts: [],
  querySelector() { return null; },
  querySelectorAll(selector) {
    if (selector === 'script[type="application/ld+json"]') {
      return [{ textContent: JSON.stringify(jsonLd) }];
    }
    return [];
  },
  getElementById() { return null; },
};

const context = vm.createContext({
  chrome: { runtime: { onMessage: { addListener() {} } } },
  console,
  document,
  window: {
    location: {
      href: 'https://www.costco.com/p/-/cheez-it-crackers-cheddar-15-oz-45-count/100381489?langId=-1',
      hostname: 'www.costco.com',
    },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
  },
  URL,
  Date,
});

vm.runInContext(source, context);
const result = context.extractCostcoProduct();

assert.equal(result.retailer, 'costco');
assert.equal(result.retailer_product_id, '100381489');
assert.equal(result.vendor_sku, '100381489');
assert.equal(result.retailer_item_number, '663439');
assert.equal(result.barcode, '024100171717');
assert.equal(result.case_gtin, '024100171717');
assert.equal(result.case_size, '45');
assert.equal(result.unit_size_value, 1.5);
assert.equal(result.unit_size_unit, 'oz');
assert.equal(result.case_cost, '18.49');
assert.equal(
  context.selectionIdFromUrl('https://www.costco.com/p/-/cheez-it-crackers-cheddar-15-oz-45-count/100381489'),
  'costco:100381489'
);

console.log('Costco product-source fixture passed');
