import test from 'node:test';
import assert from 'node:assert/strict';
import {createCooldown,safeReturnPath,wireCodeInputs} from '../src/lib/emailVerificationUI.js';
import cooldownModule from '../src/server/helpers/emailCooldown.js';
const {emailCooldown}=cooldownModule;

test('only the first email correction waives the minute, never the hourly cap',()=>{
  const now=Date.now(), row={sent_at:new Date(now),window_start:new Date(now),send_count:1,correction_used:0};
  assert.ok(emailCooldown(row,'a@example.com','a@example.com',now).error);
  assert.equal(emailCooldown(row,'b@example.com','a@example.com',now).error,null);
  assert.equal(emailCooldown(row,'b@example.com','a@example.com',now).correctionUsed,true);
  assert.ok(emailCooldown({...row,correction_used:1},'c@example.com','b@example.com',now).error);
  assert.equal(emailCooldown({...row,correction_used:1},'c@example.com','b@example.com',now+60000).error,null);
  assert.match(emailCooldown({...row,send_count:5},'b@example.com','a@example.com',now).error,/hour/);
});
test('return URLs cannot escape the current origin',()=>{
  for(const path of ['//evil.example','/\\evil.example','https://evil.example','javascript:alert(1)']) assert.equal(safeReturnPath(path,'https://game.example'),'/');
  assert.equal(safeReturnPath('/profile?tab=account#email','https://game.example'),'/profile?tab=account#email');
});
test('cooldown uses wall time and replaces its previous deadline',()=>{
  let now=1000;
  const timer=createCooldown(()=>{},()=>now);
  try {timer.set(60);now+=4500;assert.equal(timer.remaining(),56);timer.set(60);now+=60000;assert.equal(timer.remaining(),0);} finally {timer.dispose();}
});
test('OTP supports full paste from any cell, navigation, and submit',()=>{
  let focused=-1,submitted=0;
  const inputs=Array.from({length:6},(_,i)=>({value:'',handlers:{},addEventListener(k,fn){this.handlers[k]=fn;},select(){},focus(){focused=i;}}));
  const code=wireCodeInputs({querySelectorAll:()=>inputs},()=>submitted++);
  let prevented=false;
  inputs[3].handlers.paste({clipboardData:{getData:()=> '123 456'},preventDefault(){prevented=true;}});
  assert.equal(code.value(),'123456');assert.equal(prevented,true);assert.equal(focused,5);
  inputs[2].handlers.keydown({key:'ArrowLeft',preventDefault(){}});assert.equal(focused,1);
  inputs[5].handlers.keydown({key:'Enter',preventDefault(){}});assert.equal(submitted,1);
  code.clear();assert.equal(code.value(),'');
});
