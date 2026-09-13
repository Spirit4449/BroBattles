// Only creates the three new site tables; does not rewrite existing game data.
require('dotenv').config({quiet:true});
const mysql=require('mysql2/promise');
const fs=require('node:fs');
const path=require('node:path');
(async()=>{
  const conn=await mysql.createConnection({host:process.env.DB_HOST||'localhost',port:Number(process.env.DB_PORT)||3306,user:process.env.DB_USER||'root',password:process.env.DB_PASSWORD||'',database:process.env.DB_NAME||'game',multipleStatements:true,connectTimeout:5000});
  try {
    await conn.query('SET SESSION lock_wait_timeout=10');
    await conn.query(fs.readFileSync(path.join(__dirname,'../migrations/2026-09-12_site_support.sql'),'utf8'));
    const [rows]=await conn.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('legal_acceptances','site_requests','site_request_messages')");
    if(rows.length!==3)throw new Error('Site migration verification failed');
    console.log('Site migration applied and all three tables verified.');
  } finally {await conn.end();}
})().catch(error=>{console.error('Migration failed:',error.code||error.message);process.exitCode=1;});
