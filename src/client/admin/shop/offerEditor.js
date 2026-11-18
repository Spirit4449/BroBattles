import { node, showToast, openModal } from "../common";
import { KINDS, store, clone, offers, sections, allIds, saleRole, setSaleRole, markChanged } from "./catalogDraft";
import { duplicateOffer, deleteOffer } from "./offerList";
import { unsoldCosmetic } from "./offerControls";
import {
  createOfferBanner,
  createOfferBasics,
  createOfferPreview,
  createOfferPricing,
  createOfferProblems,
  createOfferRewards,
  createOfferSchedule,
} from "./offerEditorSections.js";

// ---- Offer editor ----
function allowedKinds(draft) {
  const grants = draft.grants || [];
  const cosmetics = grants.filter((g) => g.kind !== "currency");
  const one = grants.length === 1 && cosmetics.length === 1 ? cosmetics[0] : null;
  const taken = one && offers().some((o) => o.id !== draft.id && o.kind === "item" && o.grants?.length === 1 && o.grants[0].kind === one.kind && o.grants[0].id === one.id);
  return {
    item: !one ? "Needs exactly one cosmetic and nothing else" : taken ? "Another single-item offer already sells this cosmetic" : null,
    bundle: !grants.length ? "Add rewards first" : null,
    "currency-pack": !grants.length || cosmetics.length ? "Coins or gems only" : null,
  };
}

function suggestedKind(draft) {
  const blocked = allowedKinds(draft);
  if (!blocked[draft.kind]) return draft.kind;
  return !blocked.item ? "item" : !blocked["currency-pack"] ? "currency-pack" : "bundle";
}

function editOffer(existing) {
  const isNew = !existing;
  const firstSection = sections().find((s) => !["sales", "dailies"].includes(s.id))?.id || "currency";
  const draft = existing ? clone(existing) : {
    id: "", section: store.filter !== "all" && store.filter !== "sales" ? store.filter : firstSection, kind: "item", name: "", description: "",
    rarity: "common", banner: store.options.banners[0] || "", price: { type: "virtual", currency: "gems", amount: 49 }, purchaseLimit: "lifetime",
    grants: [{ kind: "card", id: unsoldCosmetic("card") }],
  };
  let role = existing ? saleRole(existing.id) : "none";



  const preview = createOfferPreview(draft, existing, role === "pinned");
  const getSaleRole = () => role;
  const setRole = next => { role = next; };
  const basics = createOfferBasics(draft, {
    isNew,
    drawPreview: preview.draw,
    getSaleRole,
    setRole(next) {
      setRole(next);
      schedule.draw();
    },
  });
  const rewards = createOfferRewards(draft, {
    suggestedKind,
    allowedKinds,
    onKindChange() {
      pricing.draw();
      preview.draw();
    },
    onRewardsChange() {
      pricing.draw();
      pricing.drawEligibility();
      preview.draw();
    },
  });
  const pricing = createOfferPricing(draft, {
    onPriceTypeChange() {
      schedule.draw();
      pricing.drawEligibility();
      preview.draw();
    },
    onPriceAmountChange() {
      schedule.draw();
      preview.draw();
    },
  });
  const schedule = createOfferSchedule(draft, existing, {
    getSaleRole,
    setRole,
    showSalePreview: preview.showSale,
    drawPreview: preview.draw,
  });

  const modal = openModal(isNew ? "New offer" : `Edit ${existing.name}`, {
    wide: true,
    submitLabel: isNew ? "Add offer" : "Apply",
    extraActions: existing ? [
      { label: "Delete", className: "danger", run: async (close) => { if (await deleteOffer(existing)) close(); } },
      { label: "Duplicate", run: (close) => { close(); duplicateOffer(existing); } },
    ] : [],
    onSubmit: () => {
      draft.name = draft.name.trim();
      if (!draft.name) throw new Error("Give the offer a name.");
      if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(draft.id)) throw new Error("The ID needs 2–64 lowercase letters, numbers or dashes.");
      if (isNew && allIds().has(draft.id)) throw new Error("That ID is already used.");
      if (!draft.grants.length) throw new Error("Add at least one reward.");
      if (draft.grants.some((g) => g.kind === "currency" && !(g.amount > 0))) throw new Error("Currency rewards need an amount above zero.");
      if (draft.price.type === "money" ? draft.price.amountCents < 50 : !(draft.price.amount > 0)) throw new Error("Set a price (at least $0.50 for real money).");
      const blocked = allowedKinds(draft)[draft.kind];
      if (blocked) throw new Error(`${KINDS[draft.kind]}: ${blocked}.`);
      if (draft.section === "sales" && role === "none") throw new Error("Offers in the Sales section must be on sale every week or in the rotation.");
      if (!draft.description) delete draft.description;
      if (isNew) offers().push(draft);
      else offers()[offers().indexOf(existing)] = draft;
      if (saleRole(draft.id) !== role) setSaleRole(draft.id, role);
      markChanged();
      showToast(isNew ? `Added ${draft.name}` : `Updated ${draft.name}`);
    },
  });

  const form = node("div", null, "editor-grid");
  const fields = node("div", null, "editor-fields");
  fields.append(
    createOfferProblems(existing),
    basics.element,
    rewards.element,
    pricing.element,
    schedule.element,
    createOfferBanner(draft, preview.draw),
  );
  form.append(fields, preview.element);
  modal.body.append(form);
  rewards.draw();
  pricing.draw();
  schedule.draw();
  pricing.drawEligibility();
  basics.draw();
  preview.draw();
  basics.focus();
}

export { editOffer };


