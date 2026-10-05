export function legacyAnimations(scene, textureKey) {
  if (!scene.anims.exists(`${textureKey}-running`))
    scene.anims.create({
      key: `${textureKey}-running`, // Name of animation
      frames: scene.anims.generateFrameNames(textureKey, {
        prefix: "running", // Name inside of json file
        end: 5, // Length of animation in frames (Since the numbers start at 0, the end is always 1 more. So 5 + 1 = 6 frames)
        zeroPad: 2, // Number of zeros in json file
      }),
      frameRate: 20, // Number of frames per second
      repeat: 0, // Number of times to repeat (0 means none) (-1 means infinite times)
    });
  if (!scene.anims.exists(`${textureKey}-idle`))
    scene.anims.create({
      key: `${textureKey}-idle`,
      frames: scene.anims.generateFrameNames(textureKey, {
        prefix: "idle",
        end: 4,
        zeroPad: 2,
      }),
      frameRate: 3,
      repeat: -1,
    });
  if (!scene.anims.exists(`${textureKey}-jumping`))
    scene.anims.create({
      key: `${textureKey}-jumping`,
      frames: scene.anims.generateFrameNames(textureKey, {
        prefix: "jumping",
        end: 7,
        zeroPad: 2,
      }),
      frameRate: 20,
      repeat: 0,
    });

  if (!scene.anims.exists(`${textureKey}-sliding`))
    scene.anims.create({
      key: `${textureKey}-sliding`,
      frames: scene.anims.generateFrameNames(textureKey, {
        prefix: "wall",
        end: 0,
        zeroPad: 2,
      }),
      frameRate: 20,
      repeat: 2,
    });

  if (!scene.anims.exists(`${textureKey}-falling`))
    scene.anims.create({
      key: `${textureKey}-falling`,
      frames: scene.anims.generateFrameNames(textureKey, {
        prefix: "falling",
        end: 2,
        zeroPad: 2,
      }),
      frameRate: 20,
      repeat: 0,
    });

  if (!scene.anims.exists(`${textureKey}-throw`))
    scene.anims.create({
      key: `${textureKey}-throw`,
      frames: scene.anims.generateFrameNames(textureKey, {
        prefix: "throw",
        end: 3,
        zeroPad: 2,
      }),
      frameRate: 15,
      repeat: 0,
    });

  if (!scene.anims.exists(`${textureKey}-dying`))
    scene.anims.create({
      key: `${textureKey}-dying`,
      frames: scene.anims.generateFrameNames(textureKey, {
        prefix: "dying",
        end: 3,
        zeroPad: 2,
      }),
      frameRate: 10,
      repeat: 0,
    });
}
