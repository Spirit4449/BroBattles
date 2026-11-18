import { drawPixelRing } from "../../scene/fx/pixelShapes";

export function applyBurnTint({ sprite: spr, colors, nowSec, Phaser, spawnTrailParticle }) {
  const burnPulse = 0.5 + 0.5 * Math.sin(nowSec * 12 + (spr.x || 0) * 0.01);
  const burnColor = colors.sparrowBurn || 0xff7a1f;
  spr.setTint(burnPulse > 0.5 ? 0xffb46d : 0xff6a1f);
  if (Math.random() < 0.72) {
    spawnTrailParticle(
      spr.x + Phaser.Math.Between(-14, 14),
      spr.y + Phaser.Math.Between(-28, 4),
      burnColor,
      Phaser.Math.FloatBetween(3.2, 5.4),
      290,
    );
  }
  if (Math.random() < 0.38) {
    spawnTrailParticle(
      spr.x + Phaser.Math.Between(-18, 18),
      (spr.body?.bottom || spr.y + 24) + Phaser.Math.Between(-4, 3),
      0xffe090,
      Phaser.Math.FloatBetween(2.4, 4.4),
      250,
    );
  }
}

export function drawBurnAura({ graphics: g, x, y, r, pulse, colors }) {
  const burnColor = colors.sparrowBurn || 0xff7a1f;
  drawPixelRing(g, x, y, Math.max(16, r + 4 + 3 * pulse), {
    fillColor: burnColor,
    fillAlpha: 0.12 + 0.06 * pulse,
    lineColor: burnColor,
    lineAlpha: 0.72 * pulse,
  });
}
