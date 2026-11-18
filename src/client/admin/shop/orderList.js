import { node, button, formatAdminDate, showToast } from "../common";
import { store, loadStatus, offers, offerById, grantLabel, priceNode } from "./catalogDraft";
import { renderPills, renderTab } from "./shopShell";
import { editOffer } from "./offerEditor";

// ---- Orders & payments ----
function renderPayments() {
  const wrap = node("div", null, "store-panel payments-grid");
  const payment = store.status?.payment || {};
  const stripe = node("article", null, "panel");
  stripe.append(node("div", "Stripe payments", "panel-title"));
  stripe.append(node("p", payment.enabled ? "Stripe is configured. Real-money offers can be bought." : "Stripe is off, so real-money offers show as unavailable.", payment.enabled ? "good-text" : "bad-text"));
  if (payment.listener) stripe.append(node("p", payment.listener.message, payment.listener.state === "listening" ? "good-text" : "hint"));
  stripe.append(button("Refresh status", "", async () => {
    try { await loadStatus(); renderPills(); renderTab(); showToast("Payment status refreshed"); } catch (error) { showToast(error.message, true); }
  }));
  if (payment.missing?.length) {
    stripe.append(node("p", "Add these to the server's environment and restart:", "hint"));
    const list = node("ul", null, "plain-list");
    for (const key of payment.missing) list.append(node("li", key, "mono"));
    stripe.append(list);
  }
  const money = offers().filter((o) => o.price?.type === "money");
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
      const player = node("td");
      if (store.openPlayer) player.append(button(`#${order.user_id}`, "row-link", () => store.openPlayer(order.user_id)));
      else player.textContent = `#${order.user_id}`;
      const status = node("td");
      status.append(node("span", order.status, `tag tag-${order.status}`));
      tr.append(node("td", offerById(order.offer_id)?.name || order.offer_id), player, status, node("td", `$${(Number(order.amount_cents || 0) / 100).toFixed(2)} ${String(order.currency || "usd").toUpperCase()}`), node("td", formatAdminDate(order.created_at, true)), node("td", formatAdminDate(order.fulfilled_at, true)));
      table.tBodies[0].append(tr);
    }
    const scroll = node("div", null, "table-wrap");
    scroll.append(table);
    orders.append(scroll);
  }
  wrap.append(stripe, orders);
  return wrap;
}

export { renderPayments };

