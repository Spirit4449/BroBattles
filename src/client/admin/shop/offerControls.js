import { titleMarkup } from "../../views/titleView.js";
import { getCharacterDisplayName } from "../../../shared/characters/characterStats.js";
import { node, button, input, select, currencyIcon, openModal } from "../common";
import { GRANT_KINDS, COSMETIC_LABEL, store, offers, optionsFor, slug, cosmeticName } from "./catalogDraft";

// ---- Rewards editor shared by offers and daily rewards ----
function grantsEditor(grants, onChange, { currencyOnly = false } = {}) {
  const box = node("div", null, "grants-editor");
  function draw() {
    box.replaceChildren();
    grants.forEach((grant, index) => {
      const row = node("div", null, "grant-edit-row");
      const kindValue = grant.kind === "currency" ? grant.currency : grant.kind;
      const kind = select(GRANT_KINDS.filter(([id]) => !currencyOnly || ["coins", "gems"].includes(id) || id === kindValue), kindValue);
      kind.setAttribute("aria-label", "Reward type");
      kind.addEventListener("change", () => {
        grants[index] = ["coins", "gems"].includes(kind.value)
          ? { kind: "currency", currency: kind.value, amount: grant.kind === "currency" ? grant.amount : kind.value === "gems" ? 50 : 500 }
          : { kind: kind.value, id: unsoldCosmetic(kind.value) };
        draw(); onChange();
      });
      row.append(kind);
      if (grant.kind === "currency") {
        const label = node("label", null, "grant-amount-field");
        const amount = input("number", grant.amount, { min: "1", step: "1", "aria-label": "Amount" });
        amount.addEventListener("input", () => { grants[index].amount = Math.max(0, Math.floor(Number(amount.value) || 0)); onChange(); });
        label.append(currencyIcon(grant.currency, 20), amount);
        row.append(label);
      } else {
        const choose = button(null, "cosmetic-choice", () => pickCosmetic(grant.kind, grant.id, (id) => { grants[index].id = id; draw(); onChange(); }));
        choose.setAttribute("aria-label", `${COSMETIC_LABEL[grant.kind]}: ${cosmeticName(grant)}. Change`);
        choose.append(cosmeticThumb(grant.kind, grant.id), node("span", cosmeticName(grant)), node("small", "Change", "muted"));
        row.append(choose);
      }
      const remove = button("×", "mini danger", () => { grants.splice(index, 1); draw(); onChange(); });
      remove.setAttribute("aria-label", "Remove reward");
      row.append(remove);
      box.append(row);
    });
    const add = node("div", null, "grant-add");
    add.append(node("span", "Add", "field-label"));
    for (const [id, label] of GRANT_KINDS.filter(([id]) => !currencyOnly || ["coins", "gems"].includes(id))) {
      add.append(button(`+ ${label}`, "mini", () => {
        grants.push(["coins", "gems"].includes(id) ? { kind: "currency", currency: id, amount: id === "gems" ? 50 : 500 } : { kind: id, id: unsoldCosmetic(id) });
        draw(); onChange();
      }));
    }
    box.append(add);
  }
  draw();
  return { element: box, redraw: draw };
}

function cosmeticThumb(kind, id) {
  const holder = node("span", null, `cosmetic-thumb kind-${kind}`);
  if (kind === "title") holder.innerHTML = titleMarkup(id);
  else {
    const img = node("img");
    img.src = optionsFor(kind).find((o) => o.id === id)?.assetUrl || "/assets/icons/lock.webp";
    img.alt = "";
    img.loading = "lazy";
    holder.append(img);
  }
  return holder;
}

// Which offers grant each cosmetic, for "already sold" hints.
function cosmeticSellers(kind) {
  const map = new Map();
  for (const offer of offers()) for (const grant of offer.grants || []) if (grant.kind === kind) map.set(grant.id, [...(map.get(grant.id) || []), offer]);
  return map;
}

// First cosmetic of a kind that no offer sells yet (skipping free defaults).
function unsoldCosmetic(kind) {
  const sold = cosmeticSellers(kind);
  const choices = optionsFor(kind).filter((o) => o.id !== "default" && !/-default$/.test(o.id));
  return (choices.find((o) => !sold.has(o.id)) || choices[0] || optionsFor(kind)[0])?.id || "";
}

function pickCosmetic(kind, current, onPick) {
  const sellers = cosmeticSellers(kind);
  let query = "", unsoldOnly = false;
  const modal = openModal(`Choose a ${COSMETIC_LABEL[kind].toLowerCase()}`, { wide: true, submitLabel: "Close", cancelLabel: "", dismissible: true });
  const bar = node("div", null, "store-toolbar");
  const search = input("search", "", { placeholder: `Search ${COSMETIC_LABEL[kind].toLowerCase()}s…`, "aria-label": "Search" });
  const unsold = Object.assign(node("input"), { type: "checkbox" });
  const unsoldLabel = node("label", null, "check");
  unsoldLabel.append(unsold, node("span", "Only ones not sold yet"));
  bar.append(search, unsoldLabel);
  const grid = node("div", null, "cosmetic-grid");
  function draw() {
    const q = query.toLowerCase();
    grid.replaceChildren();
    for (const option of optionsFor(kind)) {
      const sold = sellers.get(option.id) || [];
      if (unsoldOnly && sold.length) continue;
      if (q && !`${option.name} ${option.id} ${option.character || ""}`.toLowerCase().includes(q)) continue;
      const tile = button(null, `cosmetic-tile rarity-${option.rarity || "common"}${option.id === current ? " is-active" : ""}`, () => { onPick(option.id); modal.close(); });
      const caption = node("span", null, "cosmetic-caption");
      caption.append(node("strong", option.name), node("small", [option.character && getCharacterDisplayName(option.character), option.rarity].filter(Boolean).join(" · "), "muted"));
      tile.append(cosmeticThumb(kind, option.id), caption);
      if (sold.length) {
        const tag = node("span", `Sold in ${sold.length === 1 ? sold[0].name : `${sold.length} offers`}`, "tag sold-tag");
        tag.title = sold.map((o) => o.name).join(", ");
        tile.append(tag);
      }
      grid.append(tile);
    }
    if (!grid.children.length) grid.append(node("p", "Nothing matches.", "muted pad"));
  }
  search.addEventListener("input", () => { query = search.value.trim(); draw(); });
  unsold.addEventListener("change", () => { unsoldOnly = unsold.checked; draw(); });
  modal.body.append(bar, grid);
  draw();
  search.focus();
}

function bannerPicker(current, onPick, related = []) {
  const wrap = node("div", null, "banner-picker-wrap");
  const search = input("search", "", { placeholder: "Filter banners…", "aria-label": "Filter banners" });
  const grid = node("div", null, "banner-picker");
  const words = related.map((word) => slug(word)).filter(Boolean);
  // Banners whose file name matches the offer's rewards come first.
  const score = (src) => words.some((word) => src.includes(word)) ? 0 : 1;
  const list = [...store.options.banners].sort((a, b) => score(a) - score(b));
  function draw() {
    const q = search.value.trim().toLowerCase();
    grid.replaceChildren();
    for (const src of list.filter((s) => !q || s.toLowerCase().includes(q))) {
      const choice = button(null, `banner-choice${src === current ? " is-active" : ""}`, () => {
        current = src;
        grid.querySelectorAll(".banner-choice").forEach((el) => el.classList.toggle("is-active", el === choice));
        onPick(src);
      });
      choice.title = src.split("/").pop();
      choice.setAttribute("aria-label", `Banner ${choice.title}`);
      choice.append(Object.assign(node("img"), { src, alt: "", loading: "lazy" }));
      grid.append(choice);
    }
  }
  search.addEventListener("input", draw);
  draw();
  wrap.append(search, grid);
  return wrap;
}

function segmented(options, value, onChange) {
  const wrap = node("div", null, "segmented");
  const buttons = options.map(([id, label, disabled]) => {
    const el = button(label, id === value ? "is-active" : "", () => {
      if (el.disabled) return;
      buttons.forEach((b) => b.classList.toggle("is-active", b === el));
      onChange(id);
    });
    el.dataset.value = id;
    if (disabled) { el.disabled = true; el.title = disabled; }
    return el;
  });
  wrap.append(...buttons);
  return wrap;
}

export { grantsEditor, unsoldCosmetic, bannerPicker, segmented };

