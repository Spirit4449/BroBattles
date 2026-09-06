// Source-pixel grip tracks. The sprite and weapon share the atlas animation clock.
import handAnchors from "./handAnchors.json";
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
  const target = { x: ((a[0] + (b[0]-a[0])*mix) - 64) * 0.7,
    y: ((a[1] + (b[1]-a[1])*mix) - 64) * 0.7 + lift,
    angle: (a[2] ?? -4.48) + ((b[2] ?? -4.48) - (a[2] ?? -4.48))*mix + inertia +
      (idle ? Math.sin(phase)*0.008 : 0) };
  const pose = body._thorgGripPose || { ...target };
  const blend = 1 - Math.exp(-Math.max(0,delta) / 45);
  for (const key of ['x','y','angle']) pose[key] += (target[key]-pose[key])*blend;
  // Running artwork changes hands in discrete steps; the handle must stay on
  // the visible fist instead of interpolating through empty space between them.
  if (run && body._thorgGripAnimation === name && delta > 0) {
    pose.x = target.x; pose.y = target.y;
  }
  if (delta > 0) body._thorgGripAnimation = name;
  body._thorgGripPose = pose;
  return pose;
}
