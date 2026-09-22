import test from 'node:test';
import assert from 'node:assert/strict';
import { composerHeight } from '../src/chat/composerSize.mjs';
const style = {lineHeight:'20px', paddingTop:'7px', paddingBottom:'7px', borderTopWidth:'2px', borderBottomWidth:'2px', minHeight:'38px'};
test('composer grows with wrapped text, caps at five lines, and shrinks after clearing', () => {
  assert.equal(composerHeight(34, style), 38);
  assert.equal(composerHeight(74, style), 78);
  assert.equal(composerHeight(300, style), 118);
  assert.equal(composerHeight(34, style), 38);
});
