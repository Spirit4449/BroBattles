import globals from 'globals';
import constantOwners from './scripts/lint/constant-owners.mjs';
import socketProtocol from './src/shared/net/socketEvents.js';

const socketMethods = new Set(['on', 'once', 'off', 'emit', 'addListener', 'removeListener']);
const socketTargetMethods = new Set(['to', 'in', 'of', 'compress', 'except', 'timeout']);
const socketTargetFlags = new Set(['broadcast', 'local', 'volatile']);
const protocolEvents = new Set(Object.values(socketProtocol.SOCKET_EVENTS));

function memberName(member) {
  return member.computed ? member.property.value : member.property.name;
}

function isSocketReceiver(node) {
  const isSocketName = name => /^(?:io|namespace|sock|\w*socket\w*)$/i.test(name);
  if (node.type === 'Identifier') return isSocketName(node.name);
  if (node.type === 'MemberExpression') {
    const name = memberName(node);
    return isSocketName(name) || (socketTargetFlags.has(name) && isSocketReceiver(node.object));
  }
  if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression') {
    return socketTargetMethods.has(memberName(node.callee)) && isSocketReceiver(node.callee.object);
  }
  return false;
}

const socketEventRule = {
  meta: {
    messages: {
      literal: 'Use SOCKET_EVENTS for the Socket.IO event "{{event}}".',
      unknown: 'Add the Socket.IO event "{{event}}" to the shared SOCKET_EVENTS registry and use its constant.',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const { callee, arguments: [name] } = node;
        if (callee.type !== 'MemberExpression' || !socketMethods.has(memberName(callee)) || !name) return;
        const event = name.type === 'TemplateLiteral' && name.expressions.length === 0
          ? name.quasis[0].value.cooked
          : name.value;
        if (typeof event !== 'string') return;
        const registered = protocolEvents.has(event);
        // Also catch named protocol events sent through a local socket alias.
        if (!isSocketReceiver(callee.object) && !(registered && /[:-]/.test(event))) return;
        context.report({ node: name, messageId: registered ? 'literal' : 'unknown', data: { event } });
      },
    };
  },
};

export default [
  { ignores: ['dist/', 'output/', 'spritesheet-generator/'] },
  {
    files: [
      'src/{server,shared}/**/*.{js,cjs}',
      'scripts/**/*.cjs',
      'tests/**/*.{js,cjs}',
      'babel.config.js',
      'webpack.config.js',
    ],
    ignores: ['tests/browser/**'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: globals.node,
    },
  },
  {
    // Playwright callbacks in these tools evaluate in the browser.
    files: [
      'scripts/art/{record-about-gameplay,render-map-full-previews}.cjs',
      'scripts/dev/{review-about-page,test-generated-html,test-rendering}.cjs',
      'scripts/dev/net-probe.mjs',
    ],
    languageOptions: { globals: { ...globals.browser, Phaser: 'readonly' } },
  },
  {
    files: ['src/shared/projectilePresentation.js', 'tests/cosmeticRoutes.test.js'],
    languageOptions: { globals: { document: 'readonly' } },
  },
  {
    files: ['**/*.mjs'],
    languageOptions: {
      sourceType: 'module',
      globals: globals.nodeBuiltin,
    },
  },
  {
    files: [
      'src/client/**/*.{js,cjs,mjs}',
      'public/scripts/**/*.js',
      'tests/browser/**/*.js',
      'scripts/art/map-full-preview/entry.js',
    ],
    languageOptions: {
      globals: {
        ...globals.browser,
        // Some browser modules use CommonJS imports through webpack.
        ...globals.commonjs,
        Phaser: 'readonly',
      },
    },
  },
  {
    files: ['src/**/*.{js,cjs,mjs}'],
    plugins: { 'bro-battles': { rules: {
      'constant-owners': constantOwners,
      'socket-event-constants': socketEventRule,
    } } },
    rules: { 'bro-battles/constant-owners': 'error' },
  },
  {
    files: ['src/{client,server}/**/*.{js,mjs}', 'src/shared/combat/**/*.js'],
    rules: { 'bro-battles/socket-event-constants': 'error' },
  },
  {
    rules: {
      'no-undef': 'warn',
      'no-unused-vars': ['warn', {
        args: 'after-used',
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      'no-empty': 'warn',
      'no-dupe-keys': 'warn',
      'no-unreachable': 'warn',
      'no-redeclare': 'warn',
      'no-cond-assign': 'warn',
      'no-fallthrough': 'warn',
      'no-self-assign': 'warn',
    },
  },
];
