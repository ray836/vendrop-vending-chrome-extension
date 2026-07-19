const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const popupSource = fs.readFileSync(require.resolve('../popup.js'), 'utf8');
const popupCss = fs.readFileSync(require.resolve('../popup.css'), 'utf8');

const focusModeSource = popupSource.slice(
  popupSource.indexOf('let refreshIsRunning = false;'),
  popupSource.indexOf('async function isImportRunning()')
);

function run() {
  const classes = new Set();
  const context = vm.createContext({
    document: {
      body: {
        classList: {
          toggle(name, enabled) {
            if (enabled) classes.add(name);
            else classes.delete(name);
          },
        },
      },
    },
  });

  vm.runInContext(focusModeSource, context);

  vm.runInContext('importIsRunning = true; syncJobChrome();', context);
  assert.deepEqual([...classes].sort(), ['import-running', 'job-running']);

  vm.runInContext('importIsRunning = false; refreshIsRunning = true; syncJobChrome();', context);
  assert.deepEqual([...classes].sort(), ['job-running', 'refresh-running']);

  assert.doesNotMatch(
    popupCss,
    /body\.job-running #selection-panel(?:\s|,|\{)/,
    'generic focus mode must not hide the import progress panel'
  );
  assert.match(popupCss, /body\.refresh-running #selection-panel/);
  assert.match(popupCss, /body\.import-running #catalog-update-panel/);

  console.log('import progress visibility fixture passed');
}

run();
