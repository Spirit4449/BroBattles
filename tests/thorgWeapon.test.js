const { loadClientModule } = require('./helpers/clientModule');
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

describe("Weapon presentation", () => {
  const { EventEmitter } = require('node:events');

  const sweep = require('../src/shared/characters/thorgSweep');

  function load(file, dependencies = {}) {
    const exports = {};

    loadClientModule(require.resolve(file), { exports, require: key => {
      assert.ok(key in dependencies, `Unexpected dependency ${key}`);
      return dependencies[key];
    }});
    return exports;
  }
  const flips = load('../src/client/game/characters/shared/flipLock.js');
  const playerAudio = load('../src/client/game/audio/playerAudio.js');
  const weaponModule = load('../src/client/game/characters/thorg/weapon.js', {
    '../../../../shared/characters/thorgSweep': sweep,
    '../shared/flipLock': flips,
    '../shared/animationState': { playSpriteAnimation() {}, markOneShotAnimation() {} },
    '../../audio/playerAudio': playerAudio,
    '../shared/shotPrediction': { inHitstop: sprite => performance.now() < (sprite?.anims?._hitstopUntil || 0) },
  });

  function object() {
    return Object.assign(new EventEmitter(), {
      active: true, visible: true, alpha: 1, x: 300, y: 200, depth: 30,
      rotation: 0, destroyCount: 0,
      setOrigin() { return this; },
      setTexture(key, frame) { this.textureKey = key; this.textureFrame = frame; return this; }, setFlipX() { return this; },
      setCrop(x,y,w,h) { this.crop = {x,y,w,h}; return this; },
      setTint() { return this; }, clearTint() { return this; },
      setDisplaySize(width, height) { this.displayWidth = width; this.displayHeight = height; return this; },
      setVisible(value) { this.visible = value; return this; },
      setAlpha(value) { this.alpha = value; return this; },
      setDepth(value) { this.depth = value; return this; },
      setPosition(x, y) { this.x = x; this.y = y; return this; },
      setAngle(value) { this.angle = value; return this; },
      clear() { return this; }, lineStyle() { return this; },
      lineBetween(...points) { assert.ok(points.every(Number.isFinite)); this.lineCount = (this.lineCount || 0) + 1; return this; },
      destroy() { this.destroyCount++; this.active = false; this.emit('destroy'); },
    });
  }
  function harness() {
    const images = [], graphics = [], sounds = [];
    const scene = {
      events: new EventEmitter(), textures: { exists: () => true },
      cache: { audio: { exists: () => true } },
      add: {
        image() { const image = object(); images.push(image); return image; },
        graphics() { const graphic = object(); graphics.push(graphic); return graphic; },
      },
      sound: {
        add(key) {
          const sound = { key, playCount: 0, stopCount: 0, destroyCount: 0,
            play() { this.playCount++; return true; }, stop() { this.stopCount++; }, destroy() { this.destroyCount++; } };
          sounds.push(sound); return sound;
        },
        play(key) { const sound = this.add(key); sound.play(); return true; },
      },
    };
    const body = Object.assign(object(), {
      texture: { key: 'thorg' }, frame: { name: 'idle00' }, flipX: false,
      body: { velocity: { y: 0 } },
      anims: { currentAnim: { duration: 900 }, timeScale: 1 },
    });
    scene._localPlayerAudioSprite = body;
    return { scene, body, images, graphics, sounds, elapsed: 0, tick(delta) {
      this.elapsed += delta;
      scene.events.emit('update', 0, delta); scene.events.emit('postupdate', 0, delta);
    }};
  }

  function videoHarness() {
    const h = harness();
    h.body.texture.customData = { meta: { bbVideoFrames: true } };
    h.body.texture.get = name => ({ name, customData: { bbEmbeddedWeapon: true } });
    h.body.setFrame = name => { h.body.frame = h.body.texture.get(name); };
    h.body.anims.pause = () => { h.body.paused = true; };
    h.body.anims.resume = () => { h.body.paused = false; };
    return h;
  }

  test('attack follows the shared pose clock without separate weapon sprites', () => {
    const h = videoHarness();
    const { windupMs, strikeMs, recoveryMs } = sweep.THORG_SWEEP;
    weaponModule.startThorgSweep(h.scene, h.body, { direction: -1 });
    for (const delta of [windupMs, strikeMs / 2, strikeMs / 2, recoveryMs - 1]) {
      h.tick(delta);
      assert.equal(h.body.frame.name, sweep.thorgAttackFrameAt(h.elapsed).frame);
    }
    assert.equal(h.body.flipX, true);
    h.tick(1);
    assert.equal(h.body._thorgSweepActive, false);
    assert.equal(h.body.paused, false);
    assert.equal(h.body._lockFlip, false);
    assert.equal(h.images.length, 0);
    assert.equal(h.graphics.length, 0);
    assert.equal(h.sounds[0].destroyCount, 1);
  });

  for (const event of ['destroy', 'shutdown', 'presentation:reset']) test(`video attack cleans up on ${event}`, () => {
    const h = videoHarness();
    weaponModule.startThorgSweep(h.scene, h.body);
    h.tick(100);
    if (event === 'destroy') h.body.destroy(); else h.scene.events.emit(event);
    assert.equal(h.body._thorgSweepActive, false);
    assert.equal(h.sounds[0].destroyCount, 1);
    assert.equal(h.scene.events.listenerCount('update'), 0);
    assert.equal(h.scene.events.listenerCount('shutdown'), 0);
    assert.equal(h.body.listenerCount('destroy'), 0);
  });

  test('video attack interruption preserves the replacing pose and restarting releases old resources', () => {
    const h = videoHarness();
    weaponModule.startThorgSweep(h.scene, h.body);
    weaponModule.startThorgSweep(h.scene, h.body);
    assert.equal(h.sounds[0].destroyCount, 1);
    assert.equal(h.scene.events.listenerCount('update'), 1);
    h.body.setFrame('dying00'); h.tick(20);
    assert.equal(h.body.frame.name, 'dying00');
    assert.equal(h.body._thorgSweepActive, false);
    assert.equal(h.sounds[1].destroyCount, 1);
  });
});

describe("Rage presentation", () => {
  const { EventEmitter } = require('node:events');

  const sweep = require('../src/shared/characters/thorgSweep');
  const exportsObject = loadClientModule(require.resolve('../src/client/game/characters/thorg/rageVisual.js'), {
    require: () => sweep,
  });

  test('rage clone keeps physical transform untouched, restores alpha each render, and cleans up', () => {
    const events = new EventEmitter();
    const clone = {destroy(){this.destroyed=true;}};
    for (const method of ['setVisible','setDepth','setTexture','setPosition','setOrigin','setScale','setFlip','setRotation','setAlpha','setTint'])
      clone[method] = function(...args) { this[method+'Args'] = args; return this; };
    const body = Object.assign(new EventEmitter(), {active:true,x:50,y:100,alpha:0.7,scaleX:0.7,scaleY:0.7,originX:0.5,originY:0.5,depth:30,visible:true,texture:{key:'thorg'},frame:{name:'idle00'}});
    const scene = {events,add:{sprite:()=>clone}};
    const setRage = exportsObject.setThorgRageVisual;
    setRage(scene,body,true); setRage(scene,body,true);
    const standingHudTop = body._bbHudTopOffset;
    assert.ok(standingHudTop < -52, 'HUD rises above the enlarged helmet');
    assert.equal(events.listenerCount('prerender'),1);
    events.emit('prerender');
    assert.equal(body.alpha,0);
    assert.equal(body.scaleX,0.7); assert.equal(body.y,100); assert.equal(body.originY,0.5);
    assert.equal(clone.setScaleArgs[0],0.875);
    events.emit('render'); assert.equal(body.alpha,0.7);
    events.emit('prerender'); events.emit('render');
    assert.equal(clone.setScaleArgs[0],0.875);
    body.frame = { name: 'powerup03', y: -30, realHeight: 128 };
    events.emit('prerender'); events.emit('render');
    assert.equal(body._bbHudTopOffset, standingHudTop, 'raised mace does not move the HUD above the head');
    body.frame = { name: 'idle00' };
    events.emit('prerender'); events.emit('render');
    assert.equal(body._bbHudTopOffset, standingHudTop, 'returns to stable grown height');
    setRage(scene,body,false);
    assert.equal(body._bbHudTopOffset, undefined, 'normal HUD anchor is restored');
    assert.equal(body._bbVisualScale,1); assert.equal(body.alpha,0.7);
    assert.equal(events.listenerCount('prerender'),0); assert.equal(clone.destroyed,true);
  });
});
