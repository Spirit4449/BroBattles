import { node, field, input, select, fmt, titleCase } from "../common";
import { getBundleValue, buildOfferIndexes, isRotatingSection, getSectionRotationSize } from "../../../server/services/shop/shopOfferRules";
import { RARITIES, KINDS, store, offers, sections, sales, sectionOf, sectionName, allIds, slug, uniqueId, cosmeticName, saleInfo, shopCard, weeklyStatus, problemText, problemsFor } from "./catalogDraft";
import { STATUS_FLAG } from "./offerList";
import { grantsEditor, bannerPicker, segmented } from "./offerControls";

function row(...children) {
  const element = node("div", null, "field-row");
  element.append(...children);
  return element;
}

function group(title, ...children) {
  const element = node("fieldset", null, "editor-group");
  element.append(node("legend", title), ...children);
  return element;
}

export function createOfferBasics(draft, { isNew, drawPreview, getSaleRole, setRole }) {
  // Identity
  const name = input("text", draft.name, { maxlength: "60", required: "", placeholder: "e.g. Sky Duck" });
  const id = input("text", draft.id, { pattern: "[a-z0-9][a-z0-9\\-]{1,63}", required: "", spellcheck: "false" });
  id.disabled = !isNew;
  let idTouched = !isNew;
  name.addEventListener("input", () => { draft.name = name.value; if (!idTouched) { draft.id = uniqueId(slug(name.value), allIds()); id.value = draft.id; } drawPreview(); });
  id.addEventListener("input", () => { idTouched = true; draft.id = id.value.trim(); });
  const description = node("textarea");
  description.value = draft.description || ""; description.maxLength = 200; description.rows = 2;
  description.placeholder = "One short line shown in the purchase dialog";
  description.addEventListener("input", () => { draft.description = description.value; });
  const section = select(sections().filter((s) => s.id !== "dailies").map((s) => [s.id, s.name]), draft.section);
  const sectionHint = node("small", null, "hint");
  const drawSectionHint = () => {
    const meta = sectionOf(draft.section);
    sectionHint.textContent = draft.section === "sales" ? "Sales-section offers must stay on sale (pinned or in the pool)."
      : isRotatingSection(meta) ? `Rotates weekly: ${getSectionRotationSize(meta)} of this section's offers show each week.` : "";
  };
  section.addEventListener("change", () => {
    draft.section = section.value;
    if (draft.section === "sales" && getSaleRole() === "none") setRole("pinned");
    drawSectionHint(); drawPreview();
  });
  const rarity = segmented(RARITIES.map((r) => [r, titleCase(r)]), draft.rarity || "common", (value) => { draft.rarity = value; drawPreview(); });
  rarity.classList.add("rarity-segmented");
  const badge = input("text", draft.badge || "", { maxlength: "16", placeholder: "e.g. BEST VALUE" });
  badge.addEventListener("input", () => { if (badge.value.trim()) draft.badge = badge.value.trim().toUpperCase(); else delete draft.badge; drawPreview(); });
  const sectionField = field("Section", section);
  sectionField.append(sectionHint);
  const rarityField = node("div", null, "field");
  rarityField.append(node("span", "Rarity", "field-label"), rarity);
  const element = group(
    "Basics",
    row(field("Name", name), field("ID", id, isNew ? "Used in orders and can't change later." : "IDs can't change after creation.")),
    field("Description", description),
    row(sectionField, field("Badge", badge, "Optional corner label.")),
    rarityField,
  );
  return { element, draw: drawSectionHint, focus: () => name.focus() };
}

export function createOfferRewards(draft, { suggestedKind, allowedKinds, onRewardsChange, onKindChange }) {
  // Type follows the rewards: only valid choices are enabled.
  const kindHost = node("div");
  const kindHint = node("small", null, "hint");
  function drawKind() {
    draft.kind = suggestedKind(draft);
    const blocked = allowedKinds(draft);
    kindHost.replaceChildren(segmented(Object.entries(KINDS).map(([value, label]) => [value, label, blocked[value]]), draft.kind, (value) => { draft.kind = value; drawKind(); onKindChange(); }));
    kindHint.textContent = { item: "One cosmetic sold on its own. Bundles use its price to show their value.", bundle: "Several rewards for one price. The card shows their combined value.", "currency-pack": "Coins or gems only. The only type that can cost real money." }[draft.kind];
  }

  // Rewards
  const grants = grantsEditor(draft.grants, () => { drawKind(); onRewardsChange(); });
  const typeField = node("div", null, "field");
  typeField.append(node("span", "Type", "field-label"), kindHost, kindHint);
  return { element: group("Rewards", grants.element, typeField), draw: drawKind };
}

export function createOfferPricing(draft, { onPriceTypeChange, onPriceAmountChange }) {
  // Price
  const priceHost = node("div");
  const amount = input("number", "", { min: "0", step: "1", "aria-label": "Price" });
  const amountLabel = node("span");
  const valueHint = node("small", null, "hint");
  const limit = segmented([["lifetime", "Once per player"], ["unlimited", "Unlimited"]], draft.purchaseLimit, (value) => { draft.purchaseLimit = value; });
  function drawPrice() {
    const money = draft.price.type === "money";
    if (money && draft.kind !== "currency-pack") draft.price = { type: "virtual", currency: "gems", amount: 49 };
    const priceType = segmented([["gems", "Gems"], ["coins", "Coins"], ["money", "Real money", draft.kind === "currency-pack" ? null : "Only currency packs can cost real money"]],
      draft.price.type === "money" ? "money" : draft.price.currency,
      (value) => {
        draft.price = value === "money" ? { type: "money", currency: "usd", amountCents: draft.price.amountCents || 99 } : { type: "virtual", currency: value, amount: draft.price.amount || 49 };
        drawPrice(); onPriceTypeChange();
      });
    priceHost.replaceChildren(priceType);
    const isMoney = draft.price.type === "money";
    amountLabel.textContent = isMoney ? "Price in US dollars" : `Price in ${draft.price.currency}`;
    amount.step = isMoney ? "0.01" : "1";
    amount.min = isMoney ? "0.50" : "1";
    amount.value = isMoney ? (Number(draft.price.amountCents || 0) / 100).toFixed(2) : draft.price.amount;
    if (isMoney) { draft.purchaseLimit = "unlimited"; delete draft.eligibility; }
    limit.querySelectorAll("button").forEach((b) => { b.disabled = isMoney && b.dataset.value === "lifetime"; b.classList.toggle("is-active", b.dataset.value === draft.purchaseLimit); });
    const { offerByGrant } = buildOfferIndexes({ ...store.draft, offers: offers().filter((o) => o.id !== draft.id) });
    const value = getBundleValue(draft, offerByGrant);
    valueHint.textContent = value?.cosmeticPrice?.amount ? `Bought separately: ${fmt(value.cosmeticPrice.amount)} ${draft.price.currency}${Object.entries(value.bonusCurrencies).map(([c, a]) => ` + ${fmt(a)} ${c}`).join("")}` : "";
  }
  amount.addEventListener("input", () => {
    if (draft.price.type === "money") draft.price.amountCents = Math.round((Number(amount.value) || 0) * 100);
    else draft.price.amount = Math.max(0, Math.floor(Number(amount.value) || 0));
    onPriceAmountChange();
  });
  const amountField = node("label", null, "field");
  amountField.append(amountLabel, amount, valueHint);
  const priceField = node("div", null, "field");
  priceField.append(node("span", "Paid with", "field-label"), priceHost);
  const limitField = node("div", null, "field");
  limitField.append(node("span", "Purchase limit", "field-label"), limit);
  const eligibility = createOfferEligibility(draft);
  const element = group("Price", row(priceField, amountField), row(limitField, eligibility.element));
  return { element, draw: drawPrice, drawEligibility: eligibility.draw };
}

function createOfferEligibility(draft) {

  const eligibilityHost = node("div");
  function drawEligibility() {
    const cosmetics = draft.grants.filter((g) => g.kind !== "currency");
    eligibilityHost.replaceChildren();
    if (draft.price.type === "money" || !cosmetics.length) { delete draft.eligibility; eligibilityHost.append(node("small", "Only offers with cosmetics can be blocked by ownership.", "hint")); return; }
    const current = draft.eligibility?.requiresNotOwned;
    const valid = current && cosmetics.some((g) => g.kind === current.kind && g.id === current.id);
    if (current && !valid) delete draft.eligibility;
    const options = [["", "Always available"], ...cosmetics.map((g) => [`${g.kind}:${g.id}`, `Not if they own ${cosmeticName(g)}`])];
    const choose = select(options, valid ? `${current.kind}:${current.id}` : "");
    choose.addEventListener("change", () => {
      if (!choose.value) delete draft.eligibility;
      else { const [kind, ...rest] = choose.value.split(":"); draft.eligibility = { requiresNotOwned: { kind, id: rest.join(":") } }; }
    });
    eligibilityHost.append(field("Availability", choose, "Hide a bundle from players who already own its main cosmetic."));
  }
  return { element: eligibilityHost, draw: drawEligibility };
}

export function createOfferSchedule(draft, existing, { getSaleRole, setRole, showSalePreview, drawPreview }) {
  // Weekly sale
  const salesHost = node("div", null, "editor-sales");
  function drawSales() {
    salesHost.replaceChildren();
    if (draft.price.type !== "virtual") { setRole("none"); salesHost.append(node("p", "Real-money offers can't go on sale.", "hint")); return; }
    const lockedOn = draft.section === "sales";
    salesHost.append(segmented([["none", "Not on sale", lockedOn ? "Sales-section offers must stay on sale" : null], ["pinned", "Every week"], ["pool", "In the rotation"]], getSaleRole(), value => { setRole(value); drawSales(); showSalePreview(value !== "none"); }));
    const defaultPercent = sales().discountPercent;
    const discount = input("number", draft.saleDiscountPercent ?? "", { min: "0", max: "90", step: "1", placeholder: draft.kind === "bundle" ? "0 (bundles)" : `${defaultPercent} (default)`, "aria-label": "Sale discount percent" });
    discount.addEventListener("input", () => {
      if (discount.value === "") delete draft.saleDiscountPercent;
      else draft.saleDiscountPercent = Math.max(0, Math.min(90, Math.floor(Number(discount.value) || 0)));
      salePrice.textContent = describeSale(); drawPreview();
    });
    const salePrice = node("small", describeSale(), "hint");
    const row = node("div", null, "field-row");
    row.append(field("Sale discount %", discount, "Empty uses the weekly default. Bundles default to no discount."), node("div", null, "sale-result"));
    row.lastChild.append(node("span", "Sale price", "field-label"), salePrice);
    salesHost.append(row);
    if (getSaleRole() === "pool") {
      const pool = sales().promotedOfferIds;
      const position = existing ? pool.indexOf(existing.id) : -1;
      const perWeek = `${sales().promotedCount} of ${pool.length + (position < 0 ? 1 : 0)} pool offers go on sale each week.`;
      salesHost.append(node("small", position < 0 ? `Joins the end of the rotation pool. ${perWeek}` : `Number ${position + 1} in the rotation pool. ${perWeek}`, "hint"));
    }
  }
  function describeSale() {
    const info = saleInfo(draft);
    return info?.percent ? `${fmt(info.price.amount)} ${draft.price.currency} (${info.percent}% off ${fmt(draft.price.amount)})` : "Same as the regular price";
  }
  return { element: group("Weekly sale", salesHost), draw: drawSales };
}

export function createOfferPreview(draft, existing, initialSale) {
  const preview = node("div", null, "offer-preview");
  let previewSale = initialSale;
  const previewMode = segmented([["regular", "Regular"], ["sale", "On sale"]], previewSale ? "sale" : "regular", (mode) => { previewSale = mode === "sale"; drawPreview(); });
  const previewCard = node("div");
  const previewNote = node("p", null, "hint");
  preview.append(node("span", "Preview", "field-label"), previewMode, previewCard, previewNote);
  function drawPreview() {
    const saleable = draft.price.type === "virtual";
    previewMode.querySelector('[data-value="sale"]').disabled = !saleable;
    if (!saleable) previewSale = false;
    previewMode.querySelectorAll("button").forEach((b) => b.classList.toggle("is-active", b.dataset.value === (previewSale ? "sale" : "regular")));
    previewCard.replaceChildren(shopCard(draft, { onSale: previewSale }));
    const status = existing ? weeklyStatus({ ...draft, id: existing.id }) : null;
    previewNote.textContent = status ? `${STATUS_FLAG[status][0]} · ${sectionName(draft.section)}` : `Goes in ${sectionName(draft.section)}`;
  }
  return {
    element: preview,
    draw: drawPreview,
    showSale(value) {
      previewSale = value;
      drawPreview();
    },
  };
}

export function createOfferProblems(existing) {
  const problemsHost = node("div");
  if (existing) {
    const found = problemsFor("offer", existing.id);
    if (found.length) {
      const box = node("div", null, "editor-problems");
      box.append(node("strong", "Fix before publishing"));
      const list = node("ul");
      for (const message of found) list.append(node("li", problemText(message)));
      box.append(list);
      problemsHost.append(box);
    }
  }
  return problemsHost;
}

export function createOfferBanner(draft, drawPreview) {
  return group("Banner", bannerPicker(draft.banner, src => {
    draft.banner = src;
    drawPreview();
  }, [draft.name, ...draft.grants.map(grant => grant.id || grant.currency)]));
}
