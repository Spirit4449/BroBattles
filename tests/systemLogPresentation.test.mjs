import test from 'node:test';
import assert from 'node:assert/strict';
import { systemLogBody, formatSystemLogTime } from '../src/chat/systemLog.mjs';
test('battle result follows the viewer rather than a party-wide team label', () => {
 const event={kind:'battle',winnerTeam:'team1',participants:[{name:'Alice',team:'team1'},{name:'Bob',team:'team2'}]};
 assert.equal(systemLogBody(event,'alice'),'Battle ended. You won');
 assert.equal(systemLogBody(event,'Bob'),'Battle ended. You lost');
 assert.equal(systemLogBody(event,'Spectator'),'Battle ended');
 assert.equal(systemLogBody({...event,winnerTeam:null},'Alice'),'Battle ended. Draw');
});
test('timestamps omit seconds, with dates only on another local day', () => {
 const now=new Date(2026,8,22,14,0,0);
 const today=new Date(2026,8,22,13,42,57);
 assert.equal(formatSystemLogTime(today,now),today.toLocaleString([],{hour:'numeric',minute:'2-digit'}));
 const yesterday=new Date(2026,8,21,13,42,57);
 assert.equal(formatSystemLogTime(yesterday,now),yesterday.toLocaleString([],{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}));
 assert.equal(formatSystemLogTime('invalid',now),'');
});
