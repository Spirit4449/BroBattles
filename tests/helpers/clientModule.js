const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const babel = require('@babel/core');

const compiled = new Map();

// Compile each real browser module once per worker, but give every fixture a
// fresh VM and explicit imports/globals so state cannot leak between tests.
function loadClientModule(file, globals = {}) {
  const filename = path.resolve(file);
  if (!compiled.has(filename)) {
    compiled.set(filename, babel.transformSync(fs.readFileSync(filename, 'utf8'), {
      babelrc: false, configFile: false,
      presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
    }).code);
  }
  const exports = globals.exports || {};
  vm.runInNewContext(compiled.get(filename), { ...globals, exports });
  return exports;
}

module.exports = { loadClientModule };

// Resolve and execute complete browser modules, including their real relative
// dependencies. Overrides replace explicit browser/network boundaries only.
function createClientModuleGraph({ globals = {}, imports = {} } = {}) {
  const cache = new Map();
  const context = vm.createContext({ console, URL, URLSearchParams, AbortController, ...globals });
  function load(filename) {
    filename = require.resolve(filename);
    if (cache.has(filename)) return cache.get(filename).exports;
    if (filename.endsWith('.json')) return require(filename);
    const module = { exports: {} };
    cache.set(filename, module);
    if (!compiled.has(filename)) {
      compiled.set(filename, babel.transformSync(fs.readFileSync(filename, 'utf8'), {
        babelrc: false, configFile: false,
        presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
      }).code);
    }
    const localRequire = specifier => {
      if (Object.hasOwn(imports, specifier)) return imports[specifier];
      const target = specifier.startsWith('.') ? path.resolve(path.dirname(filename), specifier) : specifier;
      if (Object.hasOwn(imports, target)) return imports[target];
      if (/\.css$/.test(specifier)) return {};
      if (/\.(webp|png|svg|mp3|ogg|wav)(?:\?|$)/.test(specifier)) return target.split('/public')[1] || target;
      const resolved = require.resolve(target);
      if (Object.hasOwn(imports, resolved)) return imports[resolved];
      if (!specifier.startsWith('.')) return require(specifier);
      return load(target);
    };
    const execute = vm.runInContext(`(function(exports, require, module, __filename, __dirname) {\n${compiled.get(filename)}\n})`, context, { filename });
    execute(module.exports, localRequire, module, filename, path.dirname(filename));
    return module.exports;
  }
  return { load: file => load(path.resolve(file)) };
}

module.exports.createClientModuleGraph = createClientModuleGraph;
