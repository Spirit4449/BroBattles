import { applyTeamVisual, ENEMY_BODY_OVERLAY_ALPHA } from "../../../shared/projectilePresentation";

// Canvas recolors the current frame. WebGL draws a red silhouette over it.
export function attachEnemyBodyVisual(scene, body) {
  applyTeamVisual(body, body, "body");
  if (scene.game.renderer?.type !== Phaser.WEBGL) return;
  const overlay = scene.add.sprite(0, 0, body.texture.key);
  overlay.setTintFill(0xff2020);
  overlay.setVisible(false);
  const sync = () => {
    if (!body.scene || !overlay.scene) return;
    const show = body.visible && body.alpha > 0;
    overlay.setVisible(show);
    if (!show) return;
    if (overlay.texture !== body.texture || overlay.frame !== body.frame) overlay.setTexture(body.texture.key, body.frame.name);
    overlay.setPosition(body.x, body.y).setOrigin(body.originX, body.originY).setScale(body.scaleX, body.scaleY)
      .setFlip(body.flipX, body.flipY).setRotation(body.rotation).setScrollFactor(body.scrollFactorX, body.scrollFactorY)
      .setAlpha(body.alpha * ENEMY_BODY_OVERLAY_ALPHA).setDepth(body.depth + 0.001);
  };
  scene.events.on("prerender", sync);
  body.once("destroy", () => {
    scene.events.off("prerender", sync);
    overlay.destroy();
  });
}
