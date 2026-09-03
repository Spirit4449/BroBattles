const { randomUUID, randomInt } = require("crypto");
const {
  getAllCharacters,
  LEVEL_CAP,
} = require("../../../lib/characterStats.js");
const { difficultyForTrophies } = require("./config");
const { createRandom } = require("./random");

// 64 x 48 = 3,072 distinct player-style names, without a bot prefix.
const first =
  "Amber Arctic Astro Azure Blazing Blue Bold Breezy Bronze Cedar Cherry Cloud Cobalt Copper Cosmic Crimson Crystal Daring Dawn Desert Dusk Echo Electric Ember Emerald Frost Golden Granite Hidden Indigo Iron Jade Jungle Lunar Maple Midnight Misty Neon Noble Nova Obsidian Ocean Olive Onyx Opal Orange Peach Pearl Pixel Polar Quiet Rapid Red River Rose Royal Ruby Sandy Scarlet Silver Solar Storm Sunny Velvet".split(
    " ",
  );
const last =
  "Badger Bear Beetle Birch Blossom Breeze Comet Coyote Crane Cricket Crow Deer Dolphin Dragon Eagle Falcon Fern Finch Firefly Fox Gecko Hawk Heron Jaguar Jay Kestrel Koala Lynx Mantis Maple Moth Otter Owl Panda Panther Pebble Pine Puma Raven Robin Sparrow Sprout Star Tiger Turtle Viper Willow Wolf".split(
    " ",
  );

const TROLL_NAMES = Object.freeze([
  "SkillIssue",
  "TouchGrass",
  "DeleteTheGame",
  "WhyYouRunnin",
  "NerfMePls",
  "NoobSlayer99",
  "CtrlAltDefeat",
  "WiFi_Dropped",
  "GG_Ez",
  "Uninstalling",
  "PotatoAim",
  "CertifiedNoob",
  "CarryMeDaddy",
  "DefinitelyNotABot",
  "ImNotABot",
  "AFK_Brb",
  "LaggingHard",
  "Ping999",
  "UrAdopted",
  "WashedUp",
  "MomSaidMyTurn",
  "OneTap",
  "YouDied",
  "JustBetter",
  "SaltyTears",
  "GetGud",
  "CryAboutIt",
  "BlameMyLag",
  "NPC_Energy",
  "ILagged",
  "EzClap",
  "HeHeHeHa",
  "L_Bozo",
  "HoldThisL",
  "ThanksForElo",
  "WhatIsAim",
  "AltF4Pro",
  "ClickFaster",
  "StandingStill",
  "MissedAgain",
  "RunningInCircles",
  "DogWater",
  "BuiltDifferent",
  "SweatyPalms",
  "TouchSomeGrass",
  "EmotionalDamage",
  "YouMadBro",
  "CantTouchThis",
  "TryHard77",
  "KeyboardWarrior",
  "SpectatorMode",
  "CarryOrFeed",
  "NoScope360",
  "LagMadeMeDoIt",
  "W_Key_Only",
  "BornToLose",
  "GG_GoNext",
  "WhoAsked",
  "CopiumOverdose",
  "SkillGap",
  "SkillDiff",
  "TooEz",
  "ReportMe",
  "UninstallPlz",
  "YourWifiSucks",
  "IsThisEasyMode",
  "PressAltF4",
  "BotOrNot",
  "GGEasy",
  "IHaveNoIdea",
  "WhyAmIHere",
  "PleaseDontHitMe",
  "TargetDummy",
  "FreeKill",
  "FreeKills",
  "EasyTarget",
  "ImLagging",
  "WifiLag",
  "PacketLoss",
  "999Ping",
  "DontShoot",
  "PeacefulBro",
  "JustA_Bot",
  "NotABotTrust",
  "BroMoment",
  "BruhMoment",
  "SkillCapped",
  "HardStuck",
  "BronzeForever",
  "IronStuck",
  "ReportMyTeam",
  "BlameLag",
  "MyMomUnpluggedIt",
  "CatOnKeyboard",
  "SpammingButtons",
  "ButtonMasher",
  "RunningAway",
  "HideAndSeek",
  "GotYou",
  "OutOfPotions",
  "OnlyHeadshots",
  "LuckyShot",
  "RageQuitIncoming",
  "AboutToQuit",
  "GG_NoRe",
  "TooSlow",
  "CantCatchMe",
  "SpeedyNoob",
  "SneakySneak",
  "ShadowStep",
  "ZeroDamage",
  "OneHP_Dream",
  "ClutchOrKick",
  "DontChoke",
  "ChokeArtist",
  "PanicJump",
  "WiffedIt",
  "MissedUlt",
  "FatFingered",
  "AccidentalWin",
  "LuckyGuess",
  "GGsOnly",
  "NoHands",
  "BlindPlayer",
  "PlayingOnFridge",
  "SmartToaster",
  "MicrowaveAim",
  "CardboardV",
  "WoodTier",
  "ProNoob",
  "DodgeThis",
  "CatchTheseHands",
  "EZPZ",
  "GetClapped",
  "RunItDown",
]);

const GAMER_NAMES = Object.freeze([
  "xX_Shadow_Xx",
  "DarkKnight99",
  "SneakyNinja",
  "FireStorm_42",
  "IceCold_07",
  "ViperStrike",
  "PhantomBlade",
  "Toxic_Waste",
  "ApexPredator",
  "SilentDeath",
  "PixelKing",
  "Vortex_99",
  "SniperGod",
  "GhostRider42",
  "HyperSpeed",
  "CyberWolf_",
  "ThunderGod",
  "BlazeIt_21",
  "NightHawk_X",
  "IronFist_00",
  "Savage_Boy",
  "ChaosLord",
  "AlphaWolf_9",
  "Omega_Zero",
  "NeonRider",
  "ZeroCool",
  "Reaper_X",
  "FrostByte_",
  "MysticMage",
  "StormBreaker",
  "FatalBlow",
  "DoomSlayer_",
  "Echo_Strike",
  "Shadow_Ops",
  "Quantum_Leap",
  "RogueOne_",
  "Venomous_V",
  "SolarFlare_",
  "CosmicRay",
  "Starlight_7",
  "SilverFang",
  "BloodHound_",
  "DarkMatter_",
  "SuperNova_X",
  "VoidWalker",
  "BladeRunner_",
  "GlitchMatrix",
  "RetroGamer",
  "PixelHero",
  "ArcadeKing",
  "TurboGamer",
  "NovaBlast",
  "RavenClaw",
  "DragonSlayer",
  "TitanSmash",
  "RapidFire",
  "IronClad",
  "PhoenixRise",
  "FrostBite",
  "ShadowHunter",
  "GhostSniper",
  "NightCrawler",
  "BloodThirsty",
  "StormChaser",
  "Valkyrie",
  "HavocMaker",
  "Raptor",
  "CobraKai",
  "SteelTitan",
  "Deadshot",
  "Overkill",
  "Wildcard",
  "Blitzkrieg",
  "Rampage",
  "Outlaw",
  "Maverick",
  "Specter",
  "WarMachine",
  "GraveDigger",
  "Hellfire",
  "Striker",
  "GrimReaper",
  "DeathWish",
  "Blackout",
  "Bulletproof",
  "Lockdown",
  "Crossfire",
  "Vandall",
  "Phantom",
  "Riptide",
]);

const BOT_NAMES = Object.freeze([
  ...new Set([
    ...TROLL_NAMES,
    ...GAMER_NAMES,
    ...first.flatMap((a) => last.map((b) => a + b)),
  ]),
]);

function characterLevel(player) {
  let levels = player.char_levels || {};
  try {
    if (typeof levels === "string") levels = JSON.parse(levels);
  } catch {
    levels = {};
  }
  return Math.max(
    1,
    Math.min(
      LEVEL_CAP,
      Number(player.level || levels?.[player.char_class]) || 1,
    ),
  );
}

function createBotParticipants(
  humans,
  teamSize,
  {
    seed = randomInt(0x100000000),
    healthOverride = null,
    names = new Set(),
    realNames = [],
  } = {},
) {
  const random = createRandom(seed);
  const levels = humans.map(characterLevel).sort((a, b) => a - b);
  const n = levels.length;
  if (!n) throw new Error("Bot matches require a human participant.");
  const level = Math.round(
    (levels[Math.floor((n - 1) / 2)] + levels[Math.floor(n / 2)]) / 2,
  );
  const lobbyTrophies = Math.round(
    humans.reduce((sum, p) => sum + Math.max(0, Number(p.trophies) || 0), 0) /
      n,
  );
  const reserved = new Set(
    [...names, ...humans.map((p) => p.name)].map((s) =>
      String(s).toLowerCase(),
    ),
  );
  const available = BOT_NAMES.filter(
    (name) => !reserved.has(name.toLowerCase()),
  );
  const characters = getAllCharacters();
  const bots = [];

  // Filter candidate real names to only those not reserved
  const availableRealNames = (Array.isArray(realNames) ? realNames : []).filter(
    (name) => name && !reserved.has(String(name).toLowerCase()),
  );

  for (const team of ["team1", "team2"]) {
    const count = humans.filter((p) => p.team === team).length;
    for (let i = count; i < teamSize; i++) {
      let name = null;

      // 1. Chance to use a real username from the database
      if (availableRealNames.length > 0 && random() < 0.25) {
        const idx = Math.floor(random() * availableRealNames.length);
        const candidate = availableRealNames[idx];
        if (!reserved.has(candidate.toLowerCase())) {
          name = candidate;
          availableRealNames.splice(idx, 1);
        }
      }

      // 2. Sometimes randomly use the guest default username format ("Guest" or "GuestXXXXXX")
      if (!name && random() < 0.15) {
        const guestDefault =
          random() < 0.3
            ? "Guest"
            : `Guest${Math.floor(100000 + random() * 900000)}`;
        if (!reserved.has(guestDefault.toLowerCase())) {
          name = guestDefault;
        }
      }

      // 3. Chance to prioritize troll names
      if (!name && random() < 0.35) {
        const trollCandidates = TROLL_NAMES.filter(
          (t) => !reserved.has(t.toLowerCase()),
        );
        if (trollCandidates.length > 0) {
          name = trollCandidates[Math.floor(random() * trollCandidates.length)];
        }
      }

      // 4. Default: pick from the comprehensive available pool
      if (!name) {
        const filteredAvailable = available.filter(
          (a) => !reserved.has(a.toLowerCase()),
        );
        if (!filteredAvailable.length)
          throw new Error("Bot name pool exhausted.");
        const chosenIndex = Math.floor(random() * filteredAvailable.length);
        name = filteredAvailable[chosenIndex];
        const origIdx = available.indexOf(name);
        if (origIdx >= 0) available.splice(origIdx, 1);
      }

      reserved.add(name.toLowerCase());

      const char_class = characters[Math.floor(random() * characters.length)];
      const trophySpread = Math.max(
        15,
        Math.min(120, Math.round(lobbyTrophies * 0.08)),
      );
      let trophyOffset = Math.round((random() + random() - 1) * trophySpread);
      if (trophyOffset === 0) trophyOffset = lobbyTrophies === 0 || random() >= 0.5 ? 1 : -1;
      const trophies = Math.max(0, lobbyTrophies + trophyOffset);
      bots.push({
        participantId: `bot:${randomUUID()}`,
        user_id: null,
        party_id: null,
        isBot: true,
        name,
        team,
        char_class,
        level,
        trophies,
        profile_icon_id: char_class,
        seed: Math.floor(random() * 0x100000000),
        // Visible trophies vary like a real lobby. Difficulty remains tied to
        // the human lobby rating so random identity flavor cannot alter skill.
        difficulty: difficultyForTrophies(lobbyTrophies),
        botHealthOverride: healthOverride,
      });
    }
  }
  return bots;
}

module.exports = {
  BOT_NAMES,
  TROLL_NAMES,
  GAMER_NAMES,
  createBotParticipants,
  characterLevel,
};
