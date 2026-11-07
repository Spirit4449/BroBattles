// Source-pixel grip tracks. The sprite and weapon share the atlas animation clock.
import handAnchors from "./handAnchors.json";
import { characterFrames, characterStats } from "../../../../shared/characters";
import rigData from "../../../../shared/characters/characterRig.js";

// Thorg's art geometry, from his definition and rig (thorg.json): the atlas
// frame centre (hand anchors are source pixels), world pixels per source pixel,
// the frame's on-screen size, and how far his feet sit below the frame centre
// (rage scaling grows him about his feet).
const FRAME = characterFrames.thorg;
export const THORG_ART = Object.freeze({
  centre: FRAME.w / 2,
  scale: characterStats.thorg.spriteScale,
  displaySize: FRAME.w * characterStats.thorg.spriteScale,
  feetDrop: (rigData.rigOf("thorg").feet[1] - FRAME.h / 2) * characterStats.thorg.spriteScale,
});
export function thorgGripPose(body, delta = 16) {
  const frame = String(body.frame?.name || "idle00");
  const name = frame.match(/^[a-z]+/i)?.[0] || "idle";
  // The sweep owns attack motion. Do not slide the carry grip to throw-frame
  // hands while attacking or while the final throw frame is still displayed.
  if (name === "throw" && body._thorgGripPose) return body._thorgGripPose;
  const index = Number(frame.match(/\d+$/)?.[0]) || 0;
  const run = name === "running", idle = name === "idle";
  const anim = body.anims;
  const fraction = anim?.isPlaying ? Math.min(1, (Number(anim.accumulator) || 0) / (Number(anim.nextTick) || 100)) : 0;
  const frames = anim?.currentAnim?.frames || [];
  const nextIndex = (Number(anim?.currentFrame?.index) || 1);
  const next = frames[nextIndex] || (anim?.currentAnim?.repeat === -1 ? frames[0] : null);
  const a = handAnchors[frame] || handAnchors.idle00 || [99,82,-4.48];
  const b = handAnchors[next?.textureFrame] || a;
  const mix = run ? 0 : fraction * fraction * (3 - 2 * fraction);
  const phase = (index + fraction) * Math.PI / 3;
  const lift = idle ? Math.sin(phase) * 0.2 : 0;
  const inertia = Math.max(-0.14, Math.min(0.14, (Number(body.body?.velocity?.y) || 0) / 2400));
  const target = { x: ((a[0] + (b[0]-a[0])*mix) - THORG_ART.centre) * THORG_ART.scale,
    y: ((a[1] + (b[1]-a[1])*mix) - THORG_ART.centre) * THORG_ART.scale + lift,
    angle: (a[2] ?? -4.48) + ((b[2] ?? -4.48) - (a[2] ?? -4.48))*mix + inertia +
      (idle ? Math.sin(phase)*0.008 : 0) };
  const pose = body._thorgGripPose || { ...target };
  const blend = 1 - Math.exp(-Math.max(0,delta) / (idle || run ? 24 : 60));
  for (const key of ['x','y','angle']) pose[key] += (target[key]-pose[key])*blend;
  // Running artwork changes hands in discrete steps; the handle must stay on
  // the visible fist instead of interpolating through empty space between them.
  if (run && delta > 0) {
    pose.x = target.x; pose.y = target.y;
  }
  if (delta > 0) body._thorgGripAnimation = name;
  body._thorgGripPose = pose;
  return pose;
}
