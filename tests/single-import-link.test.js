const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const popupSource = fs.readFileSync(require.resolve('../popup.js'), 'utf8');
const linkSource = popupSource.slice(
  popupSource.indexOf('function showCatalogProductLink(product)'),
  popupSource.indexOf('// Populate edit form with product data')
);

const classes = new Set(['hidden']);
const viewProductLink = {
  href: '',
  removeAttribute(name) {
    if (name === 'href') this.href = '';
  },
  classList: {
    add(name) { classes.add(name); },
    remove(name) { classes.delete(name); },
  },
};

const context = vm.createContext({
  buildProductDetailUrl: (id) => id
    ? `https://simplevending.example/web/products/catalog/${id}`
    : null,
  viewProductLink,
});
vm.runInContext(linkSource, context);

context.showCatalogProductLink({ id: 'product-123' });
assert.equal(viewProductLink.href, 'https://simplevending.example/web/products/catalog/product-123');
assert.equal(classes.has('hidden'), false);

context.showCatalogProductLink(null);
assert.equal(viewProductLink.href, '');
assert.equal(classes.has('hidden'), true);

console.log('single-product import link fixture passed');
