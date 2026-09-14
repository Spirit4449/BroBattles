const {test}=require('node:test');
const assert=require('node:assert/strict');
const {template,hashCode,sendEmail}=require('../src/server/services/emailService');
test('email template escapes user content and includes plain text',()=>{
 const result=template('New feedback','<img src=x onerror=alert(1)>');
 assert.ok(!result.html.includes('<img src=x onerror=alert(1)>'));
 assert.ok(result.html.includes('&lt;img'));
 assert.match(result.html,/<img[^>]+wordmark\.png/);
 assert.ok(result.text.includes('<img'));
 assert.match(template('Verify','Hello','123456').html,/123456/);
});
test('verification digest is bound to account, address and code',()=>{
 process.env.EMAIL_VERIFICATION_SECRET='test-secret';
 assert.equal(hashCode(1,'a@example.com','123456').length,64);
 assert.notEqual(hashCode(1,'a@example.com','123456'),hashCode(2,'a@example.com','123456'));
 assert.notEqual(hashCode(1,'a@example.com','123456'),hashCode(1,'b@example.com','123456'));
});
test('Resend transport supports configured key, idempotency and fails on provider error',async()=>{
 const original=global.fetch;process.env.EMAIL_API_KEY='test-key';
 global.fetch=async(url,options)=>{assert.equal(url,'https://api.resend.com/emails');assert.equal(options.headers['Idempotency-Key'],'request-1');const body=JSON.parse(options.body);assert.deepEqual(body.to,['test@example.com']);return {ok:false,status:429};};
 try{await assert.rejects(sendEmail('test@example.com',template('Title','Body'),'request-1'),/429/);}finally{global.fetch=original;}
});
