import "../styles/pixelSelect.css";

let nextId = 0;

// Pixel-styled dropdown; native <select> popups can't be themed.
export function createPixelSelect({ options, value, label, onChange, className = "" }) {
  const id = `bb-pixel-select-${++nextId}`;
  const root = document.createElement("div");
  root.className = `bb-pixel-select ${className}`.trim();

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "bb-pixel-select-trigger";
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-controls", id);
  const current = document.createElement("span");
  current.className = "bb-pixel-select-value";
  const arrow = document.createElement("span");
  arrow.className = "bb-pixel-select-arrow";
  arrow.setAttribute("aria-hidden", "true");
  trigger.append(current, arrow);

  const list = document.createElement("ul");
  list.className = "bb-pixel-select-list";
  list.id = id;
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", label);
  list.hidden = true;
  const items = options.map((option) => {
    const item = document.createElement("li");
    item.setAttribute("role", "option");
    item.dataset.value = option.value;
    item.tabIndex = -1;
    item.textContent = option.label;
    list.appendChild(item);
    return item;
  });
  root.append(trigger, list);

  let selected = value;
  function render() {
    const option = options.find((o) => o.value === selected) || options[0];
    current.textContent = option.label;
    trigger.setAttribute("aria-label", `${label}: ${option.label}`);
    for (const item of items) item.setAttribute("aria-selected", String(item.dataset.value === option.value));
  }

  function onOutside(event) {
    if (!root.contains(event.target)) setOpen(false);
  }

  function setOpen(open, { focus = false } = {}) {
    if (open === !list.hidden) return;
    list.hidden = !open;
    root.classList.toggle("is-open", open);
    trigger.setAttribute("aria-expanded", String(open));
    if (open) {
      // Open upward when the list would run off the bottom of the screen.
      root.classList.remove("is-up");
      const below = window.innerHeight - trigger.getBoundingClientRect().bottom;
      root.classList.toggle("is-up", below < list.offsetHeight + 12);
      document.addEventListener("pointerdown", onOutside, true);
      if (focus) (items.find((i) => i.dataset.value === selected) || items[0]).focus();
    } else {
      document.removeEventListener("pointerdown", onOutside, true);
      if (focus) trigger.focus();
    }
  }

  function choose(nextValue) {
    setOpen(false, { focus: true });
    if (nextValue === selected) return;
    selected = nextValue;
    render();
    onChange?.(nextValue);
  }

  trigger.addEventListener("click", () => setOpen(list.hidden, { focus: list.hidden }));
  trigger.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true, { focus: true });
    }
  });
  list.addEventListener("click", (event) => {
    const item = event.target.closest("[role=option]");
    if (item) choose(item.dataset.value);
  });
  list.addEventListener("keydown", (event) => {
    const index = items.indexOf(document.activeElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      items[(index + step + items.length) % items.length].focus();
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (index >= 0) choose(items[index].dataset.value);
    } else if (event.key === "Escape") {
      // Close only the list, not the dialog around it.
      event.preventDefault();
      event.stopPropagation();
      setOpen(false, { focus: true });
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  });

  render();
  return {
    element: root,
    get value() { return selected; },
    setValue(nextValue) { selected = nextValue; render(); },
    setDisabled(disabled) {
      trigger.disabled = !!disabled;
      if (disabled) setOpen(false);
    },
  };
}
