const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

describe("Aim guides", () => {

  const { resolveAttackAimContext } = require('../src/client/game/characters/shared/attackAim.js');
  const { resolveGloopHookSocket } = require('../src/shared/characters/gloopHookGeometry.js');

  test('Gloop super guide starts at the same visible-body socket as the fired hand', () => {
    const player = { x: 200, y: 300, width: 128, height: 128,
      displayWidth: 153.6, displayHeight: 153.6,
      body: { width: 33.6, height: 45.6, center: { x: 200, y: 350 } } };
    const state = resolveAttackAimContext({ character: 'gloop', player,
      family: 'special', pointerWorldX: 900, pointerWorldY: 350, quick: false });
    const firedFrom = resolveGloopHookSocket(player, state.angle);
    assert.ok(Math.abs(state.anchorX - firedFrom.x) < 0.001);
    assert.ok(Math.abs(state.anchorY - firedFrom.y) < 0.001);
    assert.equal(state.baseX, state.anchorX);
    assert.equal(state.baseY, state.anchorY);
  });

  test('Sparrow super circle follows the body below her sprite origin', () => {
    const { createClientModuleGraph } = require('./helpers/clientModule');
    const { createAttackAimReticleController } = createClientModuleGraph({
      globals: { Phaser: { Textures: { FilterMode: { LINEAR: 0 } } } },
    }).load(
      require.resolve('../src/client/game/scene/attackAimReticle.js'),
    );
    const player = { x: 200, y: 300, _bbCharacter: 'sparrow', scaleX: 1.25, scaleY: 1.25,
      displayOriginX: 80, displayOriginY: 80,
      body: { offset: { x: 70, y: 100 }, width: 30, height: 50 } };
    const positions = [];
    const strokes = [];
    const noop = () => {};
    const ctx = {
      beginPath: noop, closePath: noop, clearRect: noop, fill: noop,
      ellipse(...args) { this.path = args; },
      stroke() { strokes.push(this.path); },
    };
    const texture = {
      setFilter: noop, refresh: noop,
      getContext: () => ctx,
    };
    const scene = {
      textures: { createCanvas(key, width, height) {
        assert.ok(width > 1 && height > 1);
        return Object.assign(texture, { width, height });
      } },
      add: { image: () => ({
        setDepth: noop, setVisible: noop, setAlpha: noop, setSizeToFrame: noop,
        updateDisplayOrigin: noop, setScale: noop,
        setPosition(x, y) { positions.push([x, y]); },
      }) },
    };
    const reticle = createAttackAimReticleController(scene, { getPlayer: () => player });
    const aim = () => resolveAttackAimContext({ character: 'sparrow', player, family: 'special', quick: true });
    reticle.update(aim());
    player.y -= 40;
    reticle.update(aim());
    assert.deepEqual(positions, [[202.5, 350], [202.5, 310]]);
    assert.equal(strokes.length, 2);
    assert.deepEqual(strokes[0], strokes[1]);
    assert.equal(strokes[0][6], Math.PI * 2);
  });

});

describe("Quick attack direction", () => {
  const { resolveAttackAimContext } = require('../src/client/game/characters/shared/attackAim');
  const { characterHitBounds } = require('../src/shared/combat/shotContact');
  const player = { x: 300, y: 300, width: 150, height: 150 };
  const enemy = (x, y, extra = {}) => ({
    character: 'ninja', opponent: { x, y, active: true }, opCurrentHealth: 100, ...extra,
  });

  test('each quick attack picks the currently closest living visible opponent in two dimensions', () => {
    const opponents = {
      above: enemy(300, 160), below: enemy(420, 550),
      dead: enemy(302, 300, { opCurrentHealth: 0 }),
      hidden: enemy(304, 300, { _powerupInvisible: true }),
    };
    const fire = () => resolveAttackAimContext({ character: 'ozzy', player, quick: true, opponents });
    assert.ok(fire().unitY < -0.99);
    opponents.above.opponent.y -= 400;
    const next = fire();
    assert.ok(next.unitX > 0 && next.unitY > 0);
    opponents.below.opponent.x = player.x;
    assert.ok(fire().unitY > 0.99);
    opponents.below.opponent.visible = false;
    opponents.above._deathPresentationActive = true;
    for (const flipX of [false, true]) {
      const result = resolveAttackAimContext({ character: 'ozzy', player: { ...player, flipX }, quick: true, opponents });
      assert.equal(result.direction, flipX ? -1 : 1);
      assert.ok(Math.abs(result.unitY) < 1e-6);
    }
  });

  test('auto-aim uses the same character trajectory and range as aiming at the opponent by hand', () => {
    const target = enemy(170, 165);
    const bounds = characterHitBounds(target.character, target.opponent.x, target.opponent.y);
    const pointer = { pointerWorldX: (bounds.left + bounds.right) / 2, pointerWorldY: (bounds.top + bounds.bottom) / 2 };
    for (const character of ['sparrow', 'gloop', 'ozzy', 'ninja', 'draven']) {
      for (const family of ['basic', 'special']) {
        const options = { character, family, player };
        const auto = resolveAttackAimContext({ ...options, quick: true, opponents: { target } });
        const aimed = resolveAttackAimContext({ ...options, ...pointer });
        assert.deepEqual(auto, { ...aimed, quick: true });
        const manual = { ...options, pointerWorldX: 600, pointerWorldY: 450 };
        assert.deepEqual(resolveAttackAimContext({ ...manual, opponents: { target } }), resolveAttackAimContext(manual));
      }
    }
  });
});

test('cancel indicator tracks input, stays visible without an attack guide, and cleans up', () => {
  const { createClientModuleGraph } = require('./helpers/clientModule');
  const { createAttackAimReticleController } = createClientModuleGraph().load(
    require.resolve('../src/client/game/scene/attackAimReticle.js'));
  const draws = [];
  const graphic = { visible: false, destroyed: false,
    clear() { draws.length = 0; },
    setVisible(value) { this.visible = value; },
    setDepth() {}, setPosition(x, y) { this.position = [x, y]; },
    setScale(value) { this.scale = value; },
    fillStyle() {}, lineStyle() {},
    fillCircle(...args) { draws.push(['fillCircle', ...args]); },
    strokeCircle(...args) { draws.push(['strokeCircle', ...args]); },
    lineBetween(...args) { draws.push(['lineBetween', ...args]); },
    destroy() { this.destroyed = true; },
  };
  const controller = createAttackAimReticleController({
    cameras: { main: { zoom: 2 } }, add: { graphics: () => graphic },
  });
  const cue = { baseX: 100, baseY: 200, x: 18, y: 8, radius: 16, cancelled: false };
  controller.updateCancelCue(cue);
  assert.equal(graphic.visible, true);
  assert.equal(graphic.scale, 0.5);
  assert.deepEqual(graphic.position, [100, 200]);
  assert.ok(draws.at(-1)[1] > cue.radius, 'the dot remains outside the ring while aiming');
  controller.hide();
  assert.equal(graphic.visible, false);
  controller.updateCancelCue({ ...cue, x: 4, y: 0, cancelled: true });
  assert.equal(graphic.visible, true, 'cancellation is visible even with no shot renderer');
  assert.ok(draws.some(draw => draw[0] === 'lineBetween' && draw[1] === -5 && draw[2] === -5), 'X indicates cancellation without text');
  const { resolveAttackAimContext } = require('../src/client/game/characters/shared/attackAim.js');
  for (const character of ['gloop', 'sparrow', 'ninja']) {
    const aim = resolveAttackAimContext({ character, family: 'basic',
      player: { x: 100, y: 200, displayWidth: 128, displayHeight: 128 },
      pointerWorldX: 400, pointerWorldY: 230, quick: false });
    controller.updateCancelCue({ ...cue, aim });
    const start = aim.kind === 'throw' ? aim.throwPreview.points[0] : { x: aim.anchorX, y: aim.anchorY };
    const offset = aim.kind === 'throw' ? Number(aim.config.reticlePathOffsetY) || 0 : 0;
    assert.deepEqual(graphic.position, [start.x, start.y + offset], `${character} cue joins the visible guide`);
    const aimingRadius = draws.find(draw => draw[0] === 'strokeCircle')[3];
    controller.updateCancelCue({ ...cue, aim, radius: cue.radius * 1.5, cancelled: true });
    assert.deepEqual(graphic.position, [start.x, start.y + offset], 'cancellation retains the guide anchor');
    const cancelledRadius = draws.find(draw => draw[0] === 'strokeCircle')[3];
    assert.ok(cancelledRadius > aimingRadius && cancelledRadius / aimingRadius < 1.15,
      'the visual ring grows only slightly even when the input radius expands');
  }
  controller.updateCancelCue(null);
  assert.equal(graphic.visible, false);
  controller.destroy();
  assert.equal(graphic.destroyed, true);
});
