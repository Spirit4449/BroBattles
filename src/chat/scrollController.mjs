export function createChatScrollController(messages, composer, button) {
  let pending = 0;
  let following = true;
  const atBottom = () => messages.scrollHeight - messages.clientHeight - messages.scrollTop <= 24;
  function sync() {
    const below = !atBottom();
    if (!below) pending = 0;
    composer.classList.toggle('has-messages-below', below);
    button.hidden = !below;
    button.textContent = pending ? `↓ ${pending > 99 ? '99+' : pending} new` : '↓';
    button.setAttribute('aria-label', pending ? `${pending} new messages. Jump to latest` : 'Jump to latest messages');
  }
  function capture() {
    const top = messages.getBoundingClientRect().top;
    const row = [...messages.children].find(el => el.dataset.messageId && el.getBoundingClientRect().bottom > top);
    return { bottom: atBottom(), top: messages.scrollTop, id: row?.dataset.messageId, offset: row ? row.getBoundingClientRect().top - top : 0 };
  }
  function restore(snapshot, { added = 0, force = false } = {}) {
    if (force || snapshot.bottom) {
      messages.scrollTop = messages.scrollHeight;
    } else {
      const row = [...messages.children].find(el => el.dataset.messageId === snapshot.id);
      if (row) messages.scrollTop += row.getBoundingClientRect().top - messages.getBoundingClientRect().top - snapshot.offset;
      else messages.scrollTop = snapshot.top;
      pending += added;
    }
    following = atBottom();
    sync();
  }
  function jump() {
    messages.scrollTop = messages.scrollHeight;
    following = true;
    sync();
    messages.dispatchEvent(new Event('scroll'));
  }
  const onScroll = () => { following = atBottom(); sync(); };
  messages.addEventListener('scroll', onScroll);
  button.addEventListener('click', jump);
  const observer = new ResizeObserver(() => {
    if (following) messages.scrollTop = messages.scrollHeight;
    sync();
  });
  observer.observe(messages);
  return {
    capture, restore, atBottom, jump,
    showPending(count) { pending = count; following = atBottom(); sync(); },
    reset() { pending = 0; following = true; sync(); },
    destroy() { observer.disconnect(); messages.removeEventListener('scroll', onScroll); },
  };
}
