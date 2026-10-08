'use strict';
// Núcleo do ATS Fancore: banco, sessão, senhas, permissões e utilidades HTTP.
// Pastas iniciadas por "_" dentro de api/ não viram funções na Vercel.
const crypto = require('node:crypto');
const { neon } = require('@neondatabase/serverless');

const COOKIE = 'fc_ats';
const SESSION_DAYS = 7;
const ROLES = {
  admin: 'Administração',
  recrutador: 'Recrutamento',
  socio: 'Sócio',
  gestor: 'Gestor da vaga'
};
const STAGES = [
  ['triagem', 'Triagem'],
  ['entrevista_rh', 'Entrevista RH'],
  ['teste', 'Case ou teste'],
  ['entrevista_gestor', 'Entrevista gestor'],
  ['aprovacao', 'Aprovação sócios'],
  ['proposta', 'Proposta'],
  ['contratado', 'Contratado']
];
const JOB_STATUS = {
  rascunho: 'Rascunho',
  aguardando_aprovacao: 'Aguardando aprovação',
  aberta: 'Aberta',
  pausada: 'Pausada',
  fechada: 'Fechada',
  cancelada: 'Cancelada'
};
const SOURCES = {
  carreiras: 'Página de carreiras',
  instagram: 'Instagram',
  indicacao: 'Indicação',
  linkedin: 'LinkedIn',
  banco: 'Banco de talentos',
  outro: 'Outro'
};
const REJECTION_REASONS = [
  'Perfil técnico abaixo do exigido',
  'Fit cultural',
  'Pretensão salarial',
  'Disponibilidade ou localização',
  'Não compareceu',
  'Vaga preenchida por outro candidato',
  'Vaga cancelada',
  'Outro'
];
const RECOMMENDATIONS = { forte_sim: 'Contratar com convicção', sim: 'Contratar', nao: 'Não contratar', forte_nao: 'Não contratar de forma alguma' };
const INTERVIEW_KINDS = { rh: 'RH', tecnica: 'Técnica', gestor: 'Gestor', socios: 'Sócios', cultura: 'Cultura' };
const COMPANIES = ['Fancore', 'Estica', 'Agrobar', "Folks Pub", "Jimmy's", 'Six Labs', 'OneGrid', 'Veldren'];
const CONSENT_VERSION = 'carreiras-v1-2026-10-05';
const RETENTION_MONTHS = 12;

let _sql = null;
function db() {
  if (!_sql) {
    const url = process.env.ATS_DATABASE_URL;
    if (!url) throw httpError(503, 'Banco do recrutamento não configurado no servidor.');
    _sql = neon(url);
  }
  return _sql;
}
// Consulta com parâmetros posicionais ($1, $2...), para SQL montado dinamicamente.
const q = (text, params = []) => db().query(text, params);

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}
function verifyPassword(password, stored) {
  const [alg, salt, key] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !salt || !key) return false;
  const expected = Buffer.from(key, 'base64');
  const got = crypto.scryptSync(String(password), Buffer.from(salt, 'base64'), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(expected, got);
}
function validPassword(p) {
  return typeof p === 'string' && p.length >= 10 && p.length <= 200 && /[a-zA-Z]/.test(p) && /\d/.test(p);
}
// Senha provisória legível, sem caracteres ambíguos.
function tempPassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(14);
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out.slice(0, 4) + '-' + out.slice(4, 8) + '-' + out.slice(8, 12) + '7';
}

function readCookie(req, name) {
  const found = String(req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(name + '='));
  return found ? decodeURIComponent(found.slice(name.length + 1)) : '';
}
function cookieHeader(value, maxAge) {
  const secure = process.env.NODE_ENV === 'development' ? '' : '; Secure';
  return `${COOKIE}=${value}; Path=/api/ats; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

async function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  await q(`insert into ats_sessions (token_hash, user_id, expires_at) values ($1, $2, now() + interval '${SESSION_DAYS} days')`, [sha(token), userId]);
  await q('delete from ats_sessions where expires_at < now()');
  res.setHeader('Set-Cookie', cookieHeader(token, SESSION_DAYS * 86400));
}
async function destroySession(req, res) {
  const token = readCookie(req, COOKIE);
  if (token) await q('delete from ats_sessions where token_hash = $1', [sha(token)]);
  res.setHeader('Set-Cookie', cookieHeader('', 0));
}
async function currentUser(req) {
  const token = readCookie(req, COOKIE);
  if (!token || token.length > 100) return null;
  const rows = await q(
    `select u.id, u.name, u.email, u.role, u.title, u.must_change_password
       from ats_sessions s join ats_users u on u.id = s.user_id
      where s.token_hash = $1 and s.expires_at > now() and u.active`, [sha(token)]);
  return rows[0] || null;
}

// Limite simples por chave e janela, guardado no próprio banco.
async function rateLimit(kind, key, max, minutes) {
  const rows = await q(`select count(*)::int as n from ats_attempts where kind = $1 and key = $2 and created_at > now() - ($3 || ' minutes')::interval`, [kind, key, String(minutes)]);
  if (rows[0].n >= max) throw httpError(429, 'Muitas tentativas. Aguarde alguns minutos e tente de novo.');
  await q('insert into ats_attempts (kind, key) values ($1, $2)', [kind, key]);
  if (Math.random() < 0.05) await q(`delete from ats_attempts where created_at < now() - interval '2 days'`);
}

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'desconhecido').split(',')[0].trim();
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const proto = process.env.NODE_ENV === 'development' ? 'http' : 'https';
  return origin === `${proto}://${req.headers.host}`;
}

function body(req) {
  let b = req.body;
  if (typeof b === 'string') {
    try { b = JSON.parse(b); } catch { throw httpError(400, 'Requisição inválida.'); }
  }
  return b && typeof b === 'object' ? b : {};
}

// Texto limpo e limitado; vazio vira null.
function str(v, max = 500) {
  if (v === undefined || v === null) return null;
  const s = String(v).replace(/\u0000/g, '').trim();
  if (!s) return null;
  if (s.length > max) throw httpError(400, `Campo excede ${max} caracteres.`);
  return s;
}
function email(v) {
  const s = str(v, 200);
  if (!s) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) throw httpError(400, 'E-mail inválido.');
  return s.toLowerCase();
}
function url(v) {
  const s = str(v, 400);
  if (!s) return null;
  const withProto = /^https?:\/\//i.test(s) ? s : 'https://' + s;
  try {
    const u = new URL(withProto);
    if (!/^https?:$/.test(u.protocol)) throw new Error();
    return u.toString();
  } catch { throw httpError(400, 'Link inválido.'); }
}
const isUuid = v => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
function uuid(v, label = 'Identificador') {
  if (!isUuid(v)) throw httpError(400, `${label} inválido.`);
  return v;
}

function slugify(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'vaga';
}

function send(res, status, data) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  return res.status(status).json(data);
}
function fail(res, e) {
  const status = e.status || 500;
  if (status >= 500 && !e.status) console.error('[ats]', e);
  return send(res, status, { error: e.status ? e.message : 'Erro inesperado no servidor. Tente de novo.' });
}

async function logEvent({ applicationId = null, candidateId = null, jobId = null, userId = null, type, data = {} }) {
  await q('insert into ats_events (application_id, candidate_id, job_id, user_id, type, data) values ($1,$2,$3,$4,$5,$6)',
    [applicationId, candidateId, jobId, userId, type, JSON.stringify(data)]);
}

module.exports = {
  COOKIE, ROLES, STAGES, JOB_STATUS, SOURCES, REJECTION_REASONS, RECOMMENDATIONS, INTERVIEW_KINDS, COMPANIES,
  CONSENT_VERSION, RETENTION_MONTHS,
  db, q, httpError, sha, hashPassword, verifyPassword, validPassword, tempPassword,
  createSession, destroySession, currentUser, rateLimit, clientIp, sameOrigin, body,
  str, email, url, uuid, isUuid, slugify, send, fail, logEvent
};
