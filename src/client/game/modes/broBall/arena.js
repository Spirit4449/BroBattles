import { ballRules } from '../../../../shared/broBall';

export const TEAM_COLORS = {
  team1: { main: 0x3d8fe0, light: 0x8fd0ff, dark: 0x1f4f99, glow: 0x5ac7fa },
  team2: { main: 0xe2504c, light: 0xffa9a0, dark: 0x8e2430, glow: 0xff7684 },
};

const SETTLE_MS = 740;
const WALL_IDS = { team1: 'wall-left-art', team2: 'wall-right-art' };
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function createNetSurface(scene, Phaser, wall, goal) {
  const original = wall.texture;
  const frame = wall.frame;
  const { cutX, cutY, cutWidth, cutHeight } = frame;
  const origin = wall.getTopLeft();
  const toX = x => (wall.flipX ? origin.x + wall.displayWidth - x : x - origin.x) / wall.scaleX;
  const startX = clamp(Math.ceil(Math.min(toX(goal.x), toX(goal.backX))), 0, cutWidth);
  const endX = clamp(Math.floor(Math.max(toX(goal.x), toX(goal.backX))), 0, cutWidth);
  const startY = clamp(Math.ceil((goal.top - origin.y) / wall.scaleY), 0, cutHeight);
  const endY = clamp(Math.floor((goal.bottom - origin.y) / wall.scaleY), 0, cutHeight);
  if (endX <= startX || endY <= startY) return null;

  const texture = scene.textures.createCanvas(`bro-ball-net-${Phaser.Utils.String.UUID()}`, cutWidth, cutHeight);
  texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
  const context = texture.getContext();
  context.drawImage(original.getSourceImage(frame.sourceIndex), cutX, cutY, cutWidth, cutHeight,
    0, 0, cutWidth, cutHeight);
  const width = endX - startX;
  const height = endY - startY;
  const source = context.getImageData(startX, startY, width, height);
  const patch = context.createImageData(width, height);
  const sourcePixels = new Uint32Array(source.data.buffer);
  const patchPixels = new Uint32Array(patch.data.buffer);
  const backAtLeft = toX(goal.backX) < toX(goal.x);
  const worldWidth = Math.abs(goal.x - goal.backX);
  const worldHeight = goal.bottom - goal.top;
  const columns = Array.from({ length: width }, (_, col) => (col + 0.5) / width);
  const tensionX = columns.map(u => Math.sin(Math.PI * u) / wall.scaleX);
  let moving = false;

  function deform(contact, impulse) {
    for (let row = 0; row < height; row++) {
      const v = (row + 0.5) / height;
      const tensionY = Math.sin(Math.PI * v);
      const base = row * width;
      for (let col = 0; col < width; col++) {
        const u = backAtLeft ? 1 - columns[col] : columns[col];
        let push = 0;
        if (contact) {
          const distance = Math.hypot((u - contact.u) * worldWidth, (v - contact.v) * worldHeight);
          push = contact.force * Math.max(0, 1 - distance / 85) ** 2;
        }
        if (impulse) {
          const distance = Math.hypot((u - impulse.u) * worldWidth, (v - impulse.v) * worldHeight);
          const age = Math.max(0, impulse.age - distance * 1.15);
          push += impulse.force * Math.sin(age / 43) * Math.exp(-age / 180 - distance / 130) *
            (1 - impulse.age / SETTLE_MS);
        }
        // Sample the original pixel art backward through the displacement so
        // the rope knots, shading and gaps all move together without holes.
        const shift = (backAtLeft ? 1 : -1) * push * tensionX[col] * tensionY;
        const sample = clamp(Math.round(col + shift), 0, width - 1);
        patchPixels[base + col] = sourcePixels[base + sample];
      }
    }
    context.putImageData(patch, startX, startY);
    texture.refresh();
    if (!moving) wall.setTexture(texture);
    moving = true;
  }

  function rest() {
    if (moving && wall.scene) wall.setTexture(original, frame.name);
    moving = false;
  }

  return { deform, rest, destroy() { rest(); texture.destroy(); } };
}

export function createGoalNets(scene, { goals, Phaser, reduced }) {
  const nets = [];
  if (!reduced) {
    for (const [team, goal] of Object.entries(goals)) {
      const wall = scene._mapObjects?.find(object => object._mapObjectId === WALL_IDS[team]);
      const surface = wall && createNetSurface(scene, Phaser, wall, goal);
      if (surface) nets.push({
        team, goal, surface, impulse: null,
        width: Math.abs(goal.backX - goal.x), side: Math.sign(goal.backX - goal.x),
      });
    }
  }

  function strike(event, now) {
    if (event.kind !== 'goal' && event.kind !== 'post') return;
    const net = event.kind === 'goal' ? nets.find(entry => entry.team === event.defendingTeam)
      : nets.find(({ goal }) => Math.abs(event.x - goal.x) <= ballRules.radius * 2 &&
        Math.min(Math.abs(event.y - goal.top), Math.abs(event.y - goal.bottom)) <= ballRules.radius * 2);
    if (!net) return;
    const { goal, width, side } = net;
    net.impulse = {
      at: now,
      u: clamp((event.x - goal.x) * side / width, 0.15, 0.86),
      v: clamp((event.y - goal.top) / (goal.bottom - goal.top), 0.16, 0.84),
      force: event.kind === 'goal' ? 18 + 36 * clamp((event.strength ?? 500) / ballRules.maxSpeed, 0, 1) : 11,
    };
  }

  function render(now, ball) {
    for (const net of nets) {
      const { goal, side, width, surface, impulse } = net;
      let contact = null;
      if (ball && !ball.destroyed && ball.y > goal.top && ball.y < goal.bottom) {
        const u = (ball.x - goal.x) * side / width;
        if (u > 0 && u <= 1) {
          contact = { u, v: (ball.y - goal.top) / (goal.bottom - goal.top), force: 10 + 30 * u };
        }
      }
      const age = impulse ? now - impulse.at : SETTLE_MS;
      const ringing = age < SETTLE_MS ? { ...impulse, age } : null;
      if (contact || ringing) surface.deform(contact, ringing);
      else surface.rest();
    }
  }

  return { render, strike, destroy() { for (const { surface } of nets) surface.destroy(); } };
}
