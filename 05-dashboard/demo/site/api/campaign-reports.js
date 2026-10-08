'use strict';
const crypto=require('node:crypto'),zlib=require('node:zlib');
const snapshot=process.env.CAMPAIGN_REPORTS_SNAPSHOT_PATH ? JSON.parse(require('node:fs').readFileSync(process.env.CAMPAIGN_REPORTS_SNAPSHOT_PATH,'utf8')) : require('../performance/snapshot.enc.json');
const COOKIE='fancore_campaign_reports',PATH='/api/campaign-reports',TTL=86400*7;
const hash=s=>crypto.createHash('sha256').update(String(s)).digest();
const equal=(a,b)=>crypto.timingSafeEqual(hash(a),hash(b));
const sign=(v,key)=>crypto.createHmac('sha256',key).update(v).digest('hex');
function session(req,password,secret,danielPassword){
 const cookie=String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='));
 const parts=(cookie||'').slice(COOKIE.length+1).split('.'),expires=parts[0];
 if(!/^\d+$/.test(expires||'') || Number(expires)<=Date.now()/1000 || Number(expires)>=Date.now()/1000+TTL+60)return false;
 if(parts.length===3 && parts[1]==='daniel' && danielPassword)return equal(parts[2],sign(expires+'.daniel',secret+hash(danielPassword).toString('hex')));
 return parts.length===2 && !!parts[1] && equal(parts[1],sign(expires,secret+hash(password).toString('hex')));
}
function handler(req,res){
 res.setHeader('Cache-Control','private, no-store');res.setHeader('Vary','Cookie');res.setHeader('X-Robots-Tag','noindex, nofollow');
 const password=process.env.AGROBAR_MAP_PASSWORD,secret=process.env.AGROBAR_MAP_SECRET,dataSecret=process.env.CAMPAIGN_REPORTS_DATA_SECRET,danielPassword=process.env.CAMPAIGN_REPORTS_DANIEL_PASSWORD;
 if(!password||!secret||!dataSecret||dataSecret.length<32||dataSecret.includes('[SENSITIVE]'))return res.status(503).json({error:'Acesso indisponível. Código do painel não configurado no servidor.'});
 const secure=process.env.NODE_ENV==='development'?'':'; Secure';
 if(req.method==='POST'){
  if(req.headers.origin && req.headers.origin!==`${process.env.NODE_ENV==='development'?'http':'https'}://${req.headers.host}`)return res.status(403).json({error:'Origem inválida.'});
  let body=req.body;try{if(typeof body==='string')body=JSON.parse(body)}catch{return res.status(400).json({error:'Requisição inválida.'})}
  const serviceAccess=equal(req.headers.authorization||'','Bearer '+dataSecret);
  const validInput=body && typeof body.password==='string' && body.password.length<=200;
  const danielAccess=!!danielPassword && validInput && equal(body.password,danielPassword);
  if(!serviceAccess && !danielAccess && (!validInput||!equal(body.password,password)))return res.status(401).json({error:'Código de acesso incorreto.'});
  const expiry=String(Math.floor(Date.now()/1000)+TTL);
  const payload=danielAccess?expiry+'.daniel':expiry,credential=danielAccess?danielPassword:password;
  res.setHeader('Set-Cookie',`${COOKIE}=${payload}.${sign(payload,secret+hash(credential).toString('hex'))}; Path=${PATH}; HttpOnly; SameSite=Strict; Max-Age=${TTL}${secure}`);
  return res.status(200).json({ok:true});
 }
 if(req.method==='DELETE'){res.setHeader('Set-Cookie',`${COOKIE}=; Path=${PATH}; HttpOnly; SameSite=Strict; Max-Age=0${secure}`);return res.status(200).json({ok:true})}
 if(req.method!=='GET'){res.setHeader('Allow','GET, POST, DELETE');return res.status(405).json({error:'Método não permitido.'})}
 if(!session(req,password,secret,danielPassword))return res.status(401).json({error:'Entre com o código de acesso do painel Fancore.'});
 const brand=req.query?.brand;
 if(!['estica','agrobar'].includes(brand))return res.status(400).json({error:'Marca inválida.'});
 try{
  const key=hash('campaign-reports-v1:'+dataSecret),dec=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(snapshot.iv,'base64'));dec.setAuthTag(Buffer.from(snapshot.tag,'base64'));
  const compressed=Buffer.concat([dec.update(Buffer.from(snapshot.data,'base64')),dec.final()]);
  const data=JSON.parse(zlib.gunzipSync(compressed).toString());
  return res.status(200).json({schemaVersion:data.schemaVersion,generatedAt:data.generatedAt,timezone:data.timezone,brand,...data.brands[brand]});
 }catch{return res.status(503).json({error:'Não foi possível ler a última coleta. A atualização está pendente.'})}
}
module.exports=handler;module.exports.session=session;
