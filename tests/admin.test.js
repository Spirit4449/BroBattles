const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

describe("Admin routes", () => {
  const { registerAdminRoutes } = require('../src/server/routes/modules/admin');
  function harness(admin = { user_id: 1, name: 'Admin' }) {
    const routes = {}, queries = [];
    registerAdminRoutes({ app: { get: (p, f) => routes[p] = f, post: (p, f) => routes[p] = f }, auth: { requireAdminUser: async () => admin }, db: { runQuery: async (sql, args) => { queries.push({sql,args}); if(sql.includes('COUNT')) return [{total: 23}]; if(sql.startsWith('UPDATE')) return {affectedRows: 1}; return [{user_id: 2,name:'Player',coins:4}]; } } });
    async function call(path, body = {}, params = {}) { const res = { code: 200, status(n) { this.code=n; return this; }, json(data) { this.data=data; return this; } }; await routes[path]({body,params},res); return res; }
    return { call, queries };
  }
  test('admin APIs deny non-admin access without queries', async()=>{const h=harness(null);for(const path of ['/api/admin/user-search','/api/admin/user-update','/api/admin/users/:id']) assert.equal((await h.call(path)).code,403);assert.equal(h.queries.length,0);});
  test('search returns a paginated list and binds user input', async()=>{const h=harness();const r=await h.call('/api/admin/user-search',{query:"x' OR 1=1",page:2});assert.equal(r.data.total,23);assert.ok(Array.isArray(r.data.users));assert.deepEqual(h.queries[1].args,["%x' OR 1=1%",20]);assert.ok(!h.queries[1].sql.includes('password'));});
  test('rejects invalid balances, character, presence, and protected fields',async()=>{for(const changes of [{coins:-1},{gems:1.2},{trophies:2147483648},{char_class:'fake'},{status:'fake'},{password:'abc'},{name:' x'}]){const h=harness();assert.equal((await h.call('/api/admin/user-update',{userId:2,changes})).code,400);assert.equal(h.queries.length,0);}});
  test('updates only supplied valid fields',async()=>{const h=harness();const r=await h.call('/api/admin/user-update',{userId:2,changes:{name:'New name',coins:12}});assert.equal(r.code,200);assert.deepEqual(h.queries[0].args,['New name',12,2]);assert.ok(!h.queries[0].sql.includes('gems ='));});
  test('player detail returns bounded histories without auth secrets',async()=>{const h=harness();const r=await h.call('/api/admin/users/:id',{}, {id:'2'});assert.equal(r.code,200);assert.deepEqual(Object.keys(r.data.history).sort(),['currency','matches','moderation','orders']);assert.ok(h.queries.slice(1).every(q=>q.sql.includes('LIMIT 20')));assert.ok(h.queries.every(q=>!q.sql.includes('password')&&!q.sql.includes('token_hash')));});
  test('character edits preserve other levels and enforce the shared level cap',async()=>{const h=harness();assert.equal((await h.call('/api/admin/user-update',{userId:2,changes:{char_levels:{ninja:7}}})).code,200);assert.ok(h.queries[0].sql.includes('JSON_SET'));assert.deepEqual(h.queries[0].args,['$.ninja',7,2]);for(const levels of [{ninja:11},{fake:1},{ninja:-1},[],null]){const invalid=harness();assert.equal((await invalid.call('/api/admin/user-update',{userId:2,changes:{char_levels:levels}})).code,400);assert.equal(invalid.queries.length,0);}});
});

describe("Maintenance controls", () => {
  const {createRuntimeConfig}=require('../src/server/lib/runtimeConfig');
  const {createMatchmaking}=require('../src/server/core/matchmaking');
  test('maintenance rejects new queues before any database writes',async()=>{const mm=createMatchmaking({io:{},db:{runQuery(){throw Error('Database must not be touched')}},runtimeConfig:{get:()=>({maintenanceMode:true})}});await assert.rejects(mm.queueJoin({userId:1}),/New matches currently disabled for maintenance/);});
  test('runtime controls persist across restarts',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'admin-runtime-'));try{const config=createRuntimeConfig({rootDir:dir});config.update({maintenanceUntil:new Date(Date.now()+60000).toISOString(),announcements:'Back soon'});assert.equal(config.get().maintenanceMode,true);assert.equal(createRuntimeConfig({rootDir:dir}).get().announcements,'Back soon');config.update({maintenanceUntil:null,announcements:''});assert.equal(createRuntimeConfig({rootDir:dir}).get().maintenanceMode,false);}finally{fs.rmSync(dir,{recursive:true,force:true});}});
  test('failed persistence leaves active config unchanged',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'admin-runtime-'));const config=createRuntimeConfig({rootDir:dir});fs.rmSync(dir,{recursive:true});assert.throws(()=>config.update({maintenanceMode:true}));assert.equal(config.get().maintenanceMode,false);});

  test('maintenance expires by time without a config write or restart',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'admin-runtime-'));try{const config=createRuntimeConfig({rootDir:dir});config.update({maintenanceUntil:new Date(Date.now()-1).toISOString(),maintenanceMode:true});assert.equal(config.get().maintenanceMode,false);}finally{fs.rmSync(dir,{recursive:true,force:true});}});

});
