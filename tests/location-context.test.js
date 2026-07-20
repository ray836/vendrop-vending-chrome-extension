const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const contentSource = fs.readFileSync(require.resolve('../content.js'), 'utf8');
const helpers = contentSource.slice(0, contentSource.indexOf('function cartItemCount'));

function element(text) {
  return {
    textContent: text,
    getAttribute() { return null; },
    getBoundingClientRect() { return { width: 100, height: 30 }; },
  };
}

function contextFor({ pathname, headings = [], controls = [], scripts = [] }) {
  const document = {
    scripts: scripts.map((textContent) => ({ textContent })),
    querySelectorAll(selector) {
      if (selector === 'h1, h2') return headings;
      if (selector === 'button, [role="button"], a') return controls;
      return [];
    },
  };
  const context = vm.createContext({
    chrome: { runtime: { onMessage: { addListener() {} } } },
    console,
    document,
    window: {
      location: { hostname: 'www.samsclub.com', pathname },
      getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    },
  });
  vm.runInContext(helpers, context);
  return context;
}

const clubPage = contextFor({
  pathname: '/club/4730-west-jordan-ut',
  headings: [element("West Jordan Sam's Club #4730")],
});
assert.deepEqual({ ...clubPage.extractSamsClubLocationContext() }, {
  retailer: 'samsclub',
  externalId: '4730',
  name: "West Jordan Sam's Club",
  fulfillmentMode: 'pickup',
});

const productPage = contextFor({
  pathname: '/ip/example/123456',
  controls: [element("West Jordan Sam's Club")],
  scripts: ['{"selectedClubId":"4730"}'],
});
assert.equal(productPage.extractSamsClubLocationContext().externalId, '4730');
assert.equal(productPage.extractSamsClubLocationContext().name, "West Jordan Sam's Club");

console.log('location context fixture passed');
