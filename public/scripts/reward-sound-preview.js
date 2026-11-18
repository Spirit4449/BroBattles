let timers = [];
let voices = [];

const samples = [
  ["coins", [50, 400, 1500, 10000, 50000], 50],
  ["gems", [5, 20, 75, 500, 2500], 2.5],
];
const cascades = document.getElementById("cascades");

function playCascade(currency, count) {
  timers.forEach(clearTimeout);
  voices.forEach(voice => voice.pause());
  timers = [];
  voices = [];
  const gem = currency === "gems";
  for (let index = 0; index < count; index += 1) {
    const offset = index / Math.max(1, count - 1);
    const start = offset * (150 + count * 22);
    timers.push(setTimeout(() => {
      const voice = new Audio(`/assets/ui-sound/rewards/${gem ? "gem" : "coin"}-impact.wav`);
      voice.volume = 0.11;
      voice.playbackRate = 0.88 + offset * 0.3 + (gem ? 0.08 : 0);
      voices.push(voice);
      void voice.play();
    }, start));
  }
}

for (const [currency, amounts, unit] of samples) {
  for (const amount of amounts) {
    const count = Math.min(amount, 96, Math.ceil(2 * (amount / unit) ** 0.63));
    const button = document.createElement("button");
    button.textContent = `${amount.toLocaleString()} ${currency} · ${count} ticks`;
    button.style.cssText = "padding: 12px; margin: 4px";
    button.addEventListener("click", () => playCascade(currency, count));
    cascades.append(button);
  }
}
