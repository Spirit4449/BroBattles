import test from 'node:test';
import assert from 'node:assert/strict';
import { positionChatPopover } from '../src/chat/popoverPosition.mjs';
test('lower message popover sits directly above the anchor using its real height', () => {
  const p = positionChatPopover({top: 700, bottom: 720, right: 900}, 228, 76, 1000, 760);
  assert.equal(p.top, 618);
  assert.equal(p.top + 76 + 6, 700);
  assert.equal(p.above, true);
});
test('popover opens below when it fits and clamps horizontal position', () => {
  assert.deepEqual(positionChatPopover({top: 40, bottom: 60, right: 100}, 228, 76, 400, 800), {left:8, top:66, above:false});
});
