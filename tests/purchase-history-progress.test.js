const assert = require('node:assert/strict');
const fs = require('node:fs');

const background = fs.readFileSync(require.resolve('../background.js'), 'utf8');
const popup = fs.readFileSync(require.resolve('../popup.js'), 'utf8');
const popupHtml = fs.readFileSync(require.resolve('../popup.html'), 'utf8');

assert.match(background, /purchaseHistorySync/);
assert.match(background, /phase: 'opening-history'/);
assert.match(background, /phase: 'reading-history'/);
assert.match(background, /phase: 'uploading'/);
assert.match(background, /phase: 'complete'/);
assert.match(background, /45_000/);
assert.match(background, /GET_PURCHASE_HISTORY_PROGRESS/);

assert.match(popupHtml, /id="history-view"/);
assert.match(popupHtml, /No catalog matches is okay/);
assert.match(popup, /renderPurchaseHistoryProgress/);
assert.match(popup, /None match the catalog yet, and that’s okay|catalog match/);

console.log('purchase history progress fixture passed');
