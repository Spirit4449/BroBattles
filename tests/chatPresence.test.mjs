import test from 'node:test';
import assert from 'node:assert/strict';
import { createPartyPresenceTracker, countOnlineMembers } from '../src/chat/partyPresence.mjs';

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
