// Redirect a blast into free space without losing its blocked component.
function resolveShockwaveImpulse(amountX, amountY, contacts = {}) {
  let x = Number(amountX) || 0;
  let y = Number(amountY) || 0;
  if (contacts.down) y = -Math.max(Math.abs(y), Math.hypot(x, y) * 0.6);
  if ((x < 0 && contacts.left) || (x > 0 && contacts.right)) {
    y = (contacts.up && !contacts.down ? 1 : -1) * Math.hypot(x, y);
    x = 0;
  }
  if ((y < 0 && contacts.up) || (y > 0 && contacts.down)) {
    const direction = contacts.right ? -1 : contacts.left ? 1 : Math.sign(x) || 1;
    x = direction * Math.hypot(x, y);
    y = 0;
  }
  return { x, y };
}
const SHOCKWAVE_MOMENTUM_MS = 350;
module.exports = { resolveShockwaveImpulse, SHOCKWAVE_MOMENTUM_MS };
