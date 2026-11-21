// The ball is a small pixel sphere re-shaded every frame, so its panels roll and
// tumble in 3D instead of a flat sprite spinning in place.
const ART = 24;
const PHI = (1 + Math.sqrt(5)) / 2;
const unit = ([x, y, z]) => {
  const length = Math.hypot(x, y, z);
  return [x / length, y / length, z / length];
};
// Pentagon centres of a panelled ball (the vertices of an icosahedron).
const PATCHES = [
  [0, 1, PHI], [0, -1, PHI], [0, 1, -PHI], [0, -1, -PHI], [1, PHI, 0], [-1, PHI, 0],
  [1, -PHI, 0], [-1, -PHI, 0], [PHI, 0, 1], [-PHI, 0, 1], [PHI, 0, -1], [-PHI, 0, -1],
].map(unit);
const LIGHT = unit([-0.5, -0.7, 0.62]);
const hex = value => [(value >> 16) & 255, (value >> 8) & 255, value & 255];
// White leather, black patches and soft gray seams.
const SHELL = [0xfffdf5, 0xecece8, 0xd0d3d4, 0xa8b0b6].map(hex);
const PATCH = [0x2a2733, 0x1d1b25, 0x141219, 0x0c0b10].map(hex);
const SEAM = hex(0x8d88a3);
const OUTLINE = hex(0x07060a);
const GOLD = hex(0xffd23f);
const HOT = hex(0xff8a1f);
const PATCH_EDGE = Math.cos(0.38);
const SEAM_RING = Math.cos(0.64);

function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function rotation(axis, angle) {
  const [x, y, z] = axis;
  const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
  return [
    t * x * x + c, t * x * y - s * z, t * x * z + s * y,
    t * x * y + s * z, t * y * y + c, t * y * z - s * x,
    t * x * z - s * y, t * y * z + s * x, t * z * z + c,
  ];
}

function multiply(a, b) {
  const out = new Array(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    }
  }
  return out;
}

function orthonormalize(m) {
  const x = unit([m[0], m[3], m[6]]);
  let y = [m[1], m[4], m[7]];
  const d = x[0] * y[0] + x[1] * y[1] + x[2] * y[2];
  y = unit([y[0] - d * x[0], y[1] - d * x[1], y[2] - d * x[2]]);
  const z = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
  return [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]];
}

/**
 * A ball sprite whose texture is redrawn from a 3D orientation.
 * `paint({ dt, vx, gold, heat, press })` rolls and repaints it;
 * `tumble(strength)` adds a spin around the screen axes after a hit.
 */
export function createBallSprite(scene, Phaser, diameter, key = 'bro-ball-sphere') {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const texture = scene.textures.createCanvas(key, ART, ART);
  texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
  const context = texture.getContext();
  const image = context.createImageData(ART, ART);
  const sprite = scene.add.image(0, 0, key).setDisplaySize(diameter, diameter);
  let orientation = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  let spinX = 0, spinY = 0, frame = 0;

  function paint({ dt = 1 / 60, vx = 0, radius = diameter / 2, gold = 0, heat = 0, press = null } = {}) {
    const roll = vx / radius;
    spinX *= Math.exp(-dt * 1.6);
    spinY *= Math.exp(-dt * 1.6);
    const omega = [spinX, spinY, roll];
    const speed = Math.hypot(...omega);
    if (speed > 0.0001) orientation = multiply(rotation(omega.map(v => v / speed), speed * dt), orientation);
    if (++frame % 30 === 0) orientation = orthonormalize(orientation);
    const m = orientation;
    const data = image.data;
    const half = ART / 2;
    for (let y = 0; y < ART; y++) {
      for (let x = 0; x < ART; x++) {
        const index = (y * ART + x) * 4;
        let u = (x + 0.5 - half) / half, v = (y + 0.5 - half) / half;
        if (press) {
          // Sample the original sphere from the compressed cap. The opposite
          // side stays in place, including the edge resting against the pitch.
          const depth = Math.max(0, u * press.nx + v * press.ny - 0.18) * press.stretch;
          u += depth * press.nx;
          v += depth * press.ny;
        }
        const r2 = u * u + v * v;
        if (r2 > 1) {
          data[index + 3] = 0;
          continue;
        }
        let color;
        if (r2 > (1 - 1.25 / half) ** 2) {
          color = heat > 0.2 ? mix(OUTLINE, HOT, heat * 0.8) : OUTLINE;
        } else {
          const w = Math.sqrt(1 - r2);
          // Screen normal into the ball's own frame (transpose of the orientation).
          const bx = m[0] * u + m[3] * v + m[6] * w;
          const by = m[1] * u + m[4] * v + m[7] * w;
          const bz = m[2] * u + m[5] * v + m[8] * w;
          let near = -1;
          for (const [px, py, pz] of PATCHES) near = Math.max(near, bx * px + by * py + bz * pz);
          const light = Math.max(0, u * LIGHT[0] + v * LIGHT[1] + w * LIGHT[2]);
          const tone = Math.min(3, Math.max(0, Math.floor((1 - (light * 0.85 + 0.15)) * 4.2)));
          if (near > PATCH_EDGE) color = PATCH[tone];
          else if (Math.abs(near - SEAM_RING) < 0.018) color = SEAM;
          else color = SHELL[tone];
          const shine = Math.hypot(u + 0.42, v + 0.48);
          if (shine < 0.17) color = mix(color, [255, 255, 255], 0.85);
          if (heat > 0) color = mix(color, tone < 2 ? GOLD : HOT, heat * (0.5 + tone * 0.12));
          if (gold > 0) color = mix(color, GOLD, gold * (0.75 - tone * 0.1));
        }
        data[index] = color[0];
        data[index + 1] = color[1];
        data[index + 2] = color[2];
        data[index + 3] = 255;
      }
    }
    context.putImageData(image, 0, 0);
    texture.refresh();
  }

  function tumble(strength) {
    spinX += (Math.random() - 0.5) * strength;
    spinY += (Math.random() - 0.5) * strength;
  }

  paint({ dt: 0 });
  return { sprite, paint, tumble, destroy() { sprite.destroy(); scene.textures.remove(key); } };
}

// Kicks lengthen the silhouette along the launch vector. Surfaces flatten it
// along their normal. Both ease continuously back to the round resting pose.
export function deformationAt(impact, ageMs, maxSpeed) {
  if (!impact || impact.contact?.foot) return 1;
  const power = Math.min(1, impact.strength / maxSpeed);
  const duration = 390 + 1050 * power;
  const remaining = Math.max(0, 1 - ageMs / duration);
  const recovery = remaining * remaining * (3 - 2 * remaining);
  const surface = impact.kind === 'wall' || impact.kind === 'post';
  return 1 + (surface ? -0.36 : 0.55) * power * recovery;
}

export function footPressAt(impact, ageMs, maxSpeed) {
  const contact = impact?.contact;
  const holdMs = 60;
  const recoveryMs = 200;
  if (!contact?.foot || ageMs >= holdMs + recoveryMs) return null;
  const power = Math.min(1, impact.strength / maxSpeed);
  const afterHold = Math.max(0, ageMs - holdMs);
  const remaining = 1 - afterHold / recoveryMs;
  const compression = (0.40 + 0.33 * Math.sqrt(power)) * remaining ** 2 * (3 - 2 * remaining);
  const release = Math.min(1, afterHold / 80);
  return {
    nx: -contact.nx, ny: -contact.ny, stretch: compression / (1 - compression),
    release: release ** 2 * (3 - 2 * release),
  };
}
