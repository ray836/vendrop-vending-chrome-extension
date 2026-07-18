const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync(require.resolve('../background.js'), 'utf8');
const runStart = source.indexOf('async function runCartPlacement(job)');
const clearCall = source.indexOf('await clearSamsCartInTab(tab.id)', runStart);
const clearMessage = source.indexOf("{ type: 'CLEAR_SAMS_CART' }", runStart);
const productLoop = source.indexOf('for (let index = 0; index < items.length; index++)', runStart);
const quantityCall = source.indexOf('await setCartQuantitiesInTab(tab.id, items)', productLoop);

assert.ok(runStart >= 0, 'cart placement runner exists');
assert.ok(clearCall > runStart, 'cart placement invokes cart clearing');
assert.ok(clearMessage > runStart, 'cart clearing message is sent by the placement flow');
assert.ok(clearCall < productLoop, 'existing cart is cleared before any order product is opened');
assert.ok(quantityCall > productLoop, 'final quantities are set after every product type is added');
assert.match(source, /addProductInTab\(tab\.id, \{ \.\.\.item, quantity: 1 \}\)/);
assert.match(source, /phase: 'clearing-cart'/);
assert.match(source, /phase: 'cart-cleared'/);
assert.match(source, /phase: 'updating-quantities'/);
console.log('cart placement ordering fixture passed');
