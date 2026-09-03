const { randomUUID, randomInt } = require("crypto");
const { getAllCharacters, LEVEL_CAP } = require("../../../lib/characterStats.js");
const { difficultyForTrophies } = require("./config");
const { createRandom } = require("./random");

// 64 x 48 = 3,072 distinct player-style names, without a bot prefix.
const first = "Amber Arctic Astro Azure Blazing Blue Bold Breezy Bronze Cedar Cherry Cloud Cobalt Copper Cosmic Crimson Crystal Daring Dawn Desert Dusk Echo Electric Ember Emerald Frost Golden Granite Hidden Indigo Iron Jade Jungle Lunar Maple Midnight Misty Neon Noble Nova Obsidian Ocean Olive Onyx Opal Orange Peach Pearl Pixel Polar Quiet Rapid Red River Rose Royal Ruby Sandy Scarlet Silver Solar Storm Sunny Velvet".split(" ");
const last = "Badger Bear Beetle Birch Blossom Breeze Comet Coyote Crane Cricket Crow Deer Dolphin Dragon Eagle Falcon Fern Finch Firefly Fox Gecko Hawk Heron Jaguar Jay Kestrel Koala Lynx Mantis Maple Moth Otter Owl Panda Panther Pebble Pine Puma Raven Robin Sparrow Sprout Star Tiger Turtle Viper Willow Wolf".split(" ");
const BOT_NAMES = Object.freeze(first.flatMap((a) => last.map((b) => a + b)));

function characterLevel(player) {
  let levels = player.char_levels || {};
  try { if (typeof levels === "string") levels = JSON.parse(levels); } catch { levels = {}; }
  return Math.max(1, Math.min(LEVEL_CAP, Number(player.level || levels?.[player.char_class]) || 1));
}

function createBotParticipants(humans, teamSize, { seed = randomInt(0x100000000), healthOverride = null, names = new Set() } = {}) {
  const random = createRandom(seed);
  const levels = humans.map(characterLevel).sort((a, b) => a - b);
  const n = levels.length;
  if (!n) throw new Error("Bot matches require a human participant.");
  const level = Math.round((levels[Math.floor((n - 1) / 2)] + levels[Math.floor(n / 2)]) / 2);
  const trophies = Math.round(humans.reduce((sum, p) => sum + Math.max(0, Number(p.trophies) || 0), 0) / n);
  const reserved = new Set([...names, ...humans.map((p) => p.name)].map((s) => String(s).toLowerCase()));
  const available = BOT_NAMES.filter((name) => !reserved.has(name.toLowerCase()));
  const characters = getAllCharacters();
  const bots = [];
  for (const team of ["team1", "team2"]) {
    const count = humans.filter((p) => p.team === team).length;
    for (let i = count; i < teamSize; i++) {
      if (!available.length) throw new Error("Bot name pool exhausted.");
      const name = available.splice(Math.floor(random() * available.length), 1)[0];
      const char_class = characters[Math.floor(random() * characters.length)];
      bots.push({ participantId: `bot:${randomUUID()}`, user_id: null, party_id: null,
        isBot: true, name, team, char_class, level, trophies,
        profile_icon_id: char_class, seed: Math.floor(random() * 0x100000000),
        difficulty: difficultyForTrophies(trophies), botHealthOverride: healthOverride });
    }
  }
  return bots;
}
module.exports = { BOT_NAMES, createBotParticipants, characterLevel };
