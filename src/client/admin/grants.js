import { openModalDialog } from "../ui/nativeDialog";
import { API_PATHS } from "../../shared/net/apiPaths.js";
import { $, node, button, fmt, signed, titleCase, currencyIcon, setAvatar, fetchJson, setStatus, showToast, confirmDialog } from "./common";
import { PRESETS, state, playerTools } from "./adminState";
import { loadGrants } from "./dashboard";
import { renderBalances, updateSaveBar, refreshCurrencyHistory } from "./players";

// ---- Grant form (used on a player's Currency tab and in the grant dialog) ----
async function grantCurrency(users, amounts, note) {
  const data = await fetchJson(API_PATHS.API_ADMIN_GRANT, { method: "POST", body: { userIds: users.map((u) => u.user_id), coins: amounts.coins || 0, gems: amounts.gems || 0, note } });
  for (const updated of data.users) applyBalances(updated);
  loadGrants();
  return data.users;
}

const describeAmounts = (amounts) => ["coins", "gems"].filter((c) => amounts[c]).map((c) => `${signed(amounts[c])} ${c}`).join(" and ");

function grantSummary(results) {
  const name = results.length === 1 ? results[0].name : `${results.length} players`;
  const applied = results.reduce((sum, r) => ({ coins: sum.coins + r.applied.coins, gems: sum.gems + r.applied.gems }), { coins: 0, gems: 0 });
  return `${describeAmounts(applied) || "No change"} → ${name}`;
}

function buildGrantForm(host, { getRecipients, onGranted }) {
  const form = node("form", null, "grant-form");
  form.autocomplete = "off";
  const mode = { sign: 1 };
  const modeStrip = node("div", null, "segmented");
  const addMode = button("Add", "is-active");
  const removeMode = button("Remove");
  for (const [el, sign] of [[addMode, 1], [removeMode, -1]]) {
    el.addEventListener("click", () => { mode.sign = sign; addMode.classList.toggle("is-active", sign === 1); removeMode.classList.toggle("is-active", sign === -1); form.classList.toggle("is-removing", sign === -1); update(); });
  }
  modeStrip.append(addMode, removeMode);

  const inputs = {};
  const rows = [];
  for (const currency of ["coins", "gems"]) {
    const row = node("div", null, `grant-row grant-${currency}`);
    const label = node("label", null, "grant-amount");
    const amount = node("input");
    amount.type = "number"; amount.min = "0"; amount.step = "1"; amount.inputMode = "numeric"; amount.placeholder = "0";
    amount.setAttribute("aria-label", `${titleCase(currency)} amount`);
    inputs[currency] = amount;
    label.append(currencyIcon(currency, 26), amount);
    const presets = node("div", null, "presets");
    for (const value of PRESETS[currency]) {
      const chip = button(`+${value >= 1000 ? `${value / 1000}K` : value}`, "chip");
      chip.title = "Click to add · Shift-click to subtract";
      chip.addEventListener("click", (event) => {
        amount.value = String(Math.max(0, (Number(amount.value) || 0) + (event.shiftKey ? -value : value)));
        update();
      });
      presets.append(chip);
    }
    presets.append(button("Clear", "chip chip-clear", () => { amount.value = ""; update(); amount.focus(); }));
    row.append(label, presets);
    rows.push(row);
  }

  const note = node("input", null, "grant-note");
  note.type = "text"; note.maxLength = 40; note.placeholder = "Note (optional), e.g. bug comp or giveaway";
  note.setAttribute("aria-label", "Grant note");

  const footer = node("div", null, "grant-footer");
  const summary = node("span", null, "grant-summary");
  const submit = node("button", "Grant", "primary grant-submit");
  submit.type = "submit";
  footer.append(summary, submit);
  form.append(modeStrip, ...rows, note, footer);
  host.replaceChildren(form);

  const amounts = () => Object.fromEntries(["coins", "gems"].map((c) => [c, mode.sign * Math.max(0, Math.floor(Number(inputs[c].value) || 0))]));
  function update() {
    const recipients = getRecipients();
    const value = amounts();
    const any = value.coins || value.gems;
    submit.disabled = !any || !recipients.length;
    submit.textContent = mode.sign < 0 ? "Remove" : "Grant";
    summary.textContent = !recipients.length ? "Add a player first" : !any ? "Pick an amount" : `${describeAmounts(value)} → ${recipients.length === 1 ? recipients[0].name : `${recipients.length} players`}`;
  }
  form.addEventListener("input", update);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const recipients = getRecipients();
    const value = amounts();
    if (!recipients.length || !(value.coins || value.gems)) return;
    if (recipients.length > 1 && !await confirmDialog({ title: `${mode.sign < 0 ? "Remove from" : "Grant to"} ${recipients.length} players?`, message: `${describeAmounts(value)} for each player.`, details: recipients.map((u) => u.name), confirmLabel: mode.sign < 0 ? "Remove" : "Grant", danger: mode.sign < 0 })) return;
    submit.disabled = true;
    try {
      const results = await grantCurrency(recipients, value, note.value.trim());
      showToast(grantSummary(results));
      inputs.coins.value = ""; inputs.gems.value = ""; note.value = "";
      onGranted?.(results);
    } catch (error) {
      showToast(error.message || "Grant failed", true);
    } finally { update(); }
  });
  update();
  return { update, focus: () => inputs.coins.focus() };
}

function applyBalances(updated) {
  if (state.selectedUser?.user_id !== updated.user_id) return;
  Object.assign(state.selectedUser, { coins: updated.coins, gems: updated.gems });
  renderBalances(state.selectedUser);
  $("#fieldCoins").value = updated.coins;
  $("#fieldGems").value = updated.gems;
  updateSaveBar();
  refreshCurrencyHistory(updated.user_id);
}

// ---- Grant dialog ----
const dialogState = { recipients: [], suggestions: [], active: -1, generation: 0 };

function renderRecipientChips() {
  const host = $("#recipientChips");
  host.replaceChildren();
  for (const user of dialogState.recipients) {
    const chip = node("span", null, "recipient-chip");
    chip.append(setAvatar(Object.assign(node("img"), { alt: "" }), user), node("span", user.name), node("small", `${fmt(user.coins)}c · ${fmt(user.gems)}g`));
    chip.append(button("×", "chip-remove", () => { dialogState.recipients = dialogState.recipients.filter((u) => u.user_id !== user.user_id); renderRecipientChips(); }));
    host.append(chip);
  }
  playerTools.dialogForm?.update();
}

function addRecipient(user) {
  if (!dialogState.recipients.some((u) => u.user_id === user.user_id)) dialogState.recipients.push(user);
  $("#recipientSearch").value = "";
  hideSuggestions();
  renderRecipientChips();
}

function hideSuggestions() { $("#recipientSuggestions").hidden = true; dialogState.suggestions = []; dialogState.active = -1; }

function renderSuggestions() {
  const host = $("#recipientSuggestions");
  host.replaceChildren();
  host.hidden = !dialogState.suggestions.length;
  dialogState.suggestions.forEach((user, index) => {
    const option = button(null, `suggestion ${index === dialogState.active ? "is-active" : ""}`, () => addRecipient(user));
    option.setAttribute("role", "option");
    option.append(setAvatar(Object.assign(node("img"), { alt: "" }), user), node("strong", user.name), node("span", `#${user.user_id} · ${user.expires_at ? "Guest" : "Account"}`, "muted"), node("span", `${fmt(user.coins)}c · ${fmt(user.gems)}g`, "row-meta"));
    host.append(option);
  });
}

let suggestTimer = 0;

function queueSuggestions() {
  clearTimeout(suggestTimer);
  const query = $("#recipientSearch").value.trim();
  if (!query) return hideSuggestions();
  suggestTimer = setTimeout(async () => {
    const generation = ++dialogState.generation;
    try {
      const data = await fetchJson(API_PATHS.API_ADMIN_USER_SEARCH, { method: "POST", body: { query, page: 1 } });
      if (generation !== dialogState.generation) return;
      dialogState.suggestions = data.users.filter((u) => !dialogState.recipients.some((r) => r.user_id === u.user_id)).slice(0, 8);
      dialogState.active = dialogState.suggestions.length ? 0 : -1;
      renderSuggestions();
    } catch (error) { setStatus(error.message, true); }
  }, 160);
}

function openGrantDialog(initial = null) {
  const dialog = $("#grantDialog");
  dialogState.recipients = initial ? [...initial] : state.selectedUser ? [state.selectedUser] : [];
  renderRecipientChips();
  hideSuggestions();
  $("#recipientSearch").value = "";
  if (!dialog.open) openModalDialog(dialog, { backdrop: "target" });
  if (dialogState.recipients.length) playerTools.dialogForm.focus(); else $("#recipientSearch").focus();
}

function wireGrantDialog() {
  const dialog = $("#grantDialog");
  playerTools.dialogForm = buildGrantForm($("#dialogGrant"), {
    getRecipients: () => dialogState.recipients,
    onGranted: (results) => {
      for (const r of results) { const user = dialogState.recipients.find((u) => u.user_id === r.user_id); if (user) Object.assign(user, { coins: r.coins, gems: r.gems }); }
      renderRecipientChips();
    },
  });
  dialog.querySelector(".dialog-close").addEventListener("click", () => dialog.close());

  const search = $("#recipientSearch");
  search.addEventListener("input", queueSuggestions);
  search.addEventListener("keydown", (event) => {
    const { suggestions } = dialogState;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!suggestions.length) return;
      event.preventDefault();
      dialogState.active = (dialogState.active + (event.key === "ArrowDown" ? 1 : -1) + suggestions.length) % suggestions.length;
      renderSuggestions();
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (suggestions[dialogState.active]) addRecipient(suggestions[dialogState.active]);
      else if (dialogState.recipients.length) playerTools.dialogForm.focus();
    } else if (event.key === "Backspace" && !search.value && dialogState.recipients.length) {
      dialogState.recipients.pop();
      renderRecipientChips();
    }
  });
}

export { buildGrantForm, openGrantDialog, wireGrantDialog };

