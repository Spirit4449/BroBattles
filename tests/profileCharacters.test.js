const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createLobbyFixture } = require('./helpers/lobbyFixture');

test('skin picker saves owned choices once, previews locked choices and rolls back failed saves without closing', async () => {
  const catalog = structuredClone(require('../src/shared/catalogs/skinsCatalog.json'));
  const skins = catalog.characters.gloop.skins;
  skins.push({ ...skins[1], id: 'locked-test-skin', name: 'Locked preview' });
  const user = { name: 'Owner', char_class: 'gloop', char_levels: { gloop: 1 },
    owned_skin_ids: [skins[1].id], selected_skin_id_by_char: { gloop: skins[0].id } };
  const saves = [];
  let completeSave;
  const f = createLobbyFixture({
    imports: { [path.resolve(__dirname, '../src/shared/catalogs/skinsCatalog.json')]: catalog },
    globals: { fetch: async (url, options = {}) => {
      if (url === '/skins/owned') return { ok: true, json: async () => ({ ownedSkinIds: user.owned_skin_ids }) };
      if (url === '/skins/select') {
        saves.push(JSON.parse(options.body));
        return new Promise(resolve => { completeSave = success => resolve({ ok: success, json: async () => ({ success, error: 'Save failed' }) }); });
      }
      throw new Error(`Unexpected request ${url}`);
    } },
  });
  const api = f.load('src/client/lobby/profile/characterSelectController.js');
  api.initializeCharacterSelect(user);
  await f.settle();
  api.openCharacterSelect();
  f.document.querySelector('[data-char="gloop"]').click();
  const next = () => f.document.querySelector('[aria-label="Next skin"]').click();
  const preview = () => f.document.querySelector('.character-details-skin-name-text').textContent;
  next(); next();
  assert.equal(saves.length, 1);
  assert.equal(saves[0].skinId, skins[1].id);
  assert.equal(user.selected_skin_id_by_char.gloop, skins[0].id, 'unconfirmed selection does not change equipped state');
  completeSave(true);
  await f.settle();
  assert.equal(user.selected_skin_id_by_char.gloop, skins[1].id);
  const popup = f.document.querySelector('.character-details-overlay');
  assert.equal(popup.getAttribute('aria-hidden'), 'false');
  next();
  await f.settle();
  assert.equal(preview(), skins[2].name);
  assert.equal(saves.length, 1, 'locked previews do not save');
  next();
  assert.equal(saves.length, 2);
  completeSave(false);
  await f.settle();
  assert.equal(preview(), skins[2].name, 'failed selection restores the prior preview');
  assert.equal(user.selected_skin_id_by_char.gloop, skins[1].id);
  assert.equal(popup.getAttribute('aria-hidden'), 'false');
});

test('showcase is available without a character allowlist and respects reduced motion', () => {
  const { loadClientModule } = require('./helpers/clientModule');
  let reduced = false;
  const api = loadClientModule('src/client/lobby/profile/characterShowcase.js', {
    window: { matchMedia: () => ({ matches: reduced }) },
  });
  assert.equal(api.hasCharacterShowcase('future-character'), true);
  assert.equal(api.hasCharacterShowcase('gloop'), true);
  reduced = true;
  assert.equal(api.hasCharacterShowcase('future-character'), false);
  assert.equal(api.hasCharacterShowcase(''), false);
});

test('new characters get showcase framing and rosters without per-character scripts', () => {
  const { createClientModuleGraph } = require('./helpers/clientModule');
  const graph = createClientModuleGraph({ imports: {
    '../../../shared/characters/index.js': { characterDefinitions: {
      newcomer: { basicAction: 'newcomer-swing' }, partner: { basicAction: 'partner-shot' },
    } },
  } });
  const { resolveShowcaseKit, dummyCharacterFor, showcaseRoster } = graph.load('src/client/lobby/profile/showcaseKit.js');
  assert.equal(dummyCharacterFor('newcomer'), 'partner');
  const roster = showcaseRoster({ character: 'newcomer', mode: 'fight', level: 7 });
  assert.equal(roster.length, 2);
  assert.ok(roster.every(p => p.level === 7));
  const custom = resolveShowcaseKit('newcomer', { visual: { height: 80 } });
  assert.equal(custom.visual.height, 80);
  assert.equal(resolveShowcaseKit('newcomer').visual.height, undefined);
});

test('showcase discovers optional kits and supplies defaults when no file exists', () => {
  const { loadClientModule, createClientModuleGraph } = require('./helpers/clientModule');
  const defaults = createClientModuleGraph().load('src/client/lobby/profile/showcaseKit.js');
  const modules = new Map([['./newcomer/showcase.js', { default: { visual: { height: 81 } } }]]);
  let loaded = 0;
  const context = name => { loaded++; return modules.get(name); };
  context.keys = () => [...modules.keys()];
  const localRequire = name => {
    assert.equal(name, './showcaseKit.js');
    return defaults;
  };
  localRequire.context = (directory, recursive, pattern) => {
    assert.equal(directory, '../../game/characters');
    assert.equal(recursive, true);
    assert.ok(pattern.test('./newcomer/showcase.js'));
    assert.equal(pattern.test('./shared/showcase/nested.js'), false);
    return context;
  };
  const { getShowcaseKit } = loadClientModule('src/client/lobby/profile/showcaseKits.js', { require: localRequire });
  const custom = getShowcaseKit('newcomer');
  assert.equal(custom.visual.height, 81);
  assert.equal(getShowcaseKit('newcomer'), custom);
  assert.equal(loaded, 1, 'a character module is loaded once');
  assert.ok(getShowcaseKit('without-override').visual);
  assert.equal(loaded, 1, 'missing overrides do not attempt a module import');
});

test('showcase normalizes padded art and reserves a full accelerating jump', () => {
  const { createClientModuleGraph } = require('./helpers/clientModule');
  const motion = createClientModuleGraph().load('src/client/lobby/profile/showcaseMotion.js');
  const physics = require('../src/shared/physics/movementPhysics.json');
  const tight = { width: 50, height: 100 };
  const padded = { left: 80, top: 100, width: 50, height: 100 };
  assert.equal(motion.showcaseSpriteScale(tight), motion.showcaseSpriteScale(padded), 'atlas padding does not change the scale');
  assert.equal(tight.height * motion.showcaseSpriteScale(tight), motion.SHOWCASE_ART_HEIGHT);
  const wide = { width: 100, height: 50 };
  const wideScale = motion.showcaseSpriteScale(wide);
  assert.ok(wide.width * wideScale <= motion.SHOWCASE_ART_HEIGHT, 'wide characters cannot grow to fill the height');
  assert.ok(wide.height * wideScale < tight.height * motion.showcaseSpriteScale(tight));
  const withProp = { width: 50, height: 100 };
  const bodyScale = motion.showcaseSpriteScale(withProp, { bodyTop: 0.5, maxWidth: 120 });
  assert.equal(withProp.height * 0.5 * bodyScale, motion.SHOWCASE_ART_HEIGHT, 'overhead props do not shrink the body');
  const jump = motion.showcaseJumpMotion();
  const apex = jump.launch / physics.gravity * 1000;
  assert.equal(jump.sample(0).height, 0);
  assert.ok(Math.abs(jump.sample(apex).height - jump.height) < 1e-8);
  assert.ok(Math.abs(jump.sample(apex).velocity) < 1e-8);
  assert.ok(jump.sample(apex / 2).height > jump.height / 2, 'jump decelerates as it rises');
  assert.ok(jump.sample(apex / 2).velocity < 0);
  assert.ok(jump.sample((apex + jump.durationMs) / 2).velocity > 0);
  assert.ok(jump.durationMs - apex < apex, 'falling gravity gives a quicker descent');
  assert.ok(jump.sample(jump.durationMs).height < 1e-8);
  assert.ok(motion.SHOWCASE_ART_HEIGHT + jump.height + 48 < motion.SHOWCASE_WORLD_HEIGHT * 0.71, 'full jump and HUD fit below the view switcher');
});

test('showcase opaque measurements restore trimmed offsets and ignore transparent rows and columns', () => {
  const { createClientModuleGraph } = require('./helpers/clientModule');
  const { showcaseOpaqueBounds } = createClientModuleGraph().load('src/client/lobby/profile/showcaseMotion.js');
  const pixels = new Uint8ClampedArray(8 * 8 * 4);
  pixels[(3 * 8 + 3) * 4 + 3] = 255;
  pixels[(5 * 8 + 4) * 4 + 3] = 255;
  const frame = { cutX: 2, cutY: 2, cutWidth: 4, cutHeight: 4, x: 11, y: 15 };
  const result = showcaseOpaqueBounds(frame, pixels, 8);
  assert.equal(result.left, 12);
  assert.equal(result.top, 16);
  assert.equal(result.right, 14);
  assert.equal(result.bottom, 19);
  assert.equal(result.width, 2);
  assert.equal(result.height, 3);
  assert.equal(showcaseOpaqueBounds(frame, null, 8).width, frame.cutWidth);
});

test('Thorg keeps larger art framing than the default fighter', () => {
  const { createClientModuleGraph } = require('./helpers/clientModule');
  const graph = createClientModuleGraph();
  const { showcaseSpriteScale } = graph.load('src/client/lobby/profile/showcaseMotion.js');
  const thorg = graph.load('src/client/game/characters/thorg/showcase.js').default;
  const square = { width: 100, height: 100 }, upright = { width: 60, height: 100 };
  assert.ok(square.height * showcaseSpriteScale(square, thorg.visual) > upright.height * showcaseSpriteScale(upright));
});

const { PreviewSession } = require('../src/shared/combat/previewSession');
const combatEffects = require('../src/shared/combat/runtime/effects/effectManager');
const { requestBasic } = require('../src/shared/combat/combat');
function preview(character, opponent = 'thorg', extra = []) {
  const events = [];
  const session = new PreviewSession([
    { id: 'hero', character, team: 'team1', x: -100, level: 3 },
    { id: 'enemy', character: opponent, team: 'team2', x: 100, level: 3 }, ...extra,
  ], { random: () => 0, onEvent: (type, payload) => events.push({ type, payload, at: session.now }) });
  const hero = session.players.get('hero'), enemy = session.players.get('enemy');
  const advance = ms => { for (let time = 0; time < ms; time += session.FIXED_DT_MS) session.step(); };
  return { session, hero, enemy, events, advance };
}

test('showcase uses real outgoing/return shuriken contacts, ammo refunds and ally filtering', () => {
  const { session, hero, enemy, events, advance } = preview('ninja', 'thorg', [{ id: 'ally', character: 'thorg', team: 'team1', x: 50 }]);
  const ally = session.players.get('ally'), initial = ally.health;
  assert.ok(requestBasic(session, hero, enemy, {}, () => 0.5, session.now));
  assert.equal(hero.ammoState.charges, 0);
  advance(1800);
  const contacts = events.filter(e => e.type === 'game:action' && e.payload.action.type === 'ninja-impact');
  assert.ok(contacts.some(e => e.payload.action.phase === 'outward'));
  assert.ok(contacts.some(e => e.payload.action.phase === 'return'));
  assert.equal(enemy.maxHealth - enemy.health, hero.baseDamage * 2);
  assert.equal(ally.health, initial);
  assert.equal(hero.ammoState.charges, hero.ammoState.capacity);
});

test('Wizard burst uses every ammo slot at legal cooldowns and real projectile contact after release', () => {
  const { session, hero, enemy, events, advance } = preview('wizard');
  enemy.health = enemy.maxHealth = 10000;
  for (let shot = 0; shot < hero.ammoState.capacity; shot++) {
    assert.ok(requestBasic(session, hero, enemy, {}, () => 0.5, session.now));
    assert.equal(requestBasic(session, hero, enemy, {}, () => 0.5, session.now), false);
    advance(hero.ammoState.cooldownMs);
  }
  assert.equal(hero.ammoState.charges, 0);
  const releases = events.filter(e => e.payload.action?.type === 'wizard-fireball-release');
  assert.equal(releases.length, hero.ammoState.capacity);
  assert.ok(releases.every(e => e.payload.action.startup === 0));
  const firstHit = events.find(e => e.type === 'health-update');
  assert.ok(firstHit.at > releases[0].at, 'damage waits for travel/contact');
  assert.ok(releases.at(-1).at - releases[0].at < hero.ammoState.reloadMs);
  advance(hero.ammoState.reloadMs);
  assert.ok(hero.ammoState.charges > 0);
});

test('Wizard surge grants real expiring modifiers to living allies, excluding dead allies and enemies', () => {
  const { session, hero, enemy, events, advance } = preview('wizard', 'thorg', [
    { id: 'ally', character: 'ninja', team: 'team1', x: -40 },
    { id: 'dead', character: 'ninja', team: 'team1', x: -50 },
  ]);
  session.players.get('dead').isAlive = false;
  hero.superCharge = hero.maxSuperCharge;
  assert.ok(session.requestSpecial(hero.name));
  const surge = events.find(e => e.type === 'wizard:arcane-surge').payload;
  assert.deepEqual(surge.recipients.map(p => p.username), ['hero', 'ally']);
  for (const id of ['hero', 'ally']) {
    const p = session.players.get(id);
    assert.ok(combatEffects.getModifiers(p, session.now).damageMult > 1);
    assert.ok(combatEffects.snapshotActive(p, session.now).rage > 0);
  }
  assert.equal(combatEffects.getModifiers(enemy, session.now).damageMult, 1);
  advance(combatEffects.snapshotActive(hero, session.now).rage + 50);
  assert.equal(combatEffects.getModifiers(hero, session.now).damageMult, 1);
  assert.deepEqual(combatEffects.snapshotActive(hero, session.now), {});
});

test('Huntress super ignites targets and applies damage ticks after the arrows stop', () => {
  const { session, hero, enemy, events, advance } = preview('huntress');
  enemy.health = enemy.maxHealth = 10000;
  hero.superCharge = hero.maxSuperCharge;
  assert.ok(session.requestSpecial(hero.name, { id: 'burn', aim: { angle: 0, power: 0.5 } }));
  advance(1000);
  assert.ok(combatEffects.snapshotActive(enemy, session.now).huntressBurn > 0);
  const hp = enemy.health;
  advance(1800);
  assert.ok(enemy.health < hp);
  assert.ok(events.some(e => e.type === 'health-update' && e.payload.cause === 'burn'));
});

test('Gloop basic and hook apply real slowing modifiers, pull and expiry', () => {
  const { session, hero, enemy, advance } = preview('gloop', 'ninja');
  assert.ok(requestBasic(session, hero, enemy, {}, () => 0.5, session.now));
  advance(1000);
  assert.ok(combatEffects.getModifiers(enemy, session.now).speedMult < 1);
  assert.ok(combatEffects.getModifiers(enemy, session.now).jumpMult < 1);
  advance(4000);
  assert.equal(combatEffects.getModifiers(enemy, session.now).speedMult, 1);
  hero.superCharge = hero.maxSuperCharge;
  const distance = Math.abs(enemy.x - hero.x);
  assert.ok(session.requestSpecial(hero.name, { aim: { angle: 0, direction: 1 } }));
  advance(1300);
  assert.ok(Math.abs(enemy.x - hero.x) < distance);
  assert.ok(combatEffects.getModifiers(enemy, session.now).speedMult < 1);
});

test('showcase rosters are equal-level, support teams, and select Ninja for Gloop', () => {
  const { createClientModuleGraph } = require('./helpers/clientModule');
  const { showcaseRoster } = createClientModuleGraph().load('src/client/lobby/profile/showcaseKit.js');
  const gloop = showcaseRoster({ character: 'gloop', mode: 'fight', level: 8 });
  assert.equal(gloop[1].character, 'ninja');
  const wizard = showcaseRoster({ character: 'wizard', mode: 'fight', level: 8 });
  assert.equal(wizard.length, 3);
  assert.equal(wizard.filter(p => p.team !== wizard[0].team).length, 1);
  assert.equal(wizard.find(p => p.id === 'ally').role, 'bystander');
  assert.equal(wizard.filter(p => p.team === wizard[0].team).length, 2);
  assert.ok([...gloop, ...wizard].every(p => p.level === 8));
  assert.equal(new Set(wizard.map(p => p.id)).size, wizard.length);
});

test('independent showcase fighters spend ammo without turns and keep a settled firing position', () => {
  const { createClientModuleGraph } = require('./helpers/clientModule');
  const { createShowcaseDirector } = createClientModuleGraph().load('src/client/lobby/profile/showcaseDirector.js');
  const { session, hero, enemy, events } = preview('wizard', 'wizard');
  hero.health = hero.maxHealth = enemy.health = enemy.maxHealth = 10000;
  const initial = [hero.x, enemy.x];
  const direct = createShowcaseDirector(session);
  for (let i = 0; i < 150; i++) session.step(direct);
  const casts = events.filter(e => e.payload.action?.type === 'wizard-fireball');
  assert.ok(casts.filter(e => e.payload.playerName === hero.name).length >= 2);
  assert.ok(casts.filter(e => e.payload.playerName === enemy.name).length >= 2);
  assert.deepEqual([hero.x, enemy.x], initial, 'fighters in their distance band do not inch or walk home after casts');
  session.dispose();
  const count = events.length;
  session.step(direct);
  assert.equal(events.length, count, 'disposed sessions cannot emit late attacks');
});

test('every catalog character has an executable combat implementation; missing mechanics fail coverage', () => {
  const { combatCoverageErrors } = require('../src/shared/combat/runtime/coverage');
  assert.deepEqual(combatCoverageErrors(), []);
  assert.ok(combatCoverageErrors({ newcomer: { basicAction: 'unimplemented' } }).some(error => error.includes('special')));
  assert.ok(combatCoverageErrors({ newcomer: { basicAction: 'unimplemented' } }).some(error => error.includes('basic')));
});

test('preview and GameRoom hosts produce identical combat outcomes for every character', () => {
  const { makeRoom } = require('./helpers/botRoom');
  const stats = require('../src/shared/characters/characterStats');
  const { advanceAmmo } = require('../src/shared/combat/combat');
  const attacks = require('../src/shared/combat/runtime/attackRuntimeManager');
  const protocols = require('../src/shared/combat/runtime/characterCombatRegistry');
  const abilities = require('../src/shared/combat/runtime/abilityRuntimeManager');
  for (const character of stats.getAllCharacters()) {
    const { session, hero, enemy } = preview(character);
    enemy.health = enemy.maxHealth = 10000;
    if (require('../src/shared/combat/characterProfiles').botProfile(character).melee) enemy.x = hero.x + 50;
    const { room } = makeRoom({ characters: [character, 'thorg'] });
    room.players = structuredClone(session.players);
    room.geometry = structuredClone(session.geometry); room.gameMode = null;
    room.combatClock = session.combatClock; room.combatRandom = () => 0;
    session.combatRandom = () => 0;
    room.scheduleAction = (callback, delay) => room._scheduledActions.push({ callback, at: session.now + delay });
    const serverHero = room.players.get('hero'), serverEnemy = room.players.get('enemy');
    const advance = ticks => {
      for (let i = 0; i < ticks; i++) {
        session.step(); room._tickId = session._tickId; room._simulationMono = session._simulationMono;
        const due = room._scheduledActions.filter(a => a.at <= session.now);
        room._scheduledActions = room._scheduledActions.filter(a => a.at > session.now);
        for (const a of due) a.callback();
        for (const p of room.players.values()) advanceAmmo(p, room.FIXED_DT_MS);
        abilities.tickActiveAbilities(room, session.now);
        attacks.tickActiveAttacks(room, session.now); protocols.tick(room);
        for (const p of room.players.values()) if (p.isAlive) combatEffects.tickAll(p, room, session.now);
      }
    };
    assert.ok(requestBasic(session, hero, enemy, {}, () => 0.5, session.now), character);
    assert.ok(requestBasic(room, serverHero, serverEnemy, {}, () => 0.5, session.now), character);
    advance(120);
    hero.superCharge = serverHero.superCharge = hero.maxSuperCharge;
    const request = { id: 'super', aim: { angle: 0, direction: 1, power: 0.5 } };
    assert.ok(session.requestSpecial('hero', request)); assert.ok(room.requestSpecial('hero', request));
    advance(200);
    const outcome = p => ({ health: p.health, charge: p.superCharge, ammo: p.ammoState,
      effects: combatEffects.snapshotActive(p, session.now), modifiers: combatEffects.getModifiers(p, session.now), x: p.x, y: p.y });
    assert.deepEqual(outcome(hero), outcome(serverHero), `${character} caster parity`);
    assert.deepEqual(outcome(enemy), outcome(serverEnemy), `${character} victim parity`);
    session.dispose(); protocols.dispose(room);
  }
});

test('showcase starts empty, respects attack cooldowns and gives the featured fighter room to win', () => {
  const { createClientModuleGraph } = require('./helpers/clientModule');
  const graph = createClientModuleGraph();
  const { createShowcaseDirector } = graph.load('src/client/lobby/profile/showcaseDirector.js');
  const { showcaseRoster } = graph.load('src/client/lobby/profile/showcaseKit.js');
  const { characterDefinitions } = require('../src/shared/characters');
  for (const character of Object.keys(characterDefinitions)) {
    const events = [];
    const session = new PreviewSession(showcaseRoster({ character, mode: 'fight', level: 3 }), {
      random: () => 0, onEvent: (type, payload) => events.push({ type, payload, at: session.now }),
    });
    assert.ok([...session.players.values()].every(p => p.superCharge === 0));
    const direct = createShowcaseDirector(session);
    const ally = session.players.get('ally'), allyX = ally?.x;
    let defeatedAt = null;
    for (let i = 0; i < 1200; i++) {
      session.step(direct);
      if (!session.players.get('enemy').isAlive) defeatedAt ??= session.now;
      if (defeatedAt && session.now - defeatedAt > 2000) break;
    }
    const hero = session.players.get('hero');
    assert.ok(hero.isAlive, `${character} survives the sparring partner`);
    assert.equal(session.players.get('enemy').isAlive, false, `${character} can finish the demonstration`);
    assert.ok(session.players.get('enemy').combatStats?.hits > 0, 'partner still answers');
    assert.equal(events.some(e => e.type === 'player:special' && e.payload.username === 'enemy'), false);
    const casts = events.filter(e => e.type === 'game:action' && e.payload.playerName === 'hero' &&
      (e.payload.action.type === characterDefinitions[character].basicAction ||
        (e.payload.action.type === 'ninja-launch' && !e.payload.action.projectile.special)));
    for (let i = 1; i < casts.length; i++) assert.ok(casts[i].at - casts[i - 1].at + 1e-6 >= hero.ammoState.cooldownMs, character);
    if (ally) {
      assert.equal(ally.x, allyX, 'support stays in the back');
      assert.ok(hero.x > ally.x, 'the featured fighter never retreats behind the bystander');
      assert.equal(ally.combatStats, undefined, 'support does not fight');
      const surge = events.find(e => e.type === 'wizard:arcane-surge');
      assert.ok(surge?.payload.recipients.some(p => p.username === ally.name), 'earned surge reaches the bystander');
      assert.ok(surge.at > casts[0].at, 'surge was earned through attacks');
    }
    session.dispose();
  }
});
