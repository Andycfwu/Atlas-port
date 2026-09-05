/* global __dirname: readonly */
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// Execute production TS with explicit native boundaries mocked; no copied logic.
exports.load = (relativePath, mocks = {}, globals = {}) => {
  const filename = path.resolve(__dirname, '..', relativePath);
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const exported = {};
  const localRequire = (name) => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    throw new Error(`Unexpected dependency ${name} in ${relativePath}`);
  };
  const context = { __DEV__: false, setTimeout, clearTimeout, ...globals };
  new Function('require', 'exports', ...Object.keys(context), outputText)(localRequire, exported, ...Object.values(context));
  return exported;
};

exports.hooks = () => {
  const cleanups = [];
  let current;
  return {
    react: {
      useState: (initial) => { current = initial; return [current, (value) => { current = typeof value === 'function' ? value(current) : value; }]; },
      useRef: (value) => ({ current: value }),
      useCallback: (callback) => callback,
      useEffect: (effect) => { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); },
    },
    state: () => current,
    unmount: () => cleanups.forEach((cleanup) => cleanup()),
  };
};
