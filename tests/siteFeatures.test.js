const test = require('node:test');
const assert = require('node:assert/strict');
const { validateSubmission,createSiteSupportService }=require('../src/server/services/siteSupportService');
const { article,frame,registerSitePages }=require('../src/server/services/siteContent');
const { accepted,isSameOrigin }=require('../src/server/routes/modules/siteRoutes');
const { completeSignupFromGuest }=require('../src/server/services/authAccountService');
const config=require('../src/shared/siteConfig.json');
const {createHelpSearchService,helpSearchDocuments,MODEL}=require('../src/server/services/helpSearchService');
const valid={subject:'A useful idea',category:'idea',message:'Please add a new arena.',submissionKey:'12345678-1234-1234-1234-123456789012'};
test('support input rejects malformed, oversized, or unknown values',()=>{
  assert.equal(validateSubmission(valid).body,valid.message);
  for(const fields of [{message:''},{message:'x'.repeat(4001)},{subject:'x'},{category:'admin'},{submissionKey:'<script>alert(1)</script>'}])assert.throws(()=>validateSubmission({...valid,...fields}));
  assert.equal(validateSubmission({...valid,message:'  <script>alert(1)</script>  '}).body,'<script>alert(1)</script>');
});
test('support ownership is checked before reads or writes',async()=>{
  const calls=[];const db={withTransaction:fn=>fn(null,async(sql,params)=>{calls.push({sql,params});return [];})};
  const service=createSiteSupportService(db);
  await assert.rejects(service.detail({user_id:12},false,99),{status:404});
  await assert.rejects(service.reply({user_id:12},false,99,valid),{status:404});
  assert.equal(calls.length,2);for(const call of calls){assert.match(call.sql,/user_id=\?/);assert.deepEqual(call.params,[99,12]);}
});
test('duplicate replies do not reopen a conversation or bump its timestamp',async()=>{
  const calls=[];const db={withTransaction:fn=>fn(null,async(sql)=>{calls.push(sql);if(sql.includes('FROM site_requests'))return [{id:1,kind:'support'}];if(sql.includes('FROM site_request_messages'))return [{id:5}];return {insertId:5,affectedRows:0};})};
  await createSiteSupportService(db).reply({user_id:12},false,1,valid);
  assert.equal(calls.length,2);
});
test('status validation and cleanup preserve open support',async()=>{
  const calls=[];const service=createSiteSupportService({runQuery:async(sql,params)=>{calls.push({sql,params});return {affectedRows:1};}});
  await assert.rejects(service.setStatus(1,'deleted'),{status:400});
  await service.cleanup();assert.match(calls[0].sql,/status='closed'/);assert.deepEqual(calls[0].params,[12,12]);
});
test('legal consent is explicit and tied to both current versions',()=>{
  const body={accepted:true,termsVersion:config.termsVersion,privacyVersion:config.privacyVersion};
  assert.equal(accepted(body),true);for(const other of [{accepted:'true'},{accepted:false},{termsVersion:'old'},{privacyVersion:'old'}])assert.equal(accepted({...body,...other}),false);
});
test('same-origin write policy rejects missing, foreign, and cross-site origins',()=>{
  const old=process.env.PUBLIC_BASE_URL;delete process.env.PUBLIC_BASE_URL;
  try{const request=(origin,site)=>({protocol:'http',get:key=>({'host':'localhost:31339','origin':origin,'sec-fetch-site':site}[key])});assert.equal(isSameOrigin(request('http://localhost:31339','same-origin')),true);assert.equal(isSameOrigin(request(undefined)),false);assert.equal(isSameOrigin(request('https://other.example')),false);assert.equal(isSameOrigin(request('http://localhost:31339','cross-site')),false);}finally{if(old===undefined)delete process.env.PUBLIC_BASE_URL;else process.env.PUBLIC_BASE_URL=old;}
});
test('signup rejects missing consent before touching credentials or account state',async()=>{
  const result=await completeSignupFromGuest({req:{body:{username:'validuser',password:'testpass'},signedCookies:{},cookies:{}},db:{runQuery:()=>{throw new Error('must not write');}}});
  assert.equal(result.statusCode,400);assert.match(result.payload.error,/Terms/);
});
test('Markdown lookup rejects traversal and unknown slugs; all manifest articles render',()=>{
  assert.equal(article('help','../../.env'),null);assert.equal(article('legal','anything'),null);assert.equal(article('help','missing'),null);
  const manifest=require('../content/manifest.json');for(const kind of ['news','help'])for(const item of manifest[kind])assert.ok(article(kind,item.slug).html.length>20);
  assert.match(article('legal','privacy').html,/support@brobattles.dev/);
});
test('help search index includes article contents and Gemini can only return known articles',async()=>{
  const documents=helpSearchDocuments();
  assert.ok(documents.find(item=>item.slug==='matchmaking').content.includes('trophy count'));
  let request;
  const search=createHelpSearchService({apiKey:'test-key',fetchImpl:async(url,options)=>{
    request={url,options};
    return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify({matches:[
      {slug:'matchmaking',reason:'Explains trophy-based matching.'},
      {slug:'not-real',reason:'Ignore this.'},
      {slug:'matchmaking',reason:'Duplicate.'},
    ]})}]}}]})};
  }});
  const result=await search('fair opponents');
  assert.match(request.url,new RegExp(MODEL));
  assert.equal(request.options.headers['x-goog-api-key'],'test-key');
  assert.deepEqual(result,{available:true,matches:[{slug:'matchmaking',reason:'Explains trophy-based matching.'}]});
  const sent=JSON.parse(request.options.body);
  assert.equal(sent.generationConfig.temperature,0);
  assert.ok(sent.contents[0].parts[0].text.includes('fair opponents'));
});
test('help AI search is optional and validates the public query',async()=>{
  const search=createHelpSearchService({apiKey:''});
  assert.deepEqual(await search('matchmaking'),{available:false,matches:[]});
  await assert.rejects(search('x'),{status:400});
  await assert.rejects(search('x'.repeat(161)),{status:400});
});
test('public page routes register without authentication and return HTML without game engines',()=>{
  const routes=new Map();registerSitePages({get:(path,fn)=>routes.set(path,fn)});
  let html='';routes.get('/about')({}, {send:value=>html=value});assert.match(html,/One more match/);assert.doesNotMatch(html,/phaser|socket.io|index.bundle.js/);
  assert.match(frame('<script>','" test','body','/test'),/&lt;script&gt;/);
  let status;routes.get('/news/:slug')({params:{slug:'missing'},path:'/news/missing'},{status:code=>{status=code;return {send(){}};}});assert.equal(status,404);
});
test('browser settings clamp values and preserve defaults with malformed storage',async()=>{
  const {normalizeSettings,DEFAULT_SETTINGS,GRAPHICS_OPTIONS,graphicsRenderScale}=await import('../src/site/preferences.js');
  assert.deepEqual(normalizeSettings(null),{...DEFAULT_SETTINGS});assert.deepEqual(normalizeSettings({sensitivity:100,sfx:-1,music:NaN,streamer:'yes'}),{...DEFAULT_SETTINGS,sensitivity:3,sfx:0});
  assert.deepEqual(GRAPHICS_OPTIONS.map(option=>[option.value,graphicsRenderScale(option.value)]),[
    ['low',0.5],['medium',1],['high',2],['super-high',4],
  ]);
  assert.equal(normalizeSettings({graphics:'super-high'}).graphics,'super-high');
  assert.equal(normalizeSettings({graphics:'unknown'}).graphics,'high');
  assert.equal(graphicsRenderScale(undefined),2);
});

test('same-origin metadata handles alias hosts and TLS proxies without allowing foreign requests', () => {
  const old = process.env.PUBLIC_BASE_URL; process.env.PUBLIC_BASE_URL='https://canonical.example';
  const request=(origin,site)=>({protocol:'http',get:key=>({host:'internal:3002',origin,'sec-fetch-site':site}[key])});
  try {
    assert.equal(isSameOrigin(request('https://alias.example','same-origin')),true);
    assert.equal(isSameOrigin(request('https://canonical.example',undefined)),true);
    assert.equal(isSameOrigin(request('https://evil.example','cross-site')),false);
    assert.equal(isSameOrigin(request('https://evil.example',undefined)),false);
  } finally { if(old===undefined)delete process.env.PUBLIC_BASE_URL;else process.env.PUBLIC_BASE_URL=old; }
});
