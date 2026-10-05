// Browser storage keys that more than one module reads or writes. Keys used
// by a single module stay next to that module.

// sessionStorage flag set by the game-over screen so the lobby knows the
// player is returning from a battle (plays the return transition, restores party).
export const POST_BATTLE_LOBBY_RETURN_KEY = "bb_post_battle_lobby_return";
