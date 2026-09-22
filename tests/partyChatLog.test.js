const test = require('node:test');
const assert = require('node:assert/strict');
const { appendPartyChatLog, recordPartyRoster, getPartyChatLogs } = require('../src/server/services/partyChatLog');
function fixture() {
  const events = [];
  const io = { to: room => ({emit: (name, data) => events.push({room,name,data})}) };
  return {io,events};
}
test('join and leave logs track membership, not presence or repeated rosters', () => {
  const {io,events} = fixture();
  recordPartyRoster(io, 7, [{name:'Alice',status:'online'}]);
  recordPartyRoster(io, 7, [{name:'Alice',status:'offline'}]);
  assert.equal(events.length, 0);
  recordPartyRoster(io, 7, [{name:'Alice'},{name:'Bob'}]);
  recordPartyRoster(io, 7, [{name:'Bob'}]);
  assert.deepEqual(getPartyChatLogs(io,7).map(e=>e.body), ['Bob joined the party','Alice left the party']);
  assert.ok(events.every(e=>e.name==='party-chat:system'));
  assert.deepEqual(getPartyChatLogs(io,8), []);
});
test('battle results deduplicate and recent logs survive history reads without generating messages', () => {
  const {io,events} = fixture();
  appendPartyChatLog(io,7,{kind:'battle',body:'Battle ended — Team 1 won',key:'battle:12'});
  appendPartyChatLog(io,7,{kind:'battle',body:'Battle ended — Team 1 won',key:'battle:12'});
  appendPartyChatLog(io,7,{kind:'map',body:'Alice changed map to Castle'});
  appendPartyChatLog(io,7,{kind:'mode',body:'Alice changed mode to Duels'});
  assert.equal(getPartyChatLogs(io,7).length,3);
  assert.equal(events.length,3);
  assert.ok(events.every(e=>e.name==='party-chat:system'));
});
test('system log memory is bounded per party', () => {
  const {io} = fixture();
  for(let i=0;i<120;i++) appendPartyChatLog(io,7,{kind:'map',body:`Map ${i}`});
  assert.equal(getPartyChatLogs(io,7).length,100);
  assert.equal(getPartyChatLogs(io,7)[0].body,'Map 20');
});
