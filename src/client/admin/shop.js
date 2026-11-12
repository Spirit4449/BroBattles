// Store editor. The whole shop catalog is edited as a local draft and
// published in one step; the server validates it with the runtime rules.
import { $, node, button, field, input, select, fmt, titleCase, currencyIcon, fetchJson, formatAdminDate, showToast, openModal } from "./common";
import { getSaleOfferIds } from "../../server/services/shop/shopOfferRules";

const RARITIES = ["common", "rare", "epic", "legendary"];
const KINDS = [["item", "Single item"], ["bundle", "Bundle"], ["currency-pack", "Currency pack"]];
const GRANT_KINDS = [["coins", "Coins"], ["gems", "Gems"], ["skin", "Skin"], ["card", "Player card"], ["profileIcon", "Profile icon"]];
const TABS = [["offers", "Offers"], ["sales", "Weekly sales"], ["dailies", "Daily rewards"], ["sections", "Sections"], ["payments", "Orders & payments"]];

const store = { root: null, draft: null, saved: "", revision: null, options: null, status: null, tab: "offers", filter: "all", query: "", errors: [] };
const clone = (value) => JSON.parse(JSON.stringify(value));

export const isStoreDirty = () => !!store.draft && JSON.stringify(store.draft) !== store.saved;

export async function initStore(root) {
  store.root = root;
  root.className = "store";
  root.replaceChildren(node("p", "Loading the shop…", "muted pad"));
  try {
    await Promise.all([loadCatalog(), loadStatus()]);
    render();
  } catch (error) {
    root.replaceChildren(node("p", error.message, "muted pad"));
  }
}

async function loadCatalog() {
  const data = await fetchJson("/api/admin/shop/catalog");
  store.draft = data.catalog;
  store.saved = JSON.stringify(data.catalog);
  store.revision = data.revision;
  store.options = data.options;
  store.errors = data.errors || [];
}

async function loadStatus() {
  store.status = await fetchJson("/api/admin/shop/status");
}

// ---- Helpers ----
function grantLabel(grant) {
  if (grant.kind === "currency") return `${fmt(grant.amount)} ${grant.currency}`;
  const list = { skin: store.options.skins, card: store.options.cards, profileIcon: store.options.profileIcons }[grant.kind] || [];
  const match = list.find((entry) => entry.id === grant.id);
  const kindName = { skin: "Skin", card: "Card", profileIcon: "Icon" }[grant.kind] || grant.kind;
  return `${kindName}: ${match?.name || grant.id}${grant.kind === "skin" && match?.character ? ` (${titleCase(match.character)})` : ""}`;
}

function priceNode(price, struck = false) {
  const el = node("span", null, `price${struck ? " is-struck" : ""}`);
  if (!price) return el;
  if (price.type === "money") el.textContent = `$${(Number(price.amountCents || 0) / 100).toFixed(2)}`;
  else if (price.type === "free") el.textContent = "Free";
  else el.append(currencyIcon(price.currency, 16), document.createTextNode(fmt(price.amount)));
  return el;
}

function slug(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

function uniqueId(base, taken) {
  let id = base || "offer";
  for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`;
  return id;
}

const allIds = () => new Set([...(store.draft.offers || []).map((o) => o.id), ...(store.draft.rotation?.dailies?.rewards || []).map((r) => r.id)]);
const sections = () => store.draft.sections || [];
const sectionName = (id) => sections().find((s) => s.id === id)?.name || id;

function markChanged() {
  renderPills();
  renderPublishBar();
  renderTab();
}

// ---- Shell ----
function render() {
  const root = store.root;
  const header = node("div", null, "store-header");
  const titles = node("div");
  titles.append(node("h1", "Store", "view-title"), node("p", "Edit offers, weekly sales and daily rewards here, then publish. Players see changes the next time they open the shop.", "hint"));
  const pills = node("div", null, "store-pills");
  header.append(titles, node("span", null, "spacer"), pills);

  const tabs = node("nav", null, "tabs store-tabs");
  for (const [id, label] of TABS) {
    const tab = button(label, "", () => { store.tab = id; tabs.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === tab))); renderTab(); });
    tab.setAttribute("aria-pressed", String(id === store.tab));
    tabs.append(tab);
  }
  const body = node("div", null, "store-body");
  const publish = node("div", null, "save-bar store-publish");
  publish.hidden = true;
  root.replaceChildren(header, tabs, body, publish);
  renderPills();
  renderTab();
  renderPublishBar();
}

function renderPills() {
  const pills = $(".store-pills", store.root);
  const payment = store.status?.payment || {};
  const stripe = node("span", payment.enabled ? "Stripe on" : "Stripe off", `pill ${payment.enabled ? "is-good" : "is-bad"}`);
  stripe.title = payment.enabled ? "Real-money offers can be bought" : `Missing: ${(payment.missing || []).join(", ")}`;
  const health = node("span", store.errors.length ? `${store.errors.length} catalog problem${store.errors.length === 1 ? "" : "s"}` : "Catalog healthy", `pill ${store.errors.length ? "is-bad" : "is-good"}`);
  if (store.errors.length) health.title = store.errors.join("\n");
  pills.replaceChildren(stripe, health, node("span", `${(store.draft.offers || []).length} offers`, "pill"));
}

function renderPublishBar(errors = null) {
  const bar = $(".store-publish", store.root);
  if (!bar) return;
  const dirty = isStoreDirty();
  bar.hidden = !dirty && !errors;
  const text = node("div", null, "publish-text");
  text.append(node("strong", dirty ? "Unpublished shop changes" : "Publishing failed"));
  if (errors?.length) {
    const list = node("ul", null, "publish-errors");
    for (const error of errors.slice(0, 8)) list.append(node("li", error));
    if (errors.length > 8) list.append(node("li", `…and ${errors.length - 8} more`));
    text.append(list);
  } else text.append(node("span", "Nothing changes for players until you publish.", "muted"));
  const publish = button("Publish to shop", "primary", publishCatalog);
  publish.disabled = !dirty;
  bar.replaceChildren(text, publish);
}

async function publishCatalog() {
  const btn = $(".store-publish .primary", store.root);
  btn.disabled = true;
  try {
    const data = await fetchJson("/api/admin/shop/catalog", { method: "PUT", body: { catalog: store.draft, revision: store.revision } });
    store.draft = data.catalog;
    store.saved = JSON.stringify(data.catalog);
    store.revision = data.revision;
    store.errors = [];
    showToast("Shop published");
    renderPills();
    renderPublishBar();
    renderTab();
  } catch (error) {
    showToast(error.message, true);
    renderPublishBar(error.data?.errors || [error.message]);
  }
}

function renderTab() {
  const body = $(".store-body", store.root);
  if (!body) return;
  const renderers = { offers: renderOffers, sales: renderSales, dailies: renderDailies, sections: renderSections, payments: renderPayments };
  body.replaceChildren(renderers[store.tab]());
}

// ---- Offers ----
function offerCard(offer, { compact = false, onClick } = {}) {
  const card = button(null, `offer-card rarity-${offer.rarity || "common"}${compact ? " is-compact" : ""}`, onClick);
  const art = node("div", null, "offer-art");
  if (offer.banner) art.append(Object.assign(node("img"), { src: offer.banner, alt: "", loading: "lazy" }));
  if (offer.badge) art.append(node("span", offer.badge, "offer-badge"));
  const sales = store.draft.rotation?.sales || {};
  if ((sales.pinnedOfferIds || []).includes(offer.id)) art.append(node("span", "Pinned sale", "offer-flag"));
  else if ((sales.promotedOfferIds || []).includes(offer.id)) art.append(node("span", "In sale rotation", "offer-flag"));
  const info = node("div", null, "offer-info");
  info.append(node("strong", offer.name || "Untitled"), node("span", `${offer.kind ? KINDS.find(([k]) => k === offer.kind)?.[1] : "Daily reward"}${offer.section ? ` · ${sectionName(offer.section)}` : ""}`, "muted"));
  if (!compact) info.append(node("span", (offer.grants || []).map(grantLabel).join(", "), "offer-grants"));
  const foot = node("div", null, "offer-foot");
  foot.append(priceNode(offer.price || { type: "free" }), node("span", offer.rarity || "common", `tag rarity-tag rarity-${offer.rarity || "common"}`));
  card.append(art, info, foot);
  return card;
}

function renderOffers() {
  const wrap = node("div", null, "store-panel");
  const bar = node("div", null, "store-toolbar");
  const chips = node("div", null, "segmented");
  const filters = [["all", "All"], ...sections().filter((s) => s.id !== "dailies").map((s) => [s.id, s.name])];
  for (const [id, label] of filters) {
    const count = id === "all" ? store.draft.offers.length : store.draft.offers.filter((o) => o.section === id).length;
    chips.append(button(`${label} ${count}`, id === store.filter ? "is-active" : "", () => { store.filter = id; renderTab(); }));
  }
  const search = input("search", store.query, { placeholder: "Search offers…", "aria-label": "Search offers" });
  search.addEventListener("input", () => { store.query = search.value; drawGrid(); });
  bar.append(chips, search, node("span", null, "spacer"), button("+ New offer", "primary", () => editOffer(null)));
  const grid = node("div", null, "offer-grid");
  wrap.append(bar, grid);

  function drawGrid() {
    const query = store.query.trim().toLowerCase();
    const offers = store.draft.offers.filter((o) => (store.filter === "all" || o.section === store.filter) && (!query || `${o.name} ${o.id}`.toLowerCase().includes(query)));
    grid.replaceChildren(...offers.map((offer) => {
      const holder = node("div", null, "offer-holder");
      holder.append(offerCard(offer, { onClick: () => editOffer(offer) }));
      const actions = node("div", null, "offer-actions");
      actions.append(
        button("Edit", "mini", () => editOffer(offer)),
        button("Duplicate", "mini", () => duplicateOffer(offer)),
        button("Delete", "mini danger", () => deleteOffer(offer)),
      );
      holder.append(actions);
      return holder;
    }));
    if (!offers.length) grid.append(node("p", "No offers match.", "muted pad"));
  }
  drawGrid();
  return wrap;
}

function duplicateOffer(offer) {
  const copy = clone(offer);
  copy.id = uniqueId(`${offer.id}-copy`, allIds());
  copy.name = `${offer.name} (copy)`;
  // A copy of a single item would sell the same cosmetic twice; make it a bundle.
  if (copy.kind === "item") copy.kind = "bundle";
  delete copy.eligibility;
  store.draft.offers.push(copy);
  markChanged();
  editOffer(copy);
}

function deleteOffer(offer) {
  if (!window.confirm(`Remove "${offer.name}" from the shop? Past orders keep their records.`)) return;
  store.draft.offers = store.draft.offers.filter((o) => o !== offer);
  const sales = store.draft.rotation?.sales;
  if (sales) for (const key of ["pinnedOfferIds", "promotedOfferIds"]) sales[key] = (sales[key] || []).filter((id) => id !== offer.id);
  markChanged();
}

// Grants editor shared by offers and daily rewards.
function grantsEditor(grants, onChange) {
  const box = node("div", null, "grants-editor");
  function draw() {
    box.replaceChildren();
    grants.forEach((grant, index) => {
      const row = node("div", null, "grant-edit-row");
      const kindValue = grant.kind === "currency" ? grant.currency : grant.kind;
      const kind = select(GRANT_KINDS, kindValue);
      kind.addEventListener("change", () => {
        grants[index] = ["coins", "gems"].includes(kind.value) ? { kind: "currency", currency: kind.value, amount: grant.amount || 100 } : { kind: kind.value, id: unsoldCosmetic(kind.value) };
        draw(); onChange();
      });
      row.append(kind);
      if (grant.kind === "currency") {
        const amount = input("number", grant.amount, { min: "1", step: "1", "aria-label": "Amount" });
        amount.addEventListener("input", () => { grants[index].amount = Math.max(0, Math.floor(Number(amount.value) || 0)); onChange(); });
        row.append(amount);
      } else {
        const picker = select(optionsFor(grant.kind).map((o) => [o.id, `${o.name}${o.character ? ` · ${titleCase(o.character)}` : ""}`]), grant.id);
        picker.addEventListener("change", () => { grants[index].id = picker.value; drawThumb(); onChange(); });
        const thumb = node("img", null, "grant-thumb");
        const drawThumb = () => { thumb.src = optionsFor(grant.kind).find((o) => o.id === grants[index].id)?.assetUrl || ""; };
        drawThumb();
        row.append(thumb, picker);
      }
      row.append(button("×", "mini danger", () => { grants.splice(index, 1); draw(); onChange(); }));
      box.append(row);
    });
    box.append(button("+ Add reward", "mini", () => { grants.push({ kind: "currency", currency: "gems", amount: 50 }); draw(); onChange(); }));
  }
  draw();
  return box;
}

// First cosmetic of a kind that no single-item offer sells yet (skipping free defaults).
function unsoldCosmetic(kind) {
  const sold = new Set(store.draft.offers.flatMap((o) => (o.grants || []).filter((g) => g.kind === kind).map((g) => g.id)));
  const choices = optionsFor(kind).filter((o) => o.id !== "default" && !/-default$/.test(o.id));
  return (choices.find((o) => !sold.has(o.id)) || choices[0] || optionsFor(kind)[0])?.id || "";
}

const optionsFor = (kind) => ({ skin: store.options.skins, card: store.options.cards, profileIcon: store.options.profileIcons }[kind] || []);

function bannerPicker(current, onPick) {
  const grid = node("div", null, "banner-picker");
  for (const src of store.options.banners) {
    const choice = button(null, `banner-choice${src === current ? " is-active" : ""}`, () => {
      grid.querySelectorAll(".banner-choice").forEach((el) => el.classList.toggle("is-active", el === choice));
      onPick(src);
    });
    choice.title = src.split("/").pop();
    choice.append(Object.assign(node("img"), { src, alt: "", loading: "lazy" }));
    grid.append(choice);
  }
  return grid;
}

function editOffer(existing) {
  const isNew = !existing;
  const draft = existing ? clone(existing) : {
    id: "", section: sections().find((s) => !["sales", "dailies"].includes(s.id))?.id || "currency", kind: "item", name: "", description: "",
    rarity: "common", banner: store.options.banners[0] || "", price: { type: "virtual", currency: "gems", amount: 49 }, purchaseLimit: "lifetime",
    grants: [{ kind: "card", id: unsoldCosmetic("card") }],
  };
  const preview = node("div", null, "offer-preview");
  const drawPreview = () => preview.replaceChildren(node("span", "Preview", "field-label"), offerCard(draft));

  const name = input("text", draft.name, { maxlength: "60", required: "" });
  const id = input("text", draft.id, { pattern: "[a-z0-9][a-z0-9-]{1,63}", required: "" });
  id.disabled = !isNew;
  let idTouched = !isNew;
  name.addEventListener("input", () => { draft.name = name.value; if (!idTouched) { draft.id = uniqueId(slug(name.value), allIds()); id.value = draft.id; } drawPreview(); });
  id.addEventListener("input", () => { idTouched = true; draft.id = id.value.trim(); });
  const description = node("textarea");
  description.value = draft.description || ""; description.maxLength = 200; description.rows = 2;
  description.addEventListener("input", () => { draft.description = description.value; });
  const section = select(sections().filter((s) => s.id !== "dailies").map((s) => [s.id, s.name]), draft.section);
  section.addEventListener("change", () => { draft.section = section.value; drawPreview(); });
  const kind = select(KINDS, draft.kind);
  const kindHint = node("small", null, "hint");
  const drawKindHint = () => { kindHint.textContent = { item: "Exactly one cosmetic (skin, card or icon).", bundle: "Several rewards together; shows its value next to the price.", "currency-pack": "Coins or gems only. Use this for real-money packs." }[draft.kind]; };
  kind.addEventListener("change", () => { draft.kind = kind.value; drawKindHint(); drawPreview(); });
  drawKindHint();
  const rarity = select(RARITIES, draft.rarity || "common");
  rarity.addEventListener("change", () => { draft.rarity = rarity.value; drawPreview(); });
  const badge = input("text", draft.badge || "", { maxlength: "16", placeholder: "e.g. BEST VALUE" });
  badge.addEventListener("input", () => { if (badge.value.trim()) draft.badge = badge.value.trim().toUpperCase(); else delete draft.badge; drawPreview(); });

  // Price: coins, gems or real money.
  const priceType = node("div", null, "segmented");
  const amount = input("number", "", { min: "0", step: "1" });
  const amountLabel = node("span");
  const limit = select([["lifetime", "Once per player"], ["unlimited", "Unlimited"]], draft.purchaseLimit);
  limit.addEventListener("change", () => { draft.purchaseLimit = limit.value; });
  const drawPrice = () => {
    const money = draft.price.type === "money";
    priceType.querySelectorAll("button").forEach((b) => b.classList.toggle("is-active", b.dataset.value === (money ? "money" : draft.price.currency)));
    amountLabel.textContent = money ? "Price in US dollars" : `Price in ${draft.price.currency}`;
    amount.step = money ? "0.01" : "1";
    amount.value = money ? (Number(draft.price.amountCents || 0) / 100).toFixed(2) : draft.price.amount;
    if (money) { draft.purchaseLimit = "unlimited"; limit.value = "unlimited"; delete draft.eligibility; }
    limit.disabled = money;
    drawPreview();
  };
  for (const [value, label] of [["gems", "Gems"], ["coins", "Coins"], ["money", "Real money"]]) {
    const b = button(label, "", () => {
      draft.price = value === "money" ? { type: "money", currency: "usd", amountCents: draft.price.amountCents || 99 } : { type: "virtual", currency: value, amount: draft.price.amount || 49 };
      drawPrice();
    });
    b.dataset.value = value;
    priceType.append(b);
  }
  amount.addEventListener("input", () => {
    if (draft.price.type === "money") draft.price.amountCents = Math.round((Number(amount.value) || 0) * 100);
    else draft.price.amount = Math.max(0, Math.floor(Number(amount.value) || 0));
    drawPreview();
  });

  const discount = input("number", draft.saleDiscountPercent ?? "", { min: "0", max: "90", step: "1", placeholder: `${store.draft.rotation?.sales?.discountPercent ?? 0}% (weekly default)` });
  discount.addEventListener("input", () => { if (discount.value === "") delete draft.saleDiscountPercent; else draft.saleDiscountPercent = Math.max(0, Math.min(90, Math.floor(Number(discount.value)))); });
  const hideOwned = Object.assign(node("input"), { type: "checkbox", checked: !!draft.eligibility?.requiresNotOwned });
  hideOwned.addEventListener("change", () => {
    const cosmetic = draft.grants.find((g) => g.kind !== "currency");
    if (hideOwned.checked && cosmetic) draft.eligibility = { requiresNotOwned: { kind: cosmetic.kind, id: cosmetic.id } };
    else delete draft.eligibility;
  });
  const hideOwnedLabel = node("label", null, "check");
  hideOwnedLabel.append(hideOwned, node("span", "Hide from players who already own the cosmetic"));

  const modal = openModal(isNew ? "New offer" : `Edit ${existing.name}`, {
    wide: true,
    submitLabel: isNew ? "Add offer" : "Apply",
    onSubmit: () => {
      if (!draft.name.trim()) throw new Error("Give the offer a name.");
      if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(draft.id)) throw new Error("The ID needs 2–64 lowercase letters, numbers or dashes.");
      if (isNew && allIds().has(draft.id)) throw new Error("That ID is already used.");
      if (!draft.grants.length) throw new Error("Add at least one reward.");
      if (draft.price.type === "money" ? draft.price.amountCents < 50 : draft.price.amount <= 0) throw new Error("Set a price (at least $0.50 for real money).");
      if (draft.eligibility?.requiresNotOwned) {
        const cosmetic = draft.grants.find((g) => g.kind !== "currency");
        if (cosmetic) draft.eligibility = { requiresNotOwned: { kind: cosmetic.kind, id: cosmetic.id } }; else delete draft.eligibility;
      }
      if (isNew) store.draft.offers.push(draft);
      else store.draft.offers[store.draft.offers.indexOf(existing)] = draft;
      // An offer placed in the Sales section must be part of the sale rotation.
      const sales = store.draft.rotation.sales;
      if (draft.section === "sales" && !sales.pinnedOfferIds.includes(draft.id) && !sales.promotedOfferIds.includes(draft.id)) sales.pinnedOfferIds.push(draft.id);
      markChanged();
    },
  });

  const form = node("div", null, "editor-grid");
  const left = node("div", null, "editor-fields");
  const row = (...children) => { const r = node("div", null, "field-row"); r.append(...children); return r; };
  const priceField = node("div", null, "field");
  priceField.append(node("span", "Price", "field-label"), priceType);
  const amountField = node("label", null, "field");
  amountField.append(amountLabel, amount);
  left.append(
    row(field("Name", name), field("ID", id, isNew ? "Used in orders; can't change later." : "IDs can't change after creation.")),
    field("Description", description),
    row(field("Section", section), field("Type", kind), field("Rarity", rarity)),
    kindHint,
    row(priceField, amountField),
    row(field("Purchase limit", limit), field("Sale discount %", discount, "Only used while it's on sale."), field("Badge", badge)),
    hideOwnedLabel,
    node("span", "Rewards", "field-label"),
    grantsEditor(draft.grants, drawPreview),
    node("span", "Banner", "field-label"),
    bannerPicker(draft.banner, (src) => { draft.banner = src; drawPreview(); }),
  );
  form.append(left, preview);
  modal.body.append(form);
  drawPrice();
  name.focus();
}

// ---- Weekly sales ----
function renderSales() {
  const sales = store.draft.rotation.sales;
  const wrap = node("div", null, "store-panel sales-grid");
  const rotation = store.status?.rotations?.sales || {};

  const settings = node("article", null, "panel");
  settings.append(node("div", "Sale settings", "panel-title"));
  const discount = input("number", sales.discountPercent, { min: "0", max: "90", step: "1" });
  discount.addEventListener("change", () => { sales.discountPercent = Math.max(0, Math.min(90, Math.floor(Number(discount.value) || 0))); markChanged(); });
  const count = input("number", sales.promotedCount, { min: "0", step: "1" });
  count.addEventListener("change", () => { sales.promotedCount = Math.max(0, Math.floor(Number(count.value) || 0)); markChanged(); });
  const fields = node("div", null, "field-row");
  fields.append(field("Discount %", discount, "Applied to sale items unless an offer sets its own."), field("Rotating offers per week", count, "Picked in order from the rotation pool."));
  const refreshRow = node("div", null, "rotation-status");
  refreshRow.append(node("span", `${cycleLabel(rotation)} · next rotation ${formatAdminDate(rotation.nextRefreshAt, true)}`, "muted"), button("Rotate sales now", "", () => refreshRotation("sales")));
  settings.append(fields, refreshRow);

  const preview = node("article", null, "panel");
  preview.append(node("div", "On sale", "panel-title"));
  const ordinal = Number(rotation.ordinal) || 0;
  const offerById = new Map(store.draft.offers.map((o) => [o.id, o]));
  for (const [label, ord] of [["This week", ordinal], ["Next week", ordinal + 1]]) {
    const ids = getSaleOfferIds(store.draft, { ordinal: ord });
    preview.append(node("span", label, "field-label"));
    const row = node("div", null, "offer-grid is-compact");
    row.append(...ids.map((id) => offerById.get(id)).filter(Boolean).map((offer) => offerCard(offer, { compact: true, onClick: () => editOffer(offer) })));
    if (!ids.length) row.append(node("p", "Nothing on sale.", "muted"));
    preview.append(row);
  }

  wrap.append(settings, preview, offerList("Always on sale (pinned)", "pinnedOfferIds", "Shown every week."), offerList("Rotation pool", "promotedOfferIds", "Each week the next offers in this order go on sale."));
  return wrap;
}

function offerList(title, key, hint) {
  const sales = store.draft.rotation.sales;
  const panel = node("article", null, "panel");
  panel.append(node("div", title, "panel-title"), node("p", hint, "hint"));
  const list = node("ol", null, "order-list");
  sales[key].forEach((id, index) => {
    const offer = store.draft.offers.find((o) => o.id === id);
    const li = node("li");
    const thumb = node("img", null, "order-thumb");
    thumb.src = offer?.banner || ""; thumb.alt = "";
    const label = node("span", null, "order-label");
    label.append(node("strong", offer?.name || id), priceNode(offer?.price));
    const up = button("↑", "mini arrow", () => { [sales[key][index - 1], sales[key][index]] = [sales[key][index], sales[key][index - 1]]; markChanged(); });
    const down = button("↓", "mini arrow", () => { [sales[key][index + 1], sales[key][index]] = [sales[key][index], sales[key][index + 1]]; markChanged(); });
    up.disabled = index === 0; down.disabled = index === sales[key].length - 1;
    li.append(thumb, label, up, down, button("Remove", "mini danger", () => {
      const removed = sales[key].splice(index, 1)[0];
      const offer2 = store.draft.offers.find((o) => o.id === removed);
      if (offer2?.section === "sales") window.alert(`"${offer2.name}" is in the Sales section, so it must stay on sale. Move it to another section first, or it will fail to publish.`);
      markChanged();
    }));
    list.append(li);
  });
  if (!sales[key].length) list.append(node("li", "Empty", "muted"));
  const used = new Set([...sales.pinnedOfferIds, ...sales.promotedOfferIds]);
  const candidates = store.draft.offers.filter((o) => o.price?.type === "virtual" && !used.has(o.id));
  const add = select([["", candidates.length ? "+ Add an offer…" : "No more coin or gem offers"], ...candidates.map((o) => [o.id, `${o.name} · ${o.price.amount} ${o.price.currency}`])], "");
  add.disabled = !candidates.length;
  add.addEventListener("change", () => { if (add.value) { sales[key].push(add.value); markChanged(); } });
  panel.append(list, add);
  return panel;
}

// "week:2026-11-09:g1" → "Week of Nov 9 (rotated early 1×)".
function cycleLabel(rotation) {
  const [kind, date, generation] = String(rotation?.cycleKey || "").split(":");
  if (!date) return "Current cycle unknown";
  const day = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
  const early = Number(String(generation || "").slice(1)) || 0;
  return `${kind === "week" ? "Week of" : "Day"} ${day}${early ? ` (rotated early ${early}×)` : ""}`;
}

async function refreshRotation(section) {
  if (!window.confirm(section === "sales" ? "Rotate to the next set of sale offers now?" : "Move to the next daily reward now? Players who claimed today can claim again.")) return;
  try {
    await fetchJson("/api/admin/shop/refresh", { method: "POST", body: { section } });
    await loadStatus();
    showToast(section === "sales" ? "Sales rotated" : "Daily reward advanced");
    renderTab();
  } catch (error) { showToast(error.message, true); }
}

// ---- Daily rewards ----
function renderDailies() {
  const rewards = store.draft.rotation.dailies.rewards;
  const rotation = store.status?.rotations?.dailies || {};
  const today = rewards.length ? (Math.abs(Number(rotation.ordinal) || 0) % rewards.length) : -1;
  const wrap = node("div", null, "store-panel");
  const bar = node("div", null, "store-toolbar");
  bar.append(node("p", `One free reward per day, in this order, looping. Next reset ${formatAdminDate(rotation.nextRefreshAt, true)}.`, "hint"), node("span", null, "spacer"), button("Skip to next reward", "", () => refreshRotation("dailies")), button("+ New daily reward", "primary", () => editDaily(null)));
  const grid = node("div", null, "offer-grid");
  rewards.forEach((reward, index) => {
    const holder = node("div", null, `offer-holder${index === today ? " is-today" : ""}`);
    const daysAway = (index - today + rewards.length) % rewards.length;
    holder.append(node("span", index === today ? "Today" : daysAway === 1 ? "Tomorrow" : `In ${daysAway} days`, "day-flag"));
    holder.append(offerCard(reward, { onClick: () => editDaily(reward) }));
    const actions = node("div", null, "offer-actions");
    const left = button("←", "mini arrow", () => { [rewards[index - 1], rewards[index]] = [rewards[index], rewards[index - 1]]; markChanged(); });
    const right = button("→", "mini arrow", () => { [rewards[index + 1], rewards[index]] = [rewards[index], rewards[index + 1]]; markChanged(); });
    left.disabled = index === 0; right.disabled = index === rewards.length - 1;
    const remove = button("Delete", "mini danger", () => {
      if (rewards.length === 1) return showToast("Keep at least one daily reward", true);
      if (!window.confirm(`Delete "${reward.name}"?`)) return;
      rewards.splice(index, 1); markChanged();
    });
    actions.append(left, right, button("Edit", "mini", () => editDaily(reward)), remove);
    holder.append(actions);
    grid.append(holder);
  });
  wrap.append(bar, grid);
  return wrap;
}

function editDaily(existing) {
  const isNew = !existing;
  const draft = existing ? clone(existing) : { id: "", name: "", description: "", rarity: "common", banner: store.options.banners.find((b) => b.includes("daily")) || store.options.banners[0], grants: [{ kind: "currency", currency: "coins", amount: 50 }] };
  const preview = node("div", null, "offer-preview");
  const drawPreview = () => preview.replaceChildren(node("span", "Preview", "field-label"), offerCard({ ...draft, price: { type: "free" } }));
  const name = input("text", draft.name, { maxlength: "60" });
  name.addEventListener("input", () => { draft.name = name.value; if (isNew) draft.id = uniqueId(`daily-${slug(name.value)}`, allIds()); drawPreview(); });
  const description = node("textarea");
  description.value = draft.description || ""; description.rows = 2; description.maxLength = 200;
  description.addEventListener("input", () => { draft.description = description.value; });
  const rarity = select(RARITIES, draft.rarity);
  rarity.addEventListener("change", () => { draft.rarity = rarity.value; drawPreview(); });
  const modal = openModal(isNew ? "New daily reward" : `Edit ${existing.name}`, {
    wide: true,
    submitLabel: isNew ? "Add reward" : "Apply",
    onSubmit: () => {
      if (!draft.name.trim()) throw new Error("Give the reward a name.");
      if (!draft.grants.length) throw new Error("Add at least one reward.");
      const rewards = store.draft.rotation.dailies.rewards;
      if (isNew) rewards.push(draft); else rewards[rewards.indexOf(existing)] = draft;
      markChanged();
    },
  });
  const left = node("div", null, "editor-fields");
  const row = node("div", null, "field-row");
  row.append(field("Name", name), field("Rarity", rarity));
  left.append(row, field("Description", description), node("span", "Rewards", "field-label"), grantsEditor(draft.grants, drawPreview), node("span", "Banner", "field-label"), bannerPicker(draft.banner, (src) => { draft.banner = src; drawPreview(); }));
  const grid = node("div", null, "editor-grid");
  grid.append(left, preview);
  modal.body.append(grid);
  drawPreview();
  name.focus();
}

// ---- Sections ----
function renderSections() {
  const list = sections();
  const wrap = node("div", null, "store-panel");
  const panel = node("article", null, "panel");
  panel.append(node("div", "Shop tabs", "panel-title"), node("p", `Tabs appear in this order. Sales and Dailies are required. Rotations reset in ${store.draft.timezone}.`, "hint"));
  const rows = node("ol", null, "order-list section-list");
  list.forEach((section, index) => {
    const li = node("li");
    const icon = node("img", null, "order-thumb is-icon");
    icon.src = section.icon; icon.alt = "";
    const nameInput = input("text", section.name, { "aria-label": "Tab name", maxlength: "30" });
    nameInput.addEventListener("change", () => { section.name = nameInput.value.trim() || section.name; markChanged(); });
    const iconSelect = select(store.options.icons.map((src) => [src, src.split("/").pop()]), section.icon);
    iconSelect.addEventListener("change", () => { section.icon = iconSelect.value; markChanged(); });
    const collapsible = Object.assign(node("input"), { type: "checkbox", checked: !!section.collapsible });
    collapsible.addEventListener("change", () => { if (collapsible.checked) section.collapsible = true; else delete section.collapsible; markChanged(); });
    const collapseLabel = node("label", null, "check");
    collapseLabel.append(collapsible, node("span", "Collapsible"));
    const used = store.draft.offers.filter((o) => o.section === section.id).length;
    const up = button("↑", "mini arrow", () => { [list[index - 1], list[index]] = [list[index], list[index - 1]]; markChanged(); });
    const down = button("↓", "mini arrow", () => { [list[index + 1], list[index]] = [list[index], list[index + 1]]; markChanged(); });
    up.disabled = index === 0; down.disabled = index === list.length - 1;
    const remove = button("Delete", "mini danger", () => {
      if (!window.confirm(`Delete the "${section.name}" tab?`)) return;
      list.splice(index, 1); markChanged();
    });
    remove.disabled = section.rotation || used > 0;
    remove.title = section.rotation ? "Required tab" : used ? "Move its offers first" : "";
    li.append(icon, nameInput, iconSelect, collapseLabel, node("span", section.rotation ? "Rotation" : `${used} offers`, "muted"), up, down, remove);
    rows.append(li);
  });
  panel.append(rows, button("+ Add tab", "", () => {
    const name = window.prompt("Name for the new shop tab");
    if (!name?.trim()) return;
    const id = uniqueId(slug(name).replace(/^[^a-z]+/, "") || "tab", new Set(list.map((s) => s.id)));
    list.push({ id, name: name.trim(), icon: store.options.icons.find((i) => i.includes("shop")) || store.options.icons[0], collapsible: true });
    markChanged();
  }));
  wrap.append(panel);
  return wrap;
}

// ---- Orders & payments ----
function renderPayments() {
  const wrap = node("div", null, "store-panel payments-grid");
  const payment = store.status?.payment || {};
  const stripe = node("article", null, "panel");
  stripe.append(node("div", "Stripe payments", "panel-title"));
  stripe.append(node("p", payment.enabled ? "Stripe is configured. Real-money offers can be bought." : "Stripe is off, so real-money offers show as unavailable.", payment.enabled ? "good-text" : "bad-text"));
  if (payment.listener) stripe.append(node("p", payment.listener.message, payment.listener.state === "listening" ? "good-text" : "hint"));
  stripe.append(button("Refresh payment status", "btn", async () => {
    try { await loadStatus(); render(); } catch (error) { showToast(error.message); }
  }));
  if (payment.missing?.length) {
    stripe.append(node("p", "Add these to the server's environment and restart:", "hint"));
    const list = node("ul", null, "plain-list");
    for (const key of payment.missing) list.append(node("li", key, "mono"));
    stripe.append(list);
  }
  const money = store.draft.offers.filter((o) => o.price?.type === "money");
  stripe.append(node("span", "Real-money offers", "field-label"));
  const moneyList = node("ul", null, "recent-list");
  for (const offer of money) {
    const li = node("li");
    li.append(button(offer.name, "row-link", () => editOffer(offer)), node("span", (offer.grants || []).map(grantLabel).join(", "), "muted"), priceNode(offer.price));
    moneyList.append(li);
  }
  if (!money.length) moneyList.append(node("li", "None", "muted"));
  stripe.append(moneyList);

  const orders = node("article", null, "panel");
  orders.append(node("div", "Recent orders", "panel-title"));
  const rows = store.status?.recentOrders || [];
  if (!rows.length) orders.append(node("p", store.status?.error || "No orders yet.", "muted"));
  else {
    const table = node("table");
    table.innerHTML = "<thead><tr><th>Offer</th><th>Player</th><th>Status</th><th>Amount</th><th>Created</th><th>Fulfilled</th></tr></thead><tbody></tbody>";
    for (const order of rows) {
      const tr = node("tr");
      tr.append(node("td", store.draft.offers.find((o) => o.id === order.offer_id)?.name || order.offer_id), node("td", `#${order.user_id}`), Object.assign(node("td"), {}), node("td", `$${(Number(order.amount_cents || 0) / 100).toFixed(2)} ${String(order.currency || "usd").toUpperCase()}`), node("td", formatAdminDate(order.created_at, true)), node("td", formatAdminDate(order.fulfilled_at, true)));
      tr.children[2].append(node("span", order.status, `tag tag-${order.status}`));
      table.tBodies[0].append(tr);
    }
    const scroll = node("div", null, "table-wrap");
    scroll.append(table);
    orders.append(scroll);
  }
  wrap.append(stripe, orders);
  return wrap;
}
