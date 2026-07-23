const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const fullSource = fs.readFileSync(require.resolve('../content.js'), 'utf8');
const helperSource = fullSource.slice(0, fullSource.indexOf('// Extract product information'));

const context = vm.createContext({
  chrome: { runtime: { onMessage: { addListener() {} } } },
  console,
  document: { querySelector() { return null; }, querySelectorAll() { return []; } },
  window: { getComputedStyle: () => ({ display: 'block', visibility: 'visible' }) },
});
vm.runInContext(helperSource, context);

assert.equal(
  context.extractCaseSizeFromText('EXTRA Mint Sugar Free Chewing Gum, Variety Pack, 15 pc., 18 pk.'),
  '18'
);
assert.equal(context.extractCaseSizeFromText('Cookies, 1.5 oz., 30 pk.'), '30');
assert.equal(context.extractCaseSizeFromText('Pop-Tarts Toaster Pastries Variety Pack, 48 ct.'), '48');
assert.equal(context.extractCaseSizeFromText('Widgets, 4 piece, 24 count'), '24');
assert.equal(context.extractCaseSizeFromText('Cheez-It Crackers, Cheddar, 1.5 oz, 45-count'), '45');
assert.equal(context.extractCaseSizeFromText('No package quantity here'), null);

console.log('case size fixture passed');
