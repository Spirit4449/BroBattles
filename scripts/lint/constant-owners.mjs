import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const tuningModules = [
  'src/shared/gameConstants.js',
  'src/shared/combat/matchConfig.js',
  'src/shared/characters/characterStats.js',
  'src/shared/bankBustSettings.js',
  'src/shared/matchIntroTiming.js',
  'src/shared/physics/ducking.js',
  'src/shared/physics/movementPrecision.js',
  'src/shared/physics/shockwaveImpulse.js',
  'src/shared/powerups.js',
  'src/shared/social/textRules.js',
  'src/shared/social/verificationCode.js',
  'src/shared/site/supportRules.js',
  'src/shared/net/bundleVersion.js',
  'src/shared/storageKeys.js',
  'src/shared/moderation/accountBan.js',
  'src/server/services/email/verificationCode.js',
  'src/server/services/match/bots/config.js',
  'src/server/services/trophies/leaderboardService.js',
];

const owners = new Map();
for (const relativePath of tuningModules) {
  const filename = fileURLToPath(new URL(`../../${relativePath}`, import.meta.url));
  for (const [name, value] of Object.entries(require(filename))) {
    if (!/^[A-Z][A-Z_0-9]+$/.test(name) || !['number', 'string', 'boolean', 'bigint'].includes(typeof value)) continue;
    if (owners.has(name)) throw new Error(`Constant ${name} has multiple declared owners`);
    owners.set(name, { filename, relativePath });
  }
}

const unaryOperators = new Set(['+', '-', '~', '!']);
const binaryOperators = new Set(['+', '-', '*', '/', '%', '**', '<<', '>>', '>>>', '&', '|', '^']);

function isLiteralValue(node) {
  switch (node.type) {
    case 'Literal':
      return !node.regex;
    case 'TemplateLiteral':
      return node.expressions.every(isLiteralValue);
    case 'UnaryExpression':
      return unaryOperators.has(node.operator) && isLiteralValue(node.argument);
    case 'BinaryExpression':
      return binaryOperators.has(node.operator) && isLiteralValue(node.left) && isLiteralValue(node.right);
    default:
      return false;
  }
}

export default {
  meta: {
    messages: {
      owned: 'Import {{name}} from its owning module, {{owner}}.',
    },
  },
  create(context) {
    return {
      VariableDeclarator({ id, init }) {
        if (id.type !== 'Identifier' || !init) return;
        const owner = owners.get(id.name);
        if (!owner || owner.filename === context.physicalFilename || !isLiteralValue(init)) return;
        context.report({ node: id, messageId: 'owned', data: { name: id.name, owner: owner.relativePath } });
      },
    };
  },
};
