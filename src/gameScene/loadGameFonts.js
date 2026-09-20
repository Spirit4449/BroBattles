// Phaser renders text into a canvas once. Wait for decoded fonts before
// creating the game, on both direct entry and single-page navigation.
export function loadGameFonts(fonts) {
  return Promise.all([
    fonts.load('16px "LilitaOne-Regular"'),
    fonts.load('16px "Press Start 2P"'),
  ]);
}
