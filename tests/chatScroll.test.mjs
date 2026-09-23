import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatScrollController } from '../src/chat/scrollController.mjs';

test('older-message reading position survives appends, new counts accumulate, and jump clears them', () => {
  const previous = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  try {
    const events = {};
    let top = 100;
    const messages = {
      scrollHeight: 1000, clientHeight: 300,
      get scrollTop() { return top; },
      set scrollTop(value) { top = Math.max(0, Math.min(value, this.scrollHeight - this.clientHeight)); },
      getBoundingClientRect: () => ({top: 0}),
      addEventListener: (name, fn) => events[name] = fn,
      removeEventListener() {},
      dispatchEvent: e => events[e.type]?.(),
      children: [],
    };
    messages.children = Array.from({length:10}, (_, i) => ({
      dataset: {messageId:String(i)},
      getBoundingClientRect: () => ({top:i*100-top, bottom:(i+1)*100-top}),
    }));
    let click;
    const button = { addEventListener: (_, fn) => click = fn, setAttribute() {} };
    const composer = {classList:{toggle() {}}};
    const scroll = createChatScrollController(messages, composer, button);
    let snapshot = scroll.capture();
    messages.scrollHeight += 100;
    scroll.restore(snapshot, {added:1});
    assert.equal(top, 100);
    assert.equal(button.hidden, false);
    assert.equal(button.textContent, '↓ 1 new');
    snapshot = scroll.capture();
    messages.scrollHeight += 100;
    scroll.restore(snapshot, {added:1});
    assert.equal(top, 100);
    assert.equal(button.textContent, '↓ 2 new');
    // Metadata-only redraws must not count as incoming messages.
    scroll.restore(scroll.capture());
    assert.equal(button.textContent, '↓ 2 new');
    click();
    assert.equal(top, 900);
    assert.equal(button.hidden, true);
    snapshot = scroll.capture();
    messages.scrollHeight += 100;
    scroll.restore(snapshot, {added:1});
    assert.equal(top, 1000);
    assert.equal(button.hidden, true);
    scroll.destroy();
  } finally { globalThis.ResizeObserver = previous; }
});

test('resize deliveries coalesce into the next frame and pending work is cancelled on destroy', () => {
  const previous = {ResizeObserver:globalThis.ResizeObserver,requestAnimationFrame:globalThis.requestAnimationFrame,cancelAnimationFrame:globalThis.cancelAnimationFrame};
  let deliver, scheduled, calls=0, writes=0, cancelled;
  globalThis.ResizeObserver = class { constructor(fn){deliver=fn;} observe(){} disconnect(){} };
  globalThis.requestAnimationFrame = fn => {calls++;scheduled=fn;return calls;};
  globalThis.cancelAnimationFrame = id => {cancelled=id;};
  try {
    const messages={scrollHeight:1000,clientHeight:300,get scrollTop(){return 700;},set scrollTop(value){writes++;},addEventListener(){},removeEventListener(){}};
    const composer={classList:{toggle(){}}};
    const button={addEventListener(){},removeEventListener(){},setAttribute(){}};
    const scroll=createChatScrollController(messages,composer,button);
    deliver();deliver();
    assert.equal(writes,0);assert.equal(calls,1);
    scheduled();assert.equal(writes,1);
    deliver();assert.equal(calls,2);
    scroll.destroy();assert.equal(cancelled,2);
  } finally { Object.assign(globalThis,previous); }
});
