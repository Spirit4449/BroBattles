const test = require('node:test');
const assert = require('node:assert/strict');
const { welcomeEmail } = require('../src/server/services/marketingService');

test('welcome marketing email uses the branded email frame and compliance links', () => {
  const previousBaseUrl = process.env.PUBLIC_BASE_URL;
  const previousAddress = process.env.MARKETING_POSTAL_ADDRESS;
  process.env.PUBLIC_BASE_URL = 'https://play.example.com';
  process.env.MARKETING_POSTAL_ADDRESS = '123 Battle Lane';

  try {
    const result = welcomeEmail('player@example.com', 'unsubscribe-token');
    assert.match(result.html, /assets\/logos\/wordmark\.png/);
    assert.match(result.html, /bgcolor="#159dc9"/);
    assert.match(result.html, /padding:5px 7px 9px 5px/);
    assert.match(result.html, />Play now<\/a>/);
    assert.match(result.html, /email\/unsubscribe\/unsubscribe-token/);
    assert.match(result.html, /123 Battle Lane/);
    assert.doesNotMatch(result.html, /PLAYER MESSAGE/);
    assert.equal(result.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  } finally {
    if (previousBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = previousBaseUrl;
    if (previousAddress === undefined) delete process.env.MARKETING_POSTAL_ADDRESS;
    else process.env.MARKETING_POSTAL_ADDRESS = previousAddress;
  }
});

test('Broadcast opt-outs cancel pending welcome mail and update local preferences',async()=>{
  const {readSubscription}=require('../src/server/services/marketingService');
  const originalFetch=global.fetch,previousKey=process.env.RESEND_MARKETING_API_KEY;
  process.env.RESEND_MARKETING_API_KEY='test-key';
  const queries=[];
  const q=async(sql)=>{queries.push(sql);if(sql.startsWith('SELECT email,'))return [{email:'test@example.com',subscribed:1}];if(sql.startsWith('SELECT synced_at'))return [{synced_at:new Date()}];return {};};
  try{
    global.fetch=async()=>({ok:true,json:async()=>({unsubscribed:true})});
    assert.equal(await readSubscription(q,1),false);
    assert.ok(queries.some(sql=>sql.includes('UPDATE marketing_jobs SET cancelled_at')));
    global.fetch=async()=>({ok:false});
    await assert.rejects(readSubscription(q,1),/Unable to check/);
  }finally{global.fetch=originalFetch;if(previousKey===undefined)delete process.env.RESEND_MARKETING_API_KEY;else process.env.RESEND_MARKETING_API_KEY=previousKey;}
});

test('an explicit local subscription change waits to sync before checking provider state',async()=>{
  const {readSubscription}=require('../src/server/services/marketingService');
  const previousKey=process.env.RESEND_MARKETING_API_KEY,originalFetch=global.fetch;
  process.env.RESEND_MARKETING_API_KEY='test-key';
  try{
    global.fetch=async()=>{throw new Error('Must not fetch stale provider preferences');};
    assert.equal(await readSubscription(async sql=>sql.startsWith('SELECT email,')?[{email:'test@example.com',subscribed:1}]:[{synced_at:null}],1),true);
  }finally{global.fetch=originalFetch;if(previousKey===undefined)delete process.env.RESEND_MARKETING_API_KEY;else process.env.RESEND_MARKETING_API_KEY=previousKey;}
});
