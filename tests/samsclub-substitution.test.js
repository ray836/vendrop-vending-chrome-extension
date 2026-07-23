const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const fullSource = fs.readFileSync(require.resolve('../content.js'), 'utf8');
const prefix = fullSource.slice(0, fullSource.indexOf('// Extract product information'));
const context = vm.createContext({
  chrome: { runtime: { onMessage: { addListener() {} } } },
  console,
  URL,
});
vm.runInContext(prefix, context);

const replacementUrl = 'https://www.samsclub.com/ip/Extra-Mint-Sugar-Free-Chewing-Gum-Variety-Pack-15-pcs-18-pk/19493971604?athcpid=19493971604&athpgid=itempagesubstitutions_13906655409&athena=true';

assert.equal(
  context.extractSamsClubReplacedProductId(replacementUrl, '19493971604'),
  '13906655409',
  'reads the exact retired listing from Sam\'s substitution tracking value'
);
assert.equal(
  context.extractSamsClubReplacedProductId(
    'https://www.samsclub.com/ip/example/19493971604?athpgid=itempage_recommendations_13906655409',
    '19493971604'
  ),
  null,
  'ordinary recommendations are not authoritative replacement evidence'
);
assert.equal(
  context.extractSamsClubReplacedProductId(
    'https://www.samsclub.com/ip/example/19493971604?athpgid=itempagesubstitutions_19493971604',
    '19493971604'
  ),
  null,
  'a listing cannot replace itself'
);

console.log('Sam\'s Club substitution fixture passed');
