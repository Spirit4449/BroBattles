// The shared pixel arrow (styles in public/styles/ui-system.css). Decorative:
// the control around it carries the accessible name.
export function pixelArrow(direction = "right", size = "") {
  const arrow = document.createElement("span");
  arrow.className = `bb-arrow bb-arrow-${direction}${size ? ` bb-arrow-${size}` : ""}`;
  arrow.setAttribute("aria-hidden", "true");
  return arrow;
}
