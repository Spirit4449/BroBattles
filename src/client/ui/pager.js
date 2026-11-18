import { button, element } from "./dom";
import { pixelArrow } from "./pixelArrow.js";

export function renderPager(host, {
  page, pages, onPage, className = "", labels = ["Previous page", "Next page"],
  text = false, compact = false, arrowSize = "sm",
}) {
  const prev = button(null, className, () => onPage(page - 1));
  const next = button(null, className, () => onPage(page + 1));
  prev.append(pixelArrow("left", arrowSize));
  if (text) { prev.append(" Previous"); next.append("Next "); }
  next.append(pixelArrow("right", arrowSize));
  prev.setAttribute("aria-label", labels[0]);
  next.setAttribute("aria-label", labels[1]);
  prev.disabled = page <= 1;
  next.disabled = page >= pages;
  host.replaceChildren(prev, element("span", compact ? `${page} / ${pages}` : `Page ${page} of ${pages}`), next);
}
