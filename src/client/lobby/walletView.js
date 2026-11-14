import "../styles/wallet.css";

// Move the same controls between active headers, preserving balances and handlers.
let wallet;
let home;
const slots = [];

function placeWallet() {
  wallet ||= document.getElementById("lobby-wallet");
  home ||= document.querySelector("[data-wallet-home]");
  if (!wallet || !home) return;
  for (let i = slots.length - 1; i >= 0; i--) {
    if (!slots[i].isConnected) slots.splice(i, 1);
  }
  const target = slots.at(-1) || home;
  if (wallet.parentElement !== target) target.appendChild(wallet);
}

export function mountWallet(slot) {
  if (!slot) return;
  const index = slots.indexOf(slot);
  if (index >= 0) slots.splice(index, 1);
  slots.push(slot);
  placeWallet();
}

export function releaseWallet(slot) {
  const index = slots.indexOf(slot);
  if (index >= 0) slots.splice(index, 1);
  placeWallet();
}

export function renderWalletBalances(balance) {
  for (const currency of ["coins", "gems"]) {
    const counter = document.getElementById(currency === "coins" ? "coin-count" : "gem-count");
    if (counter) counter.textContent = Math.max(0, Number(balance?.[currency]) || 0).toLocaleString();
  }
}
