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

const canonical = {
  id: 'std-cheezit',
  name: 'Cheez-It Original, 1.5 oz',
  image: 'canonical.jpg',
  caseCost: 17.98,
  caseSize: 45,
  sources: [
    {
      id: 'source-sams',
      retailer: 'samsclub',
      retailerProductId: '2410071717',
      vendorLink: 'https://www.samsclub.com/ip/cheez-it-original/2410071717',
      sourceName: 'Cheez-It Original Baked Snack Crackers, 1.5 oz, 45 pk',
      sourceImage: 'sams.jpg',
      caseCost: 17.98,
      caseCount: 45,
      availability: 'in_stock',
      onSale: false,
    },
    {
      id: 'source-sams-retired',
      retailer: 'samsclub',
      retailerProductId: '13906655409',
      supersededByRetailerProductId: '2410071717',
      vendorLink: 'https://www.samsclub.com/ip/retired-example/13906655409',
      sourceName: 'Retired listing',
      sourceImage: 'retired.jpg',
      caseCost: 18.98,
      caseCount: 45,
      availability: 'out_of_stock',
      onSale: false,
    },
    {
      id: 'source-costco',
      retailer: 'costco',
      retailerProductId: '100381489',
      vendorLink: 'https://www.costco.com/p/-/cheez-it-crackers-cheddar-15-oz-45-count/100381489',
      sourceName: 'Cheez-It Crackers, Cheddar, 1.5 oz, 45 Count',
      sourceImage: 'costco.jpg',
      caseCost: 18.49,
      caseCount: 45,
      availability: 'in_stock',
      onSale: false,
    },
  ],
};

const allTargets = context.catalogRefreshTargets([canonical]);
assert.equal(allTargets.length, 2, 'one canonical product expands into both supplier listings');
assert.ok(
  allTargets.every((target) => target.sourceRetailerProductId !== '13906655409'),
  'superseded listings are kept in the catalog but skipped during refresh'
);
assert.equal(new Set(allTargets.map(context.refreshTargetKey)).size, 2, 'supplier targets have distinct job keys');

const costcoTargets = context.catalogRefreshTargets([canonical], 'costco');
assert.equal(costcoTargets.length, 1);
assert.equal(costcoTargets[0].refreshTargetId, 'source-costco');
assert.equal(costcoTargets[0].vendorLink, canonical.sources[2].vendorLink);
assert.equal(costcoTargets[0].caseCost, 18.49);

const ordered = context.orderWithSentinelsFirst(allTargets, 1);
assert.equal(ordered.length, 2, 'sentinel ordering must not drop a second source sharing the canonical id');
assert.deepEqual(
  [...context.catalogRefreshRetailers([canonical])].sort(),
  ['costco', 'samsclub']
);

const samLocation = {
  id: 'vloc-samsclub-4730',
  retailer: 'samsclub',
  externalId: '4730',
  name: "West Jordan Sam's Club",
};
const passes = context.buildCatalogRefreshPasses(
  [canonical],
  [samLocation],
  [samLocation],
  true
);
assert.deepEqual(
  JSON.parse(JSON.stringify(
    passes.map((pass) => ({ retailer: pass.retailer, locationId: pass.location?.id || null }))
  )),
  [
    { retailer: 'samsclub', locationId: 'vloc-samsclub-4730' },
    { retailer: 'costco', locationId: null },
  ],
  'Sam refresh stays location-specific while Costco uses one truthful online pass'
);

const legacy = {
  id: 'std-legacy',
  name: 'Legacy product',
  vendorSku: '123',
  vendorLink: 'https://www.samsclub.com/ip/legacy/123',
  sources: [],
};
assert.equal(context.catalogRefreshTargets([legacy], 'samsclub').length, 1);
assert.equal(context.catalogRefreshTargets([legacy], 'costco').length, 0);

console.log('source-aware refresh target fixture passed');
