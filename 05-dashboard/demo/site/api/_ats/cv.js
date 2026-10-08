'use strict';
// Currículos no Blob privado fancore-ats-curriculos (variável ATS_BLOB_READ_WRITE_TOKEN).
const crypto = require('node:crypto');
const { put, get, del } = require('@vercel/blob');
const { httpError } = require('./core');

const MAX_BYTES = 3 * 1024 * 1024;
const TYPES = {
  pdf: { mime: 'application/pdf', test: b => b.slice(0, 5).toString('latin1') === '%PDF-' },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', test: b => b[0] === 0x50 && b[1] === 0x4b },
  doc: { mime: 'application/msword', test: b => b.slice(0, 4).toString('hex') === 'd0cf11e0' }
};

function token() {
  const t = process.env.ATS_BLOB_READ_WRITE_TOKEN;
  if (!t) throw httpError(503, 'Armazenamento de currículos não configurado no servidor.');
  return t;
}

// Recebe { name, data } com data em base64 e valida tipo pelo conteúdo, não pela extensão.
function decode(file) {
  if (!file || typeof file.data !== 'string' || typeof file.name !== 'string') throw httpError(400, 'Arquivo de currículo inválido.');
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const type = TYPES[ext];
  if (!type) throw httpError(400, 'Envie o currículo em PDF, DOC ou DOCX.');
  const base64 = file.data.includes(',') ? file.data.split(',').pop() : file.data;
  if (base64.length > Math.ceil(MAX_BYTES * 4 / 3) + 8) throw httpError(413, 'O currículo deve ter no máximo 3 MB.');
  const buf = Buffer.from(base64, 'base64');
  if (!buf.length || buf.length > MAX_BYTES) throw httpError(413, 'O currículo deve ter no máximo 3 MB.');
  if (!type.test(buf)) throw httpError(400, 'O arquivo não parece ser um PDF, DOC ou DOCX válido.');
  const safeName = file.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.\- ]+/g, '').slice(-80) || `curriculo.${ext}`;
  return { buf, ext, mime: type.mime, safeName };
}

async function store(candidateId, file) {
  const { buf, ext, mime, safeName } = decode(file);
  const pathname = `curriculos/${candidateId}/${crypto.randomUUID()}.${ext}`;
  await put(pathname, buf, { access: 'private', contentType: mime, token: token(), addRandomSuffix: false });
  return { path: pathname, name: safeName };
}

async function stream(res, pathname, downloadName) {
  const result = await get(pathname, { access: 'private', token: token() });
  if (!result || result.statusCode !== 200) throw httpError(404, 'Currículo não encontrado.');
  res.setHeader('Content-Type', result.blob.contentType || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${String(downloadName || 'curriculo').replace(/"/g, '')}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.status(200);
  const reader = result.stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(Buffer.from(value));
  }
  res.end();
}

async function remove(pathname) {
  if (pathname) await del(pathname, { token: token() });
}

// Valida sem gravar; usar antes de criar candidato ou candidatura.
function check(file) { decode(file); }

module.exports = { check, store, stream, remove, MAX_BYTES };
