const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const backgroundSource = fs.readFileSync(require.resolve('../background.js'), 'utf8');
const helpers = backgroundSource.slice(
  backgroundSource.indexOf('function isSupportedUrl'),
  backgroundSource.indexOf('function sleep')
) + '\n' + backgroundSource.slice(
  backgroundSource.indexOf('function retailerFromSupportedUrl'),
  backgroundSource.indexOf('function setSamsClubInTab')
);
const context = vm.createContext({ console, URL });
vm.runInContext(helpers, context);

const products = Array.from({ length: 20 }, (_, index) => ({
  id: `product-${index}`,
  name: `Product ${index}`,
  vendorOnSale: index === 17,
}));
const ordered = context.orderWithSentinelsFirst(products, 5);
assert.equal(ordered.length, products.length);
assert.equal(new Set(ordered.map((product) => product.id)).size, products.length);
assert.ok(ordered.slice(0, 5).some((product) => product.id === 'product-17'));
assert.notDeepEqual(ordered.slice(0, 5).map((product) => product.id), products.slice(0, 5).map((product) => product.id));

const offer = {
  caseCost: 13.48,
  vendorRegularCaseCost: 14.18,
  vendorDiscountAmount: 0.7,
  vendorSaleEndsOn: '2026-09-06',
  vendorAvailability: 'in_stock',
  vendorOnSale: true,
  vendorShippingEligible: false,
  vendorPickupEligible: true,
  vendorDeliveryEligible: true,
};
assert.equal(context.offerSignature(offer), context.offerSignature({ ...offer }));
assert.notEqual(context.offerSignature(offer), context.offerSignature({ ...offer, caseCost: 13.49 }));
assert.notEqual(context.offerSignature(offer), context.offerSignature({ ...offer, vendorOnSale: false }));

const freshPrimary = new Map([
  ['product-1', context.offerSignature(offer)],
  ['product-2', context.offerSignature(offer)],
]);
assert.equal(context.canInferFromCurrentPrimary([{ id: 'product-1' }, { id: 'product-2' }], freshPrimary), true);
assert.equal(context.canInferFromCurrentPrimary([{ id: 'product-1' }, { id: 'product-3' }], freshPrimary), false);

const westJordan = { retailer: 'samsclub', externalId: '4730', name: 'West Jordan' };
assert.equal(context.resolveRefreshCaseCost({ case_cost: '13.48' }, { caseCost: 12 }, westJordan), 13.48);
assert.equal(context.resolveRefreshCaseCost({}, { caseCost: 12 }, null), 12);
assert.ok(Number.isNaN(context.resolveRefreshCaseCost({}, { caseCost: 12 }, westJordan)));
assert.equal(context.resolveRefreshCaseCost({}, {
  caseCost: 12,
  vendorOffer: { vendorLocationId: 'vloc-samsclub-4730' },
}, westJordan), 12);

console.log('location sentinel fixture passed');
