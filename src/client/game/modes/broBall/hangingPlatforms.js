// The top of each rope stays fastened to the ceiling. The plank and ropes are
// one painted piece, with a separate one-way hitbox at the deck.
export function createHangingPlatforms(objects) {
  const decks = [];
  for (const art of objects || []) {
    if (art.texture?.key !== 'bro-ball-platform') continue;
    const surface = objects.find(object => object._mapObjectId === art._mapObjectId?.replace(/-art$/, ''))?.body;
    if (!surface) continue;
    decks.push({ art, surface, x: art.x, y: art.y, scale: art.scaleY, height: art.displayHeight,
      dip: 0, speed: 0, sway: 0, drift: 0, riders: new Set() });
  }
  const previous = new Map();
  return {
    update(players, dt) {
      const next = new Map();
      for (const player of players) {
        const body = player.body;
        if (player.active && player.visible && body?.enable) next.set(player, { feet: body.bottom, x: player.x });
      }
      for (const deck of decks) {
        const { art, surface } = deck;
        const riders = new Set();
        let sideways = 0;
        for (const [player, point] of next) {
          const last = previous.get(player);
          if (player.body.right <= surface.left || player.body.left >= surface.right ||
              Math.abs(point.feet - surface.top) > 3 || player.body.velocity.y < -2 ||
              (last && last.feet > point.feet + 1)) continue;
          riders.add(player);
          if (!deck.riders.has(player)) {
            const descent = last ? Math.max(0, point.feet - last.feet) / dt : 0;
            deck.speed += 36 + Math.min(42, descent * 0.12);
          }
          if (last) sideways += Math.max(-1, Math.min(1, (point.x - last.x) / (240 * dt)));
        }
        deck.riders = riders;
        // Damped springs give a single landing impulse, a shallow loaded sag,
        // and a small return swing when the rider leaves or changes direction.
        const sag = Math.min(2.5, riders.size * 1.7);
        deck.speed += ((sag - deck.dip) * 190 - deck.speed * 12) * dt;
        deck.dip += deck.speed * dt;
        deck.drift += ((sideways * 1.6 - deck.sway) * 80 - deck.drift * 7) * dt;
        deck.sway += deck.drift * dt;
        const drop = Math.max(-2, Math.min(6, deck.dip));
        const angle = -deck.sway / deck.height;
        art.setScale(art.scaleX, deck.scale * (1 + drop / deck.height));
        art.setRotation(angle).setPosition(deck.x + deck.sway / 2, deck.y + drop / 2);
      }
      previous.clear();
      for (const [player, point] of next) previous.set(player, point);
    },
    destroy() {
      for (const { art, x, y, scale } of decks) {
        if (art.active) art.setRotation(0).setPosition(x, y).setScale(art.scaleX, scale);
      }
      previous.clear();
    },
  };
}
