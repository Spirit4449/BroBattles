import { installRenderResolution } from '/src/gameScene/renderResolution.js';
import { deferSceneAudio } from '/src/gameScene/deferredAudio.js';

const requested = new URLSearchParams(location.search).get('renderer');
let resolution;
const results = { samples: [] };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
new Phaser.Game({
  type: requested === 'canvas' ? Phaser.CANVAS : Phaser.AUTO,
  width: 400, height: 200, transparent: true, pixelArt: true,
  // Only the test retains the buffer so pixels can be inspected between frames.
  preserveDrawingBuffer: true,
  scale: { mode: Phaser.Scale.FIT },
  callbacks: { postBoot(game) { resolution = installRenderResolution(game, Phaser, 1); } },
  scene: {
    preload() {
      deferSceneAudio(this);
      this.load.audio('slow', '/slow.mp3');
      this.load.audio('missing', '/missing.mp3');
      this.load.atlas('ninja', '/public/assets/ninja/spritesheet.webp', '/public/assets/ninja/animations.json');
    },
    create() {
      results.type = this.game.renderer.type;
      results.createdBeforeAudio = !this.cache.audio.exists('slow');
      results.earlySoundSkipped = this.sound.play('slow') === false;
      this.add.rectangle(200, 100, 100, 50, 0xff0000);
      this.add.rectangle(20, 20, 20, 20, 0xffff00);
      this.add.sprite(70, 100, 'ninja', 'idle00').setScale(0.5);
      const texture = this.textures.createCanvas('generated', 20, 20);
      texture.context.fillStyle = '#00ff00';
      texture.context.fillRect(0, 0, 20, 20);
      texture.refresh();
      this.add.image(320, 100, 'generated');
      const masked = this.add.rectangle(370, 100, 40, 40, 0x0000ff);
      const mask = this.make.graphics();
      mask.fillRect(360, 80, 20, 40);
      masked.setMask(mask.createGeometryMask());
      if (results.type === Phaser.WEBGL) this.add.renderTexture(290, 160, 20, 20).fill(0x00ffff);
      const game = this.game;
      const run = async () => {
        for (const scale of [1, Math.SQRT2, 2, 0.5, 1]) {
          resolution.setScale(scale);
          await wait(100);
          const canvas = document.createElement('canvas');
          canvas.width = 400; canvas.height = 200;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(game.canvas, 0, 0, 400, 200);
          const pixel = (x, y) => Array.from(ctx.getImageData(x, y, 1, 1).data);
          results.samples.push({
            scale, size: [game.canvas.width, game.canvas.height],
            center: pixel(200, 100), corner: pixel(20, 20), transparent: pixel(390, 10),
            generated: pixel(320, 100), mask: pixel(365, 100), outsideMask: pixel(355, 100),
            renderTexture: pixel(295, 165),
            logical: [game.scale.width, game.scale.height], glError: game.renderer.gl?.getError(),
          });
        }
        // Camera projection and input mapping must not depend on pixel density.
        const camera = this.cameras.main;
        camera.setViewport(20, 10, 360, 180).setScroll(15, 5).setZoom(1.2);
        const points = [];
        for (const scale of [1, 2]) {
          resolution.setScale(scale);
          await wait(60);
          const point = camera.getWorldPoint(200, 100);
          points.push([point.x, point.y]);
        }
        results.worldPoints = points;
        game.scale.resize(500, 250);
        resolution.setScale(2);
        await wait(60);
        results.resize = [game.canvas.width, game.canvas.height];
        for (let i = 0; i < 100 && !this.cache.audio.exists('slow'); i++) await wait(50);
        results.audioEventuallyLoaded = this.cache.audio.exists('slow');
        results.failedSoundSkipped = this.sound.play('missing') === false;
        game.destroy(true);
        await wait(60);
        window.results = results;
      };
      run().catch(error => { window.testError = error.stack; });
    },
  },
});
