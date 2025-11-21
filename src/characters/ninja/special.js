import socket from "../../socket";
import { getSpecialDamage } from "../../lib/characterStats";

export function perform(scene, player, playersInTeam, opponentPlayers, username, gameId, isOwner = false) {
  const isLeft = player.flipX;
  const velocityX = isLeft ? -600 : 600;
  const x = player.x + (isLeft ? -50 : 50);
  const y = player.y;

  // Create a large shuriken
  const shuriken = scene.physics.add.sprite(x, y, "shuriken");
  shuriken.setScale(3); 
  shuriken.body.allowGravity = false;
  shuriken.setVelocityX(velocityX);
  
  // Spin animation
  scene.tweens.add({
      targets: shuriken,
      angle: 360,
      duration: 150,
      repeat: -1
  });

  const hitSet = new Set();
  // TODO: Pass actual level
  const damage = getSpecialDamage("ninja", 1); 

  scene.physics.add.overlap(shuriken, opponentPlayers, (projectile, target) => {
      if (hitSet.has(target)) return;
      if (!target.username) return; 
      
      hitSet.add(target);
      
      if (isOwner) {
        // Emit hit
        socket.emit("hit", {
            attacker: username,
            target: target.username,
            damage: damage,
            attackType: "special",
            gameId: gameId
        });
      }

      // Visual impact
      scene.cameras.main.shake(100, 0.01);
  });

  // Destroy after 3s
  scene.time.delayedCall(3000, () => {
      if (shuriken.active) shuriken.destroy();
  });
}
