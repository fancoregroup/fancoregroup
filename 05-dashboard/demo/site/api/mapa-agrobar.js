'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const dataset = process.env.FANCORE_GEO_DATA_PATH ? JSON.parse(fs.readFileSync(process.env.FANCORE_GEO_DATA_PATH, 'utf8')) : require('../mapa-agrobar/demo.json');
const COOKIE = 'fancore_agrobar_session';
const TTL = 60 * 60 * 24 * 7;
const hash = value => crypto.createHash('sha256').update(value).digest();
const equal = (a, b) => crypto.timingSafeEqual(hash(a), hash(b));
const sign = (text, key) => crypto.createHmac('sha256', key).update(text).digest('hex');
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Vary', 'Cookie');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  const password = process.env.AGROBAR_MAP_PASSWORD;
  const secret = process.env.AGROBAR_MAP_SECRET;
  if (!password || !secret) return res.status(503).json({error:'Acesso temporariamente indisponível.'});
  const salt = hash(password).toString('hex');
  const key = secret + salt;
  const secure = process.env.NODE_ENV === 'development' ? '' : '; Secure';
  if (req.method === 'DELETE') {
    res.setHeader('Set-Cookie', `${COOKIE}=; Path=/api/mapa-agrobar; HttpOnly; SameSite=Strict; Max-Age=0${secure}`);
    return res.status(200).json({ok:true});
  }
  if (req.method === 'POST') {
    if (req.headers.origin && req.headers.origin !== `https://${req.headers.host}` && !(process.env.NODE_ENV === 'development' && req.headers.origin === `http://${req.headers.host}`)) return res.status(403).json({error:'Origem inválida.'});
    let body = req.body;
    if (typeof body === 'string') { try { body=JSON.parse(body); } catch (_) { body={}; } }
    if (!body || typeof body.password !== 'string' || body.password.length > 200 || !equal(body.password, password)) return res.status(401).json({error:'Código de acesso incorreto.'});
    const expires = String(Math.floor(Date.now()/1000)+TTL);
    const value = `${expires}.${sign(expires,key)}`;
    res.setHeader('Set-Cookie', `${COOKIE}=${value}; Path=/api/mapa-agrobar; HttpOnly; SameSite=Strict; Max-Age=${TTL}${secure}`);
    return res.status(200).json(dataset);
  }
  if (req.method !== 'GET') {res.setHeader('Allow','GET, POST, DELETE');return res.status(405).json({error:'Método não permitido.'});}
  const cookie = String(req.headers.cookie || '').split(';').map(s=>s.trim()).find(s=>s.startsWith(COOKIE+'='));
  const [expires, sig] = (cookie || '').slice(COOKIE.length+1).split('.');
  if (!expires || !sig || !/^\d+$/.test(expires) || Number(expires) <= Date.now()/1000 || !equal(sig,sign(expires,key))) return res.status(401).json({error:'Entre com o código de acesso.'});
  return res.status(200).json(dataset);
};
