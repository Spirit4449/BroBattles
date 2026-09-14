// Only creates the three new site tables; does not rewrite existing game data.
require('dotenv').config({quiet:true});
const mysql=require('mysql2/promise');
const fs=require('node:fs');
const path=require('node:path');
(async()=>{
  const conn=await mysql.createConnection({host:process.env.DB_HOST||'localhost',port:Number(process.env.DB_PORT)||3306,user:process.env.DB_USER||'root',password:process.env.DB_PASSWORD||'',database:process.env.DB_NAME||'game',multipleStatements:true,connectTimeout:5000});
  try {
    await conn.query('SET SESSION lock_wait_timeout=10');
    await conn.query(fs.readFileSync(path.join(__dirname,'../migrations/2026-09-13_signup_marketing.sql'),'utf8'));
    const [rows]=await conn.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('pending_signups','email_marketing','marketing_jobs','marketing_contact_sync','email_webhook_events')");
    if(rows.length!==5)throw new Error('Site migration verification failed');
    console.log('Signup and marketing migration applied and all five tables verified.');
  } finally {await conn.end();}
})().catch(error=>{console.error('Migration failed:',error.code||error.message);process.exitCode=1;});
