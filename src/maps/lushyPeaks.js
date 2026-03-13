// map.js

// Globals
let base;
let platform;
let leftPlatform;
let rightPlatform;
let smallLeftPlatform;
let smallRightPlatform;

const lushyPeaksObjects = [];

function snapSpriteToPlatform(sprite, platform, targetX, epsilon = 2) {
  if (!sprite || !platform) return;

  const topY = platform.body ? platform.body.top : platform.getTopCenter().y;
  if (sprite.body) {
    const body = sprite.body;
    const halfH = (Number(body.height) || 0) / 2;
    const offsetY = Number(body.offset?.y) || 0;
    const targetY = topY - halfH - offsetY - epsilon;

    if (typeof body.reset === "function") {
      body.reset(targetX, targetY);
    } else {
      sprite.setPosition(targetX, targetY);
    }

    if (body.velocity?.set) body.velocity.set(0, 0);
    if (body.acceleration?.set) body.acceleration.set(0, 0);
    if (typeof body.updateFromGameObject === "function") {
      body.updateFromGameObject();
      const desiredBottom = topY - epsilon;
      const correction = desiredBottom - body.bottom;
      if (Math.abs(correction) > 0.5) {
        sprite.y += correction;
        body.updateFromGameObject();
      }
    }
  } else {
    const h = Number(sprite.height) || 0;
    sprite.setPosition(targetX, topY - h / 2 - epsilon);
  }
}

export function lushyPeaks(scene) {
  // Canvas variables
  const canvasWidth = scene.game.config.width;
  const canvasHeight = scene.game.config.height;
  const centerX = scene.scale.width / 2;

  // Setup background position
  // const background = scene.add.sprite(0, -180, "lushy-bg");
  // // Set background to the size of the canvas
  // background.displayWidth = scene.sys.canvas.width;
  // background.displayHeight = scene.sys.canvas.height + 500; // add 500 to prevent distortion
  // background.setOrigin(0, 0);

  // Base
  base = scene.physics.add.sprite(centerX, 630, "lushy-base");
  base.body.allowGravity = false; // Doesn't allow gravity
  base.setImmovable(true); // Makes sure it doesn't move
  base.setScale(0.7); // Makes it smaller
  lushyPeaksObjects.push(base);

  // Platform
  platform = scene.physics.add.sprite(centerX, 300, "lushy-platform");
  platform.setScale(0.7);
  platform.body.allowGravity = false;
  platform.setImmovable(true);
  lushyPeaksObjects.push(platform);

  // Left Platform
  leftPlatform = scene.physics.add.sprite(
    centerX - 490,
    320,
    "lushy-side-platform",
  );
  leftPlatform.setScale(0.7);
  leftPlatform.body.allowGravity = false;
  leftPlatform.setImmovable(true);
  lushyPeaksObjects.push(leftPlatform);

  // Right Platform
  rightPlatform = scene.physics.add.sprite(
    centerX + 490,
    320,
    "lushy-side-platform",
  );
  rightPlatform.setScale(0.7);
  rightPlatform.body.allowGravity = false;
  rightPlatform.setImmovable(true);
  lushyPeaksObjects.push(rightPlatform);

  smallLeftPlatform = scene.physics.add.sprite(
    centerX - 580,
    560,
    "mangrove-tiny-platform",
  );
  smallLeftPlatform.setScale(0.45);
  smallLeftPlatform.body.allowGravity = false;
  smallLeftPlatform.setImmovable(true);
  lushyPeaksObjects.push(smallLeftPlatform);

  smallRightPlatform = scene.physics.add.sprite(
    centerX + 580,
    560,
    "mangrove-tiny-platform",
  );
  smallRightPlatform.setScale(0.45);
  smallRightPlatform.body.allowGravity = false;
  smallRightPlatform.setImmovable(true);
  lushyPeaksObjects.push(smallRightPlatform);
}

// Determine a consistent spawn position for Lushy Peaks
// team: 'team1' spawns on base (bottom), 'team2' on platform (top)
// index: 0-based index within team (sorted order recommended)
// teamSize: number of players on that team
export function positionLushySpawn(scene, sprite, team, index, teamSize) {
  const target = team === "team2" ? platform : base;
  if (!sprite || !target) return;
  const bounds = target.getBounds();
  const slots = Math.max(1, Number(teamSize) || 1);
  const i = Math.min(slots - 1, Math.max(0, Number(index) || 0));
  const cx = bounds.left + bounds.width * ((i + 0.5) / slots);
  snapSpriteToPlatform(sprite, target, cx, 2);
}

export { lushyPeaksObjects };
