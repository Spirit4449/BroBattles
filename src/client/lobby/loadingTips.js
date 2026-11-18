const TIPS = [
  "Stay still to regenerate health. Pick your moment wisely.",
  "Watch the yellow bar. When it's full, your special attack is ready.",
  "Earn more gems by racking up kills and dealing big damage.",
  "Jump toward a wall and press jump again to wall jump your way up.",
  "Falling off the map is an instant KO. Stay on solid ground.",
  "Spend your coins in the shop to upgrade your character's stats.",
  "Use gems to unlock new characters with unique fighting styles.",
  "Every attack has a cooldown. Wait for it before swinging again.",
  "Ammo is limited! Aim carefully and don't waste your shots.",
  "Low on health? Back off and regenerate before re-engaging.",
  "Team up with your partner to focus one enemy at a time.",
  "Wall jumping can save your life after being knocked off the edge.",
  "Your special attack deals massive damage. Save it for the right moment.",
  "Keep moving. A stationary target is an easy target.",
  "Different characters have different ranges. Know your spacing.",
  "Left-click to attack. No need to reach for J.",
  "Right-click to unleash your special when the yellow bar is full.",
];

export function startLoadingTips() {
  const target = document.getElementById("tips-text");
  if (!target) return;
  let index = Math.floor(Math.random() * TIPS.length);

  function showTip() {
    target.style.opacity = "0";
    setTimeout(() => {
      target.textContent = TIPS[index];
      target.style.opacity = "1";
      index = (index + 1) % TIPS.length;
    }, 350);
  }

  showTip();
  setInterval(showTip, 4000);
}
