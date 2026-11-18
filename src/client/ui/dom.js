export const titleCase = (text) => String(text || "").charAt(0).toUpperCase() + String(text || "").slice(1);

export function element(tag, text, appearance) {
  const el = document.createElement(tag);
  if (text != null) el.textContent = text;
  if (typeof appearance === "string") el.className = appearance;
  else if (appearance) {
    for (const [key, value] of Object.entries(appearance)) el.setAttribute(key, value);
  }
  return el;
}

export function button(text, className, onClick) {
  const el = element("button", text, className);
  el.type = "button";
  if (onClick) el.addEventListener("click", onClick);
  return el;
}

export function field(labelText, control, hint) {
  const label = element("label", null, "field");
  label.append(element("span", labelText), control);
  if (hint) label.append(element("small", hint, "hint"));
  return label;
}

export function input(type, value, attrs = {}) {
  const el = element("input");
  el.type = type;
  if (value != null) el.value = value;
  for (const [key, val] of Object.entries(attrs)) el.setAttribute(key, val);
  return el;
}

export function select(options, value) {
  const el = element("select");
  for (const option of options) {
    const [val, label] = Array.isArray(option) ? option : [option, titleCase(option)];
    const opt = element("option", label);
    opt.value = val;
    el.append(opt);
  }
  if (value != null) el.value = value;
  return el;
}

