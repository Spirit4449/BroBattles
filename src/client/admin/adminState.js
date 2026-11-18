import { characterDefinitions } from "../../shared/characters";

const CHARACTERS = Object.keys(characterDefinitions);

// Preset buttons add to the amount; shift-click subtracts.
const PRESETS = { coins: [100, 500, 1000, 5000, 25000], gems: [10, 50, 100, 500, 1000] };

const PAGE_SIZE = 20;

const state = { runtime: null, selectedUser: null, levelDraft: {}, view: "overview" };

const playerTools = {
  inventoryEditor: null,
  streakSaving: false,
  playerStats: null,
  inlineGrant: null,
  playerPage: 1,
  dialogForm: null,
  savedRuntime: "",
};

export { CHARACTERS, PRESETS, PAGE_SIZE, state, playerTools };
