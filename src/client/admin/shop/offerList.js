import { pixelArrow } from "../../ui/pixelArrow.js";
import { node, button, input, select, fmt, currencyIcon, showToast, confirmDialog } from "../common";
import { PREFS_KEY, store, clone, storage, offers, sections, sectionName, allIds, uniqueId, grantLabel, saleInfo, shopCard, priceNode, weeklyStatus, saleRole, setSaleRole, problemsFor, markChanged, refreshProblemMarks } from "./catalogDraft";
import { renderTab } from "./shopShell";
import { editOffer } from "./offerEditor";

// ---- Offers ----
function renderOffers() {
  const wrap = node("div", null, "store-panel");
  const bar = node("div", null, "store-toolbar");
  const chips = node("div", null, "segmented");
  const filters = [["all", "All"], ...sections().filter((s) => s.id !== "dailies").map((s) => [s.id, s.name])];
  for (const [id, label] of filters) {
    const count = id === "all" ? offers().length : offers().filter((o) => o.section === id).length;
    const chip = button(`${label} ${count}`, id === store.filter ? "is-active" : "", () => { store.filter = id; renderTab(); });
    chips.append(chip);
  }
  const search = input("search", store.query, { placeholder: "Search offers…", "aria-label": "Search offers" });
  search.addEventListener("input", () => { store.query = search.value; draw(); });
  const show = select([["all", "Everything"], ["sale", "On sale this week"], ["shown", "In the shop this week"], ["hidden", "Not shown this week"], ["problems", "Has problems"], ["money", "Real money"]], store.show);
  show.setAttribute("aria-label", "Show");
  show.classList.add("compact-select");
  show.addEventListener("change", () => { store.show = show.value; draw(); });
  const layout = node("div", null, "segmented");
  for (const [id, label] of [["cards", "Cards"], ["table", "Table"]]) {
    layout.append(button(label, store.layout === id ? "is-active" : "", () => { store.layout = id; storage.set(PREFS_KEY, { tab: store.tab, layout: id }); renderTab(); }));
  }
  bar.append(chips, search, show, node("span", null, "spacer"), layout, button("+ New offer", "primary", () => editOffer(null)));
  const host = node("div");
  wrap.append(bar, host);

  function visible() {
    const query = store.query.trim().toLowerCase();
    return offers().filter((o) => {
      if (store.filter !== "all" && o.section !== store.filter) return false;
      if (query && !`${o.name} ${o.id} ${(o.grants || []).map(grantLabel).join(" ")}`.toLowerCase().includes(query)) return false;
      if (store.show === "problems") return problemsFor("offer", o.id).length > 0;
      if (store.show === "money") return o.price?.type === "money";
      if (store.show === "sale") return weeklyStatus(o) === "sale";
      if (store.show === "shown") return weeklyStatus(o) !== "hidden";
      if (store.show === "hidden") return weeklyStatus(o) === "hidden";
      return true;
    });
  }

  function draw() {
    const list = visible();
    host.replaceChildren(store.layout === "table" ? offerTable(list) : offerCards(list));
    if (!list.length) host.append(node("p", offers().length ? "No offers match these filters." : "No offers yet. Add the first one.", "muted pad"));
    refreshProblemMarks();
  }
  draw();
  return wrap;
}

const STATUS_FLAG = { sale: ["On sale this week", "is-sale"], shown: ["In the shop this week", "is-shown"], hidden: ["Not shown this week", "is-hidden"] };

function offerCards(list) {
  const grid = node("div", null, "offer-grid");
  for (const offer of list) {
    const holder = node("div", null, "offer-holder");
    holder.dataset.problemOffer = offer.id;
    const status = weeklyStatus(offer);
    const meta = node("div", null, "offer-meta");
    meta.append(node("span", sectionName(offer.section), "tag"), node("span", STATUS_FLAG[status][0], `tag status-flag ${STATUS_FLAG[status][1]}`));
    if (saleRole(offer.id) === "pinned") meta.append(node("span", "Pinned sale", "tag status-flag is-sale"));
    const badge = node("span", "", "tag problem-badge");
    badge.hidden = true;
    meta.append(badge);
    const card = shopCard(offer, { onSale: status === "sale" });
    card.classList.add("is-clickable");
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `Edit ${offer.name}`);
    card.addEventListener("click", () => editOffer(offer));
    card.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); editOffer(offer); } });
    const actions = node("div", null, "offer-actions");
    actions.append(
      button("Edit", "mini", () => editOffer(offer)),
      button("Duplicate", "mini", () => duplicateOffer(offer)),
      button("Delete", "mini danger", () => deleteOffer(offer)),
    );
    holder.append(meta, card, actions);
    grid.append(holder);
  }
  return grid;
}

function offerTable(list) {
  const wrap = node("div", null, "panel table-panel");
  const scroll = node("div", null, "table-wrap");
  const table = node("table", null, "offer-table");
  table.innerHTML = "<thead><tr><th></th><th>Offer</th><th>Section</th><th>Rewards</th><th>Price</th><th>Sale</th><th>This week</th><th>Order</th><th></th></tr></thead><tbody></tbody>";
  for (const offer of list) {
    const tr = node("tr");
    tr.dataset.problemOffer = offer.id;
    const thumb = node("img", null, "order-thumb");
    thumb.src = offer.banner || ""; thumb.alt = "";
    const nameCell = node("td");
    const name = node("div", null, "offer-name-cell");
    nameCell.append(name);
    const open = button(null, "row-link", () => editOffer(offer));
    open.append(node("strong", offer.name));
    name.append(open, node("small", offer.id, "muted mono"));
    const badge = node("span", "", "tag problem-badge");
    badge.hidden = true;
    name.append(badge);

    const section = select(sections().filter((s) => s.id !== "dailies").map((s) => [s.id, s.name]), offer.section);
    section.setAttribute("aria-label", `Section for ${offer.name}`);
    section.addEventListener("change", () => {
      offer.section = section.value;
      if (offer.section === "sales" && saleRole(offer.id) === "none") setSaleRole(offer.id, "pinned");
      markChanged();
    });

    const price = node("td");
    const priceBox = node("div", null, "price-cell");
    price.append(priceBox);
    if (offer.price?.type === "money") priceBox.append(priceNode(offer.price));
    else {
      const amount = input("number", offer.price.amount, { min: "1", step: "1", "aria-label": `Price of ${offer.name}` });
      amount.addEventListener("change", () => { offer.price.amount = Math.max(1, Math.floor(Number(amount.value) || 1)); amount.value = offer.price.amount; markChanged(); });
      priceBox.append(currencyIcon(offer.price.currency, 18), amount);
    }

    const sale = node("td");
    if (offer.price?.type === "virtual") {
      const role = select([["none", "Not on sale"], ["pinned", "Always (pinned)"], ["pool", "Rotation pool"]], saleRole(offer.id));
      role.setAttribute("aria-label", `Sale for ${offer.name}`);
      role.addEventListener("change", () => {
        if (role.value === "none" && offer.section === "sales") { role.value = saleRole(offer.id); showToast("Sales-section offers must stay on sale. Move it to another section first.", true); return; }
        setSaleRole(offer.id, role.value);
        markChanged();
      });
      sale.append(role);
      const info = saleInfo(offer);
      if (saleRole(offer.id) !== "none" && info) sale.append(node("small", info.percent ? `${fmt(info.price.amount)} on sale (−${info.percent}%)` : "No discount", "muted"));
    } else sale.append(node("span", "—", "muted"));

    const status = weeklyStatus(offer);
    const statusCell = node("td");
    statusCell.append(node("span", STATUS_FLAG[status][0], `tag status-flag ${STATUS_FLAG[status][1]}`));

    const order = node("div", null, "order-cell");
    const siblings = offers().filter((o) => o.section === offer.section);
    const position = siblings.indexOf(offer);
    const move = (delta) => {
      const target = siblings[position + delta];
      const all = offers();
      const a = all.indexOf(offer), b = all.indexOf(target);
      [all[a], all[b]] = [all[b], all[a]];
      markChanged();
    };
    const up = arrowButton("up", () => move(-1));
    const down = arrowButton("down", () => move(1));
    up.disabled = position <= 0;
    down.disabled = position >= siblings.length - 1;
    order.append(up, down);

    const actions = node("div", null, "row-actions");
    actions.append(button("Edit", "mini", () => editOffer(offer)), button("Delete", "mini danger", () => deleteOffer(offer)));
    const orderCell = node("td");
    orderCell.append(order);
    const actionsCell = node("td");
    actionsCell.append(actions);
    const cells = [node("td"), nameCell, node("td"), node("td", (offer.grants || []).map(grantLabel).join(", "), "grants-cell"), price, sale, statusCell, orderCell, actionsCell];
    cells[0].append(thumb);
    cells[2].append(section);
    tr.append(...cells);
    table.tBodies[0].append(tr);
  }
  scroll.append(table);
  wrap.append(scroll);
  return wrap;
}

function arrowButton(direction, onClick) {
  const el = button(null, "mini arrow", onClick);
  el.setAttribute("aria-label", `Move ${direction}`);
  el.append(pixelArrow(direction, "sm"));
  return el;
}

function duplicateOffer(offer) {
  const copy = clone(offer);
  copy.id = uniqueId(`${offer.id}-copy`, allIds());
  copy.name = `${offer.name} (copy)`;
  // Only one single-item offer may sell a cosmetic, so the copy becomes a bundle.
  if (copy.kind === "item") copy.kind = "bundle";
  delete copy.eligibility;
  offers().splice(offers().indexOf(offer) + 1, 0, copy);
  if (copy.section === "sales") setSaleRole(copy.id, "pinned");
  markChanged();
  editOffer(copy);
}

async function deleteOffer(offer) {
  if (!await confirmDialog({ title: `Delete ${offer.name}?`, message: "It leaves the shop when you publish. Past orders keep their records.", confirmLabel: "Delete", danger: true })) return false;
  store.draft.offers = offers().filter((o) => o !== offer);
  setSaleRole(offer.id, "none");
  markChanged();
  return true;
}

export { renderOffers, STATUS_FLAG, arrowButton, duplicateOffer, deleteOffer };

