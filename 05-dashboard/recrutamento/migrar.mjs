// Aplica schema.sql no banco do ATS e, opcionalmente, cria o primeiro administrador.
// Uso:
//   node 05-dashboard/recrutamento/migrar.mjs <arquivo.env>
//   node 05-dashboard/recrutamento/migrar.mjs <arquivo.env> --admin "Nome" email@dominio <arquivo-de-saida-da-senha>
// A senha provisória vai só para o arquivo de saída (modo 600), nunca para o terminal.
import { readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, '../demo/site/package.json'));
const { neon } = require('@neondatabase/serverless');
const core = require(path.join(here, '../demo/site/api/_ats/core.js'));

const [envFile, flag, adminName, adminEmail, outFile] = process.argv.slice(2);
if (!envFile) { console.error('Informe o arquivo .env com ATS_DATABASE_URL_UNPOOLED ou ATS_DATABASE_URL.'); process.exit(1); }
const env = Object.fromEntries(readFileSync(envFile, 'utf8').split('\n').filter(l => /^[A-Z_]+=/.test(l))
  .map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')]; }));
const sql = neon(env.ATS_DATABASE_URL_UNPOOLED || env.ATS_DATABASE_URL);

const schema = readFileSync(path.join(here, 'schema.sql'), 'utf8')
  .split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
  .split(';').map(s => s.trim()).filter(Boolean);
for (const stmt of schema) await sql.query(stmt);
const tables = await sql.query(`select table_name from information_schema.tables where table_schema = 'public' and table_name like 'ats_%' order by 1`);
console.log(`Esquema aplicado: ${schema.length} comandos, ${tables.length} tabelas (${tables.map(t => t.table_name).join(', ')}).`);

if (flag === '--admin') {
  if (!adminName || !adminEmail || !outFile) { console.error('Uso: --admin "Nome" email arquivo-de-saida'); process.exit(1); }
  const email = adminEmail.toLowerCase();
  const exists = await sql.query('select id from ats_users where email = $1', [email]);
  if (exists[0]) { console.log(`Usuário ${email} já existe; nada alterado.`); process.exit(0); }
  const temp = core.tempPassword();
  await sql.query(`insert into ats_users (name, email, role, title, password_hash) values ($1, $2, 'admin', 'Administração do ATS', $3)`, [adminName, email, core.hashPassword(temp)]);
  writeFileSync(outFile, `ATS Fancore\nUsuário: ${email}\nSenha provisória: ${temp}\nTroca obrigatória no primeiro acesso.\n`, { mode: 0o600 });
  chmodSync(outFile, 0o600);
  console.log(`Administrador ${email} criado. Senha provisória gravada em ${outFile} (modo 600).`);
}
