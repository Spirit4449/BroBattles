// Events passed between browser modules via window, document or a dialog.
export const BROWSER_EVENTS = Object.freeze({
  BATTLE_REVEALED: "game:ready",
  CHARACTER_CURRENCY_SHORTFALL: "character-currency-shortfall",
  LOBBY_JOIN_REQUEST: "lobby:join-request",
  LOBBY_REVEALED: "lobby:ready",
  MATCHMAKING_START: "bb:matchmaking-start",
  OPEN_TITLE_SHOP: "bb:open-title-shop",
  RENDERER_CHANGED: "bb:rendererchange",
  SETTINGS_RESET: "settingsreset",
});
