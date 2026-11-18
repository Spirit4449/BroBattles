export const DEATH_LOOT_GLOW = "death-loot-soft-glow";
export const VAULT_PUFF = "bb-vault-fx-puff";

const styles = {
  [DEATH_LOOT_GLOW]: { size: 64, inner: 0, stops: [[0.2, 0.65], [0.5, 0.18]] },
  [VAULT_PUFF]: { size: 48, inner: 2, stops: [[0.6, 0.55]] },
};

export function ensureSoftGlow(scene, key) {
  if (scene.textures?.exists?.(key)) return true;
  try {
    const { size, inner, stops } = styles[key];
    const texture = scene.textures.createCanvas(key, size, size);
    const ctx = texture.context || texture.getContext();
    const r = size / 2;
    const gradient = ctx.createRadialGradient(r, r, inner, r, r, r);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    for (const [position, alpha] of stops) gradient.addColorStop(position, `rgba(255,255,255,${alpha})`);
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    texture.refresh();
    return true;
  } catch (_) {
    return false;
  }
}
