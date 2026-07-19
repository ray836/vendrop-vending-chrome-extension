const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const popupSource = fs.readFileSync(require.resolve('../popup.js'), 'utf8');
const renderSource = popupSource.slice(
  popupSource.indexOf('function renderResultsDetails(results)'),
  popupSource.indexOf('async function pollImportOnce()')
);

function run() {
  const context = vm.createContext({
    KIND_LABEL: { added: 'Added' },
    buildProductDetailUrl: (id) => id ? `http://localhost:3000/web/products/catalog/${id}` : null,
    escapeHtml: (value) => String(value),
    money: (value) => typeof value === 'number' ? `$${value.toFixed(2)}` : '—',
    renderAnalysisBadge: () => '',
    renderAssortmentInline: () => '',
  });
  vm.runInContext(renderSource, context);

  const html = context.renderResultsDetails([{
    kind: 'added',
    standardProductId: 'product-123',
    name: 'Linked product',
    image: 'https://images.example/product.jpg',
    caseCost: 20,
    caseSize: 10,
    recommendedPrice: 3,
  }]);

  assert.match(html, /class="result-thumb-link"/);
  assert.match(html, /class="result-name result-name-link"/);
  assert.match(html, /href="http:\/\/localhost:3000\/web\/products\/catalog\/product-123"/);
  assert.match(html, /target="_blank" rel="noopener noreferrer"/);

  const missingIdHtml = context.renderResultsDetails([{ kind: 'added', name: 'No id' }]);
  assert.doesNotMatch(missingIdHtml, /result-name-link/);

  console.log('import summary links fixture passed');
}

run();
