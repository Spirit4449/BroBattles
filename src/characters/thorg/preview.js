// Local visual review using the same renderer and animation definitions as play.
import { setThorgRageVisual } from './rageVisual';
import { ensureThorgWeapon, startThorgSweep } from './weapon';
import { animations } from './anim';
import { THORG_SWEEP } from '../../shared/thorgSweep';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  width: 1100,
  height: 660,
  backgroundColor: '#293c48',
  pixelArt: true,
  parent: 'preview',
  scene: {
    preload() {
      this.load.atlas('thorg', '/assets/thorg/spritesheet.webp', '/assets/thorg/animations.json');
      this.load.image('thorg-weapon', '/assets/thorg/weapon.webp');
      this.load.spritesheet('thorg-weapon-spin', '/assets/thorg/weapon-spin.webp', { frameWidth: 36, frameHeight: 101 });
    },
    create() {
      animations(this);
      const bodies = [];
      for (let i = 0; i < 4; i++) {
        const body = this.add.sprite(160 + i * 260, 360, 'thorg', 'idle00').setScale(0.7).setDepth(30);
        body.flipX = i % 2 === 1;
        if (i < 2) {
          setThorgRageVisual(this, body, true);
          body._thorgVisualScale = 2;
        }
        body.play('thorg-idle');
        ensureThorgWeapon(this, body);
        bodies.push(body);
        this.add.text(body.x, 490, i < 2 ? '2x inspection' : 'Gameplay scale', { fontSize: '16px' }).setOrigin(0.5);
      }
      for (const [id, animation] of [['idle', 'idle'], ['run', 'running'], ['jump', 'jumping'], ['fall', 'falling'], ['slide', 'sliding'], ['dying', 'dying']]) {
        document.getElementById(id).onclick = () => {
          game.loop.wake();
          bodies.forEach(body => { body._thorgAttackCleanup?.(); body.play(`thorg-${animation}`); });
        };
      }
      document.getElementById('attack').onclick = () => {
        game.loop.wake();
        bodies.forEach(body => startThorgSweep(this, body));
      };
      document.getElementById('pause').onclick = () => game.loop.running ? game.loop.sleep() : game.loop.wake();
      for (const [id, progress] of [['front', 0.35], ['rear', 0.65]]) {
        document.getElementById(id).onclick = () => {
          game.loop.sleep();
          bodies.forEach(body => startThorgSweep(this, body));
          const elapsed = THORG_SWEEP.windupMs + THORG_SWEEP.strikeMs * progress;
          const now = performance.now();
          for (let t = 0; t < elapsed; t += 8) game.step(now + t, Math.min(8, elapsed - t));
        };
      }
      this.add.rectangle(550, 399, 1100, 4, 0x809660).setDepth(1);
    },
  },
});
