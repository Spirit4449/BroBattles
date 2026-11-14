import { createPixelSelect } from '../ui/pixelSelect.js';

// Both levels use the shared dropdown options, spacing and keyboard navigation.
export function attachNestedDropdown(control, { getOptions, getValue, onSelect }) {
  let activeRow;
  let childControl;
  const panel = document.createElement('div');
  panel.className = 'studio-nested-menu';
  panel.setAttribute('role', 'group');
  panel.hidden = true;
  control.element.append(panel);
  const list = control.element.querySelector('[role=listbox]');
  const rows = [...list.children];
  control.element.classList.add("studio-nested-parent");
  function show(row) {
    activeRow = row;
    const parentValue = row.dataset.value;
    childControl?.close({ focus: false });
    childControl = createPixelSelect({
      options: getOptions(parentValue),
      value: getValue(parentValue),
      label: `${row.textContent} options`,
      className: 'is-compact studio-nested-select',
      onSelect(value) {
        childControl.close({ focus: false });
        control.close();
        onSelect(parentValue, value);
      },
    });
    panel.replaceChildren(childControl.element);
    childControl.open();
    panel.hidden = false;
    const rect = row.getBoundingClientRect();
    const width = panel.offsetWidth;
    panel.style.left = `${Math.max(4, rect.right + width > window.innerWidth - 8 ? rect.left - width : rect.right)}px`;
    panel.style.top = `${Math.max(4, Math.min(rect.top - 7, window.innerHeight - panel.offsetHeight - 8))}px`;
  }
  for (const row of rows) {
    row.setAttribute('aria-keyshortcuts', 'ArrowRight');
    row.addEventListener('pointerenter', () => show(row));
    row.addEventListener('focus', () => show(row));
    row.addEventListener('keydown', event => {
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        show(row);
        panel.querySelector('[role=option]')?.focus();
      }
    });
  }
  panel.addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft' || event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      activeRow?.focus();
      panel.hidden = true;
      childControl?.close({ focus: false });
    } else if (event.key === 'Tab') control.close();
  }, true);
  control.element.addEventListener('pointerleave', () => { panel.hidden = true; childControl?.close({ focus: false }); });
  new MutationObserver(() => {
    if (list.hidden) { panel.hidden = true; childControl?.close({ focus: false }); }
  }).observe(list, { attributes: true, attributeFilter: ['hidden'] });
  return {
    show(value, { focus = false } = {}) {
      const row = rows.find(row => row.dataset.value === value);
      if (!row) return;
      show(row);
      if (focus) panel.querySelector('[role=option]')?.focus();
    },
  };
}
