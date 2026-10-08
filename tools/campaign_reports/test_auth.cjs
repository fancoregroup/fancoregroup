'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const handler=require('../../05-dashboard/demo/site/api/campaign-reports.js');
Object.assign(process.env,{AGROBAR_MAP_PASSWORD:'test-original',AGROBAR_MAP_SECRET:'test-signing-secret',CAMPAIGN_REPORTS_DATA_SECRET:'test-data-secret-that-is-at-least-32-characters',CAMPAIGN_REPORTS_DANIEL_PASSWORD:'test-daniel',NODE_ENV:'production'});
function call(method,body,headers={}){const res={headers:{},setHeader(k,v){this.headers[k]=v},status(s){this.code=s;return this},json(v){this.body=v;return this}};handler({method,body,headers:{host:'example.com',...headers}},res);return res}
function valid(cookie,password='test-original',daniel='test-daniel'){return handler.session({headers:{cookie}},password,'test-signing-secret',daniel)}
test('original and Daniel have separate, revocable sessions',()=>{
 const original=call('POST',{password:'test-original'}),daniel=call('POST',{password:'test-daniel'});
 for(const r of [original,daniel]){assert.equal(r.code,200);assert.ok(valid(r.headers['Set-Cookie']));assert.match(r.headers['Set-Cookie'],/Path=\/api\/campaign-reports; HttpOnly; SameSite=Strict; Max-Age=604800; Secure/);assert.equal(r.headers['Cache-Control'],'private, no-store')}
 const a=original.headers['Set-Cookie'],b=daniel.headers['Set-Cookie'];
 assert.ok(valid(a,'test-original','rotated'));assert.equal(valid(b,'test-original','rotated'),false);assert.equal(valid(b,'test-original',''),false);
 assert.ok(valid(b,'rotated-original'));assert.equal(valid(a,'rotated-original'),false);
 assert.equal(valid(b.replace('.daniel.','.admin.')),false);assert.equal(valid(b.replace(';','.extra;')),false);
});
test('invalid input, forged or expired sessions and foreign origins rejected',()=>{
 for(const input of [{password:'wrong'},{password:4},{password:'a'.repeat(201)},null,'{bad'])assert.ok([400,401].includes(call('POST',input).code));
 assert.equal(call('POST',{password:'test-daniel'},{origin:'https://evil.example'}).code,403);
 for(const expires of [Math.floor(Date.now()/1000)-1,Math.floor(Date.now()/1000)+604900]){
  const payload=expires+'.daniel',key='test-signing-secret'+crypto.createHash('sha256').update('test-daniel').digest('hex');
  const sig=crypto.createHmac('sha256',key).update(payload).digest('hex');assert.equal(valid('fancore_campaign_reports='+payload+'.'+sig),false);
 }
 assert.equal(valid('fancore_campaign_reports=123.daniel.fake'),false);assert.equal(call('GET').code,401);
 assert.match(call('DELETE').headers['Set-Cookie'],/Max-Age=0/);
});
test('technical access preserved and optional Daniel credential can be disabled',()=>{
 assert.equal(call('POST',{}, {authorization:'Bearer '+process.env.CAMPAIGN_REPORTS_DATA_SECRET}).code,200);
 delete process.env.CAMPAIGN_REPORTS_DANIEL_PASSWORD;
 assert.equal(call('POST',{password:'test-daniel'}).code,401);assert.equal(call('POST',{password:'test-original'}).code,200);
 process.env.CAMPAIGN_REPORTS_DANIEL_PASSWORD='test-daniel';
});
