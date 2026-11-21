const fs = require('node:fs');
const path = require('node:path');
const clock = require('../../src/shared/gameConstants');
const match = require('../../src/shared/combat/matchConfig');
const movement = require('../../src/shared/physics/movementPhysics.json');
const duck = require('../../src/shared/physics/ducking');
const { LEVEL_CAP, upgradePrice } = require('../../src/shared/characters/characterStats');
const { BANK_BUST_GOLD_ARRIVAL_MS, resolveBankBustSettings } = require('../../src/shared/bankBustSettings');
const { ballRules } = require('../../src/shared/broBall');
const modeCatalog = require('../../src/shared/catalogs/gameModes.catalog.cjs');
const bank = require('../../src/server/core/gameModes/bankBust/state');
const { VAULT_BUST_FINISH_DELAY_MS } = require('../../src/server/core/gameModes/bankBust/modeRules');

const bankMode = modeCatalog.modes.find((mode) => mode.id === 'bank-bust');
const bankSettings = resolveBankBustSettings(bankMode.settings);
const crateDefaults = bank.createCenterGoldState();
const startMarker = '<!-- BEGIN GENERATED DEFAULTS -->';
const endMarker = '<!-- END GENERATED DEFAULTS -->';
const seconds = (ms) => `${ms / 1000} s`;
const percent = (ratio) => `${ratio * 100}%`;
const priceList = Array.from({ length: LEVEL_CAP - 1 }, (_, index) => upgradePrice(index + 1));

const rows = [
  ['Simulation and network',
    `${clock.SERVER_TICK_HZ} Hz simulation, ` +
    `player snapshot tick interval ${clock.SNAPSHOT_EVERY_TICKS} (${clock.SERVER_TICK_HZ / clock.SNAPSHOT_EVERY_TICKS} Hz), ` +
    `world state every ${clock.WORLD_STATE_EVERY_TICKS} ticks (${clock.SERVER_TICK_HZ / clock.WORLD_STATE_EVERY_TICKS} Hz), ` +
    `maximum render delay ${clock.MAX_RENDER_DELAY_MS} ms`,
  ],
  ['World and party',
    `${clock.WORLD_MARGIN} px world margin, elimination ${clock.FALL_OUT_DEPTH} px below the world, ` +
    `join request expires after ${seconds(clock.PARTY_JOIN_REQUEST_TIMEOUT_MS)}`,
  ],
  ['Duels clock and sudden death',
    `${seconds(match.GAME_DURATION_MS)} regular time, ` +
    `poison rises at ${match.SD_RISE_SPEED} px/s (×${match.SD_RISE_FAST_MULT} for ${seconds(match.SD_RISE_FAST_PHASE_MS)}), ` +
    `${match.SD_DAMAGE_PER_SEC} poison damage/s, ${seconds(match.SUDDEN_DEATH_MAX_MS)} sudden-death cap, ` +
    `${match.TIMER_EMIT_INTERVAL_MS} ms timer broadcast interval, ` +
    `${seconds(match.ALL_DEAD_GAME_OVER_DELAY_MS)} elimination finish delay, ` +
    `${seconds(match.ABANDON_MATCH_GRACE_MS)} all-human departure grace`,
  ],
  ['Passive regen',
    `${seconds(match.REGEN_DELAY_MS)} out of combat, ` +
    `every ${seconds(match.REGEN_TICK_MS)} for ${percent(match.REGEN_MISSING_RATIO)} of missing health, ` +
    `minimum ${match.REGEN_MIN_ABS} HP per tick and capped at max health`,
  ],
  ['Powerup spawns',
    `${seconds(match.POWERUP_SPAWN_INTERVAL_MS)} interval, ` +
    `${match.POWERUP_STARTING_COUNT} first spawns after ${seconds(match.POWERUP_FIRST_SPAWN_DELAY_MS)}, ` +
    `${match.POWERUP_MAX_ACTIVE} active cap, ${match.POWERUP_PICKUP_RADIUS} px pickup radius, ` +
    `${seconds(match.POWERUP_DESPAWN_MS)} despawn, ${seconds(match.POWERUP_OMEN_MS)} omen, ` +
    `${match.POWERUP_SPAWN_Y_LIFT} px anchored spawn lift`,
  ],
  ['Death drops',
    `${seconds(match.DEATH_DROP_DESPAWN_MS)} lifetime, ${seconds(match.DEATH_DROP_BLINK_MS)} blinking, ` +
    `${match.DEATH_DROP_PICKUP_RADIUS} px pickup radius, ${match.DEATH_DROP_COIN_MIN}–${match.DEATH_DROP_COIN_MAX} coins, ` +
    `${match.DEATH_DROP_GEM_MIN}–${match.DEATH_DROP_GEM_MAX} gems`,
  ],
  ['Hit checks',
    `${match.HIT_STALENESS_MAX_MS} ms rewind cap, ` +
    `${seconds(match.POSITION_HISTORY_MS)} / ${match.POSITION_HISTORY_DEPTH} history samples, ` +
    `${match.DUPLICATE_HIT_WINDOW_MS} ms duplicate-hit window, ` +
    `${seconds(match.ATTACK_REPLAY_WINDOW_MS)} runtime action-ID and Sparrow result retention, ` +
    `${match.STOMP_RADIUS} px stomp radius and ${match.STOMP_INTERRUPT_MS} ms interruption`,
  ],
  ['Movement',
    `${movement.maxSpeed} px/s run speed, ${movement.accel}/${movement.airAccel} px/s² ground/air acceleration, ` +
    `${movement.gravity} px/s² gravity, ${movement.jumpSpeed} px/s jump speed parameter, ` +
    `${movement.dashHorizontalSpeed}/${movement.dashSpeed} px/s horizontal/vertical dash launch components (${movement.dashDownSpeed} px/s straight down), ` +
    `${movement.dashDurationMs} ms burst, ${seconds(movement.dashCooldownMs)} cooldown, ` +
    `up to ${movement.dashCoastMs} ms coast with ${movement.dashGroundCoastDrag}/${movement.dashCoastDrag} px/s² ground/air drag`,
  ],
  ['Ducking',
    `Body height ×${duck.DUCK_HEIGHT_RATIO}, movement ×${duck.DUCK_SPEED_RATIO}, ` +
    `${duck.DUCK_MIN_HOLD_MS} ms minimum hold, ${duck.DUCK_REENTRY_DELAY_MS} ms reentry delay`,
  ],
  ['Character upgrades', `Level cap ${LEVEL_CAP}. Next-level coin costs from level 1 in order: ${priceList.join(', ')}`],
  ['Bank Bust mode',
    `${bankSettings.vaultStartingCoins} starting vault coins, ` +
    `${bankSettings.deathDropVaultCoins} vault coins per banked death-drop coin, ` +
    `${bankSettings.purchaseFloorCoins} purchase floor, ${percent(bankSettings.lowCoinsRatio)} low vault warning, ` +
    `${seconds(bankSettings.matchDurationMs)} match, ${seconds(bankSettings.respawnDelayMs)} respawn, ` +
    `${bankMode.unlockTrophies} peak trophies to unlock, ` +
    `${seconds(VAULT_BUST_FINISH_DELAY_MS)} vault bust finish delay`,
  ],
  ['Bank Bust loose gold',
    `${bank.RANDOM_GOLD_PICKUP_CAP} pickups max, ${bank.RANDOM_GOLD_PICKUP_VALUE} coins each, ` +
    `${bank.RANDOM_GOLD_PICKUP_RADIUS} px pickup radius, ${seconds(bank.RANDOM_GOLD_SPAWN_INTERVAL_MS)} spawn interval, ` +
    `${seconds(BANK_BUST_GOLD_ARRIVAL_MS)} arrival animation, claimable after ${seconds(bank.RANDOM_GOLD_CLAIMABLE_MS)}, ` +
    `coin event retention ${seconds(bank.COIN_EVENT_RETENTION_MS)}`,
  ],
  ['Bank Bust centre crate',
    `default ${crateDefaults.maxHealth} HP and ${crateDefaults.reward} coins in ${bank.CENTER_GOLD_SPILL_PILES} piles, ` +
    `first drop after ${seconds(bank.CENTER_GOLD_FIRST_SPAWN_MS)}, ` +
    `${seconds(bank.CENTER_GOLD_INTERVAL_MS)} spawn-to-spawn interval, ` +
    `${seconds(bank.CENTER_GOLD_ANNOUNCE_LEAD_MS)} advance warning, ` +
    `${seconds(bank.CENTER_GOLD_LIFETIME_MS)} crate lifetime`,
  ],
  ['Bro Ball touches',
    `${ballRules.bodyContactPadding} px of extra reach for passive player contact, ` +
    `plus ${ballRules.bodyContactTopPadding} px above the head`,
  ],
];

const table = [
  '| Area | Code defaults |',
  '| --- | --- |',
  ...rows.map(([area, values]) => `| ${area} | ${values} |`),
].join('\n');

const [mode, ...extraArgs] = process.argv.slice(2);
if (extraArgs.length || (mode && mode !== '--write' && mode !== '--check')) {
  console.error('Usage: node scripts/dev/print-constants.cjs [--write | --check]');
  process.exitCode = 1;
} else if (!mode) {
  console.log(table);
} else {
  const file = path.resolve(__dirname, '../../docs/development/constants.md');
  const original = fs.readFileSync(file, 'utf8');
  const start = original.indexOf(startMarker);
  const end = original.indexOf(endMarker);
  if (start < 0 || end <= start) throw new Error('Missing or misplaced defaults markers in constants.md');
  const updated = `${original.slice(0, start + startMarker.length)}\n${table}\n${original.slice(end)}`;
  if (mode === '--write') {
    if (original !== updated) fs.writeFileSync(file, updated);
  } else if (original !== updated) {
    console.error('Defaults in constants.md are stale. Run node scripts/dev/print-constants.cjs --write.');
    process.exitCode = 1;
  }
}
