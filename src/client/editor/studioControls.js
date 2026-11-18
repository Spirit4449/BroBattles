import { element as node } from "../ui/dom";
import { openModalDialog } from "../ui/nativeDialog";
import { $, editor, status } from "./studioState";

function error(e) {
  status(e.message, { error: true });
  const content = node("div");
  content.append(node("div", e.message, { class: "errors" }));
  showDialog("Unable to complete this edit", content, null, "Close");
}

function showDialog(title, content, onApply, label = "Apply") {
  const dialog = $("dialog");
  $("dialog-title").textContent = title;
  $("dialog-content").replaceChildren(content);
  $("dialog-apply").textContent = label;
  $("dialog-cancel").hidden = !onApply;
  $("dialog-apply").onclick = async (ev) => {
    if (!onApply) return;
    ev.preventDefault();
    try {
      await onApply();
      dialog.close();
    } catch (e) {
      let errors = $("dialog-content").querySelector(".errors");
      if (!errors) {
        errors = node("div", "", { class: "errors" });
        $("dialog-content").prepend(errors);
      }
      errors.textContent = e.message;
    }
  };
  if (!dialog.open) openModalDialog(dialog, { backdrop: false });
  editor.keyboard.clear();
}

function advanced(parent, title = "Advanced") {
  const details = node("details", undefined, { class: "section advanced" });
  details.append(node("summary", title));
  parent.append(details);
  return details;
}

function section(title) {
  const e = node("section", undefined, { class: "section" });
  e.append(node("div", title, { class: "section-title" }));
  return e;
}

function field(
  parent,
  label,
  value,
  onChange,
  { type, options, min, max, step, full = false, disabled = false } = {},
) {
  const wrap = node("label", undefined, { class: `field${full ? " full" : ""}` });
  wrap.append(node("span", label));
  let input;
  // A fractional step (parallax, opacity…) keeps decimals; other numbers are whole pixels.
  const fractional = step !== undefined && Number(step) < 1,
    round = (v) => (fractional ? Math.round(v * 1000) / 1000 : Math.round(v));
  if (options) {
    input = node("select");
    for (const option of options) {
      const [val, title] = Array.isArray(option) ? option : [option, option];
      const el = node("option", String(title), { value: val });
      input.append(el);
    }
    input.value = String(value ?? "");
  } else {
    input = node("input", undefined, {
      type: type || (typeof value === "number" ? "number" : "text"),
    });
    input.value = typeof value === "number" ? round(value) : (value ?? "");
    if (input.type === "number") input.step = step || "1";
  }
  if (min !== undefined) input.min = min;
  if (max !== undefined) input.max = max;
  input.disabled = disabled;
  input.addEventListener("change", (event) => {
    const v = input.type === "number" ? round(Number(input.value)) : input.value;
    if (input.type === "number" && (!input.value.trim() || !Number.isFinite(v))) {
      input.value = value;
      return;
    }
    onChange(v, event);
  });
  wrap.append(input);
  parent.append(wrap);
  return input;
}

function check(parent, label, value, onChange) {
  const wrap = node("label", undefined, { class: "check" });
  const input = node("input", undefined, { type: "checkbox" });
  input.checked = !!value;
  input.onchange = () => onChange(input.checked);
  wrap.append(input, node("span", label));
  parent.append(wrap);
}

function button(parent, title, callback, cls = "") {
  const b = node("button", title, { type: "button", class: cls });
  b.onclick = callback;
  parent.append(b);
  return b;
}

export { error, node, showDialog, advanced, section, field, check, button };
