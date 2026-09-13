// Keep a native value for FormData while presenting a keyboard-accessible pixel list.
let nextId = 0;
export function pixelSelect(select, label) {
  const wrap = document.createElement('div');
  wrap.className = 'site-select';
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'site-select-trigger';
  trigger.setAttribute('aria-label', label);
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  const list = document.createElement('div');
  list.className = 'site-select-options';
  list.id = `site-select-${++nextId}`;
  list.role = 'listbox';
  list.setAttribute('aria-label', label);
  list.hidden = true;
  trigger.setAttribute('aria-controls', list.id);
  select.hidden = true;
  select.tabIndex = -1;
  select.setAttribute('aria-hidden', 'true');
  const options = [...select.options].map(option => {
    const button = document.createElement('button');
    button.type = 'button';
    button.role = 'option';
    button.textContent = option.textContent;
    button.dataset.value = option.value;
    button.tabIndex = -1;
    button.onclick = event => {
      event.preventDefault();
      select.value = option.value;
      update();
      close();
      trigger.focus({preventScroll:true});
      select.dispatchEvent(new Event('input', {bubbles:true}));
      select.dispatchEvent(new Event('change', {bubbles:true}));
    };
    list.append(button);
    return button;
  });
  function update() {
    trigger.textContent = `${select.selectedOptions[0]?.textContent || label} ▾`;
    options.forEach(button => button.setAttribute('aria-selected', String(button.dataset.value === select.value)));
  }
  function close() { list.hidden = true; trigger.setAttribute('aria-expanded', 'false'); }
  function open() {
    list.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    (options.find(button => button.dataset.value === select.value) || options[0])?.focus();
  }
  trigger.onclick = event => { event.preventDefault(); list.hidden ? open() : close(); };
  wrap.onkeydown = event => {
    if(event.key === 'Escape') { event.preventDefault(); close(); trigger.focus({preventScroll:true}); }
    else if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
      event.preventDefault();
      if(list.hidden) { open(); return; }
      const index = options.indexOf(document.activeElement);
      const target = event.key === 'Home' ? 0 : event.key === 'End' ? options.length-1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
      options[target]?.focus();
    } else if(event.key.length === 1 && !event.ctrlKey && !event.metaKey && event.key !== ' ') {
      const match = options.find(button => button.textContent.toLowerCase().startsWith(event.key.toLowerCase()));
      if(match) { event.preventDefault(); if(list.hidden) open(); match.focus(); }
    }
  };
  wrap.onfocusout = event => { if(!wrap.contains(event.relatedTarget)) close(); };
  select.addEventListener('change', update);
  wrap.append(select, trigger, list);
  update();
  return wrap;
}
