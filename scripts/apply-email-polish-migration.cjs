require('dotenv').config({quiet:true});
const mysql = require('mysql2/promise');
(async () => {
  const conn = await mysql.createConnection({host:process.env.DB_HOST||'localhost',port:Number(process.env.DB_PORT)||3306,user:process.env.DB_USER||'root',password:process.env.DB_PASSWORD||'',database:process.env.DB_NAME||'game'});
  try {
    for (const table of ['pending_signups','account_emails']) {
      const [rows] = await conn.query('SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',[table,'correction_used']);
      if (!rows.length) await conn.query(`ALTER TABLE ${table} ADD COLUMN correction_used BOOLEAN NOT NULL DEFAULT FALSE`);
    }
    console.log('Email correction cooldown columns verified.');
  } finally { await conn.end(); }
})().catch(error => { console.error(error.code || error.message); process.exitCode=1; });
