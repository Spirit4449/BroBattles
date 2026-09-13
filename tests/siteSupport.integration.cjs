// Real MySQL behavior, isolated in connection-local temporary tables.
require('dotenv').config({quiet:true});
const mysql=require('mysql2/promise');
const fs=require('node:fs');
const assert=require('node:assert/strict');
const {createSiteSupportService}=require('../src/server/services/siteSupportService');
(async()=>{
  const conn=await mysql.createConnection({host:process.env.DB_HOST||'localhost',port:Number(process.env.DB_PORT)||3306,user:process.env.DB_USER||'root',password:process.env.DB_PASSWORD||'',database:process.env.DB_NAME||'game',multipleStatements:true});
  try {
    const schema=fs.readFileSync(require.resolve('../migrations/2026-09-12_site_support.sql'),'utf8').replaceAll('CREATE TABLE IF NOT EXISTS','CREATE TEMPORARY TABLE').replace(/,\s*CONSTRAINT site_message_request[^\n]+/,'');
    await conn.query(schema);
    const q=async(sql,params)=>{const [rows]=await conn.query(sql,params);return rows;};
    const db={runQuery:q,withTransaction:async fn=>{await conn.beginTransaction();try{const value=await fn(conn,q);await conn.commit();return value;}catch(e){await conn.rollback();throw e;}}};
    const service=createSiteSupportService(db);const user={user_id:70001},other={user_id:70002},admin={user_id:70003};
    const body={subject:'Isolated support test',category:'gameplay',message:'This is an isolated temporary test.',submissionKey:'00000000-0000-4000-8000-000000000001'};
    const first=await service.create(user,'support',body);assert.equal((await service.create(user,'support',body)).id,first.id);
    assert.equal((await q('SELECT * FROM site_request_messages')).length,1);
    await assert.rejects(service.detail(other,false,first.id),{status:404});
    await assert.rejects(service.reply(other,false,first.id,body),{status:404});
    const reply={message:'An administrator reply.',submissionKey:'00000000-0000-4000-8000-000000000002'};
    await service.reply(admin,true,first.id,reply);
    assert.equal((await service.list(user,false,{})).items[0].unread,1);
    assert.equal((await service.detail(user,false,first.id)).messages.length,2);
    assert.equal((await service.list(user,false,{})).items[0].unread,0);
    await service.setStatus(first.id,'closed');
    await service.reply(admin,true,first.id,reply);
    assert.equal((await q('SELECT status FROM site_requests WHERE id=?',[first.id]))[0].status,'closed');
    await service.reply(user,false,first.id,{...reply,submissionKey:'00000000-0000-4000-8000-000000000003'});
    assert.equal((await q('SELECT status FROM site_requests WHERE id=?',[first.id]))[0].status,'open');
    const feedback=await service.create(user,'feedback',{...body,submissionKey:'00000000-0000-4000-8000-000000000004'});
    await assert.rejects(service.reply(admin,true,feedback.id,reply),{status:404});
    assert.equal((await service.list(admin,true,{kind:'feedback'})).total,1);
    // Temporary tables do not support foreign keys, so verify retention parent selection here.
    await q('CREATE TEMPORARY TABLE users (user_id INT PRIMARY KEY)');await q('INSERT INTO users VALUES (?)',[user.user_id]);
    await q('UPDATE site_requests SET created_at=DATE_SUB(NOW(),INTERVAL 13 MONTH) WHERE id=?',[feedback.id]);
    await service.cleanup();assert.equal((await service.list(admin,true,{kind:'feedback'})).total,0);
    assert.equal((await service.list(user,false,{})).total,1);
    console.log('MySQL integration passed: idempotency, ownership, unread replies, status transitions, and retention. No persistent game data changed.');
  }finally{await conn.end();}
})().catch(error=>{console.error(error);process.exitCode=1;});
