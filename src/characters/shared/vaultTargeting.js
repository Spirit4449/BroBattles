import socket from "../../socket";
import { circleRectOverlap, rectsOverlap } from "./combatGeometry";

function getLiveMatchContext() {
  if (typeof window === "undefined") return null;
  return window.__BB_LIVE_MATCH_CONTEXT__ || null;
}

function getEnemyVaultContext() {
  const ctx = getLiveMatchContext();
  const modeState = ctx?.modeState || null;
  const yourTeam = String(ctx?.yourTeam || "");
  if (!modeState || String(modeState?.type) !== "bank-bust" || !yourTeam) {
    return null;
  }
  const enemyTeam = yourTeam === "team1" ? "team2" : "team1";
  const vault = modeState?.vaults?.[enemyTeam] || null;
  if (!vault) return null;
  const x = Number(vault?.x);
  const y = Number(vault?.y);
  const width = Math.max(40, Number(vault?.width) || 150);
  const height = Math.max(40, Number(vault?.height) || 180);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return {
    team: enemyTeam,
    target: `vault:${enemyTeam}`,
    x,
    y,
    width,
    height,
    left: x - width / 2,
    right: x + width / 2,
    top: y - height / 2,
    bottom: y + height / 2,
  };
}

export function emitVaultHitForRect({
  attacker,
  left,
  top,
  right,
  bottom,
  attackType = "basic",
  chargeRatio = 0,
  instanceId = null,
  gameId = null,
  hitSet = null,
}) {
  const vault = getEnemyVaultContext();
  if (!vault) return false;
  if (
    !rectsOverlap(
      Number(left) || 0,
      Number(top) || 0,
      Number(right) || 0,
      Number(bottom) || 0,
      vault.left,
      vault.top,
      vault.right,
      vault.bottom,
    )
  ) {
    return false;
  }
  if (hitSet && hitSet.has(vault.target)) return false;
  if (hitSet) hitSet.add(vault.target);
  socket.emit("hit", {
    attacker,
    target: vault.target,
    attackType,
    chargeRatio: Number.isFinite(chargeRatio) ? chargeRatio : 0,
    instanceId,
    attackTime: Date.now(),
    gameId,
  });
  return true;
}

export function emitVaultHitForCircle({
  attacker,
  x,
  y,
  radius,
  attackType = "basic",
  chargeRatio = 0,
  instanceId = null,
  gameId = null,
  hitSet = null,
}) {
  const vault = getEnemyVaultContext();
  if (!vault) return false;
  if (
    !circleRectOverlap(
      Number(x) || 0,
      Number(y) || 0,
      Math.max(1, Number(radius) || 1),
      vault.left,
      vault.top,
      vault.right,
      vault.bottom,
    )
  ) {
    return false;
  }
  if (hitSet && hitSet.has(vault.target)) return false;
  if (hitSet) hitSet.add(vault.target);
  socket.emit("hit", {
    attacker,
    target: vault.target,
    attackType,
    chargeRatio: Number.isFinite(chargeRatio) ? chargeRatio : 0,
    instanceId,
    attackTime: Date.now(),
    gameId,
  });
  return true;
}
