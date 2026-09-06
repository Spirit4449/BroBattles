// Source-pixel grip tracks. The sprite and weapon share the atlas animation clock.
import handAnchors from "./handAnchors.json";
export function thorgGripPose(body, delta = 16) {
  const frame = String(body.frame?.name || "idle00");
  const name = frame.match(/^[a-z]+/i)?.[0] || "idle";
  const index = Number(frame.match(/\d+$/)?.[0]) || 0;
  const anim = body.anims;
  const fraction = anim?.isPlaying ? Math.min(1, (Number(anim.accumulator) || 0) / (Number(anim.nextTick) || 100)) : 0;
  const frames = anim?.currentAnim?.frames || [];
  const nextIndex = (Number(anim?.currentFrame?.index) || 1);
  const next = frames[nextIndex] || (anim?.currentAnim?.repeat === -1 ? frames[0] : null);
  const a = handAnchors[frame] || handAnchors.idle00 || [99,82,-4.48];
  const b = handAnchors[next?.textureFrame] || a;
  const mix = fraction * fraction * (3 - 2 * fraction);
  const phase = (index + fraction) * Math.PI / 3;
  const run = name === "running", idle = name === "idle";
  const lift = idle ? Math.sin(phase) * 0.65 : run ? Math.sin(phase * 2) * 1.15 : 0;
  const inertia = Math.max(-0.14, Math.min(0.14, (Number(body.body?.velocity?.y) || 0) / 2400));
  const target = { x: ((a[0] + (b[0]-a[0])*mix) - 64) * 0.7,
    y: ((a[1] + (b[1]-a[1])*mix) - 64) * 0.7 + lift,
    angle: (a[2] ?? -4.48) + ((b[2] ?? -4.48) - (a[2] ?? -4.48))*mix + inertia +
      (run ? Math.sin(phase * 2) * 0.085 : idle ? Math.sin(phase)*0.025 : 0) };
  const pose = body._thorgGripPose || { ...target };
  const blend = 1 - Math.exp(-Math.max(0,delta) / 45);
  for (const key of ['x','y','angle']) pose[key] += (target[key]-pose[key])*blend;
  body._thorgGripPose = pose;
  return pose;
}
