export function wireCodeInputs(root, onSubmit) {
  const inputs = [...root.querySelectorAll('input')];
  const fill = (text, start = 0) => {
    const digits = text.replace(/\D/g, '').slice(0, inputs.length - start);
    [...digits].forEach((digit, offset) => { inputs[start + offset].value = digit; });
    inputs[Math.min(start + digits.length, inputs.length - 1)]?.focus();
  };
  inputs.forEach((input, index) => {
    input.addEventListener('focus', () => input.select());
    input.addEventListener('input', () => {
      const value = input.value.replace(/\D/g, '');
      if (value.length > 1) { fill(value, value.length === 6 ? 0 : index); return; }
      input.value = value;
      if (value) inputs[index + 1]?.focus();
    });
    input.addEventListener('paste', event => {
      const text = event.clipboardData.getData('text');
      if (!/\d/.test(text)) return;
      event.preventDefault();
      fill(text, text.replace(/\D/g, '').length === 6 ? 0 : index);
    });
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); onSubmit(); }
      if (event.key === 'Backspace' && !input.value) inputs[index - 1]?.focus();
      if (event.key === 'ArrowLeft') { event.preventDefault(); inputs[index - 1]?.focus(); }
      if (event.key === 'ArrowRight') { event.preventDefault(); inputs[index + 1]?.focus(); }
    });
  });
  return {
    value: () => inputs.map(input => input.value).join(''),
    clear: () => inputs.forEach(input => { input.value = ''; }),
    focus: () => inputs[0]?.focus(),
  };
}

export function createCooldown(update, now = Date.now) {
  let until = 0, timer;
  const remaining = () => Math.max(0, Math.ceil((until - now()) / 1000));
  const refresh = () => { update(remaining()); if (!remaining()) clearInterval(timer); };
  return {
    remaining,
    set(seconds) {
      clearInterval(timer);
      until = now() + Math.max(0, Number(seconds) || 0) * 1000;
      refresh();
      if (remaining()) timer = setInterval(refresh, 250);
    },
    dispose: () => clearInterval(timer),
  };
}

export function safeReturnPath(value, origin) {
  try {
    if (!value?.startsWith('/') || value.includes('\\')) return '/';
    const url = new URL(value, origin);
    return url.origin === origin ? `${url.pathname}${url.search}${url.hash}` : '/';
  } catch (_) { return '/'; }
}
