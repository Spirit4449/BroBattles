import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { createChatScrollController } from "../src/client/chat/scrollController.mjs";
import { GAME_CHAT_FOCUS_MS, GAME_CHAT_UNFOCUSED_MS, gameChatVisibilityPhase } from "../src/client/chat/gameChatVisibility.mjs";
import { systemLogBody, formatSystemLogTime } from "../src/client/chat/systemLog.mjs";
import { createPartyPresenceTracker, countOnlineMembers } from "../src/client/chat/partyPresence.mjs";

describe("Reading position and new messages", () => {
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
});

describe("Battle chat visibility", () => {
  test('battle chat transitions at the configured focus and visibility boundaries', () => {
    const state = { open: true, suppressed: false, lastActivityAt: 1000 };
    const unfocusedAt = state.lastActivityAt + GAME_CHAT_FOCUS_MS;
    const hiddenAt = unfocusedAt + GAME_CHAT_UNFOCUSED_MS;
    assert.equal(gameChatVisibilityPhase({ ...state, now: unfocusedAt - 1 }), 'active');
    assert.equal(gameChatVisibilityPhase({ ...state, now: unfocusedAt }), 'unfocused');
    assert.equal(gameChatVisibilityPhase({ ...state, now: hiddenAt - 1 }), 'unfocused');
    assert.equal(gameChatVisibilityPhase({ ...state, now: hiddenAt }), 'hidden');
  });

  test("opening or interacting restarts the visibility window", () => {
    assert.equal(
      gameChatVisibilityPhase({
        open: true,
        suppressed: false,
        lastActivityAt: 5900,
        now: 6000,
      }),
      "active",
    );
    assert.equal(
      gameChatVisibilityPhase({
        open: false,
        suppressed: false,
        lastActivityAt: 5900,
        now: 6000,
      }),
      "hidden",
    );
    assert.equal(
      gameChatVisibilityPhase({
        open: true,
        suppressed: true,
        lastActivityAt: 5900,
        now: 6000,
      }),
      "hidden",
    );
  });
});

describe("System messages", () => {
  test('battle result follows the viewer rather than a party-wide team label', () => {
   const event={kind:'battle',winnerTeam:'team1',participants:[{name:'Alice',team:'team1'},{name:'Bob',team:'team2'}]};
   assert.equal(systemLogBody(event,'alice'),'Battle ended. You won');
   assert.equal(systemLogBody(event,'Bob'),'Battle ended. You lost');
   assert.equal(systemLogBody(event,'Spectator'),'Battle ended');
   assert.equal(systemLogBody({...event,winnerTeam:null},'Alice'),'Battle ended. Draw');
  });

});

describe("Party presence", () => {
  test('offline update immediately reduces the count without waiting for shared lobby state', () => {
    const initial = {partyId:7, members:[{name:'Alice',status:'online'},{name:'Bob',status:'ready'}]};
    const presence = createPartyPresenceTracker(initial);
    assert.equal(countOnlineMembers(presence.get().members), 2);
    presence.status({partyId:7,name:' BOB ',status:'offline'});
    assert.equal(countOnlineMembers(presence.get().members), 1);
    assert.equal(initial.members[1].status, 'ready');
    presence.status({partyId:7,name:'Bob',status:'offline'});
    assert.equal(countOnlineMembers(presence.get().members), 1);
    presence.status({partyId:7,name:'Bob',status:'online'});
    assert.equal(countOnlineMembers(presence.get().members), 2);
  });
  test('rosters handle joins and leaves and stale party updates are ignored', () => {
    const presence = createPartyPresenceTracker({partyId:7,members:[{name:'Alice',status:'online'}]});
    presence.roster({partyId:7,members:[{name:'Alice',status:'online'},{name:'Bob',status:'offline'}]});
    assert.equal(countOnlineMembers(presence.get().members),1);
    presence.join(8);
    assert.equal(presence.roster({partyId:7,members:[{name:'Alice',status:'online'}]}),false);
    assert.equal(presence.status({partyId:7,name:'Alice',status:'online'}),false);
    assert.equal(countOnlineMembers(presence.get().members),0);
    presence.roster({partyId:8,members:[{name:'Carol',status:'In Battle'}]});
    assert.equal(countOnlineMembers(presence.get().members),1);
    presence.roster({partyId:8,members:[]});
    assert.equal(countOnlineMembers(presence.get().members),0);
    presence.join(null);
    assert.equal(presence.get().partyId,0);
  });
  test('unknown statuses, bots, empty members and duplicate names cannot inflate the count', () => {
    assert.equal(countOnlineMembers([{name:'A',status:'online'},{name:'a',status:'offline'},{name:'B'},{name:'C',status:'unknown'},{name:'Bot',status:'online',isBot:true},{status:'online'},{name:'D',status:'Selecting Character'}]),1);
  });
});
