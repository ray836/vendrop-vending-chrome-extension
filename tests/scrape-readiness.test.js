const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../background.js'), 'utf8');
const helpers = source.slice(
  source.indexOf('function productInfoReadinessSignature'),
  source.indexOf('function scrapeOnce')
);
const context = vm.createContext({ JSON });
vm.runInContext(helpers, context);

const complete = {
  name: 'Protein Bars',
  image: 'https://images.example/hero.jpg',
  case_cost: '22.98',
  case_size: '18',
  vendor_sku: '12345',
  images: ['https://images.example/hero.jpg'],
  vendor_availability: 'in_stock',
};

assert.equal(context.isProductInfoReady(complete), true);
assert.equal(context.isProductInfoReady({ ...complete, images: [] }), false);
assert.equal(context.isProductInfoReady({
  ...complete,
  case_cost: null,
  vendor_availability: 'out_of_stock',
}), true);
assert.equal(context.isProductInfoReady({
  ...complete,
  case_cost: null,
  vendor_availability: 'unknown',
}), false);
assert.equal(
  context.productInfoReadinessSignature(complete),
  context.productInfoReadinessSignature({ ...complete }),
);

console.log('scrape readiness fixture passed');
