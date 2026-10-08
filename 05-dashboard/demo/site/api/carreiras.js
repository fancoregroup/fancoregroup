'use strict';
// API pública de carreiras: lista vagas abertas e recebe candidaturas. Não expõe dados de candidatos.
const C = require('./_ats/core');
const cv = require('./_ats/cv');
const { q, httpError, str } = C;

const PUBLIC_FIELDS = `j.slug, j.title, j.company, j.area, j.contract, j.workplace, j.location, j.summary, j.description,
  j.requirements, j.benefits, j.salary_range, j.questions, j.opened_at`;

async function list() {
  const jobs = await q(`select ${PUBLIC_FIELDS} from ats_jobs j where j.status = 'aberta' and j.public order by j.opened_at desc`);
  return { jobs };
}

async function apply(req) {
  const b = C.body(req);
  // Campo isca: robôs preenchem, pessoas não veem.
  if (b.website) return { ok: true };
  await C.rateLimit('carreiras', C.clientIp(req), 6, 60);
  const [job] = await q(`select id, title, questions from ats_jobs where slug = $1 and status = 'aberta' and public`, [str(b.slug, 80)]);
  if (!job) throw httpError(404, 'Esta vaga não está mais aberta.');
  if (b.consent !== true) throw httpError(400, 'Para enviar, é preciso concordar com o uso dos seus dados no processo seletivo.');
  const name = str(b.name, 120), email = C.email(b.email), phone = str(b.phone, 40);
  if (!name || !email || !phone) throw httpError(400, 'Preencha nome, e-mail e WhatsApp.');
  if (!b.cv && !b.portfolio && !b.linkedin) throw httpError(400, 'Envie o currículo ou um link de portfólio ou LinkedIn.');
  if (b.cv) cv.check(b.cv);
  const questions = Array.isArray(job.questions) ? job.questions : [];
  const answers = questions.map((question, i) => ({ question, answer: str(Array.isArray(b.answers) ? b.answers[i] : null, 2000) }));

  const fields = [name, email, phone, str(b.city, 80), C.url(b.linkedin), C.url(b.portfolio), str(b.instagram, 80), C.CONSENT_VERSION];
  const found = await q('select id from ats_candidates where lower(email) = $1', [email]);
  let candidateId;
  if (found[0]) {
    candidateId = found[0].id;
    const dup = await q('select 1 from ats_applications where job_id = $1 and candidate_id = $2', [job.id, candidateId]);
    if (dup[0]) throw httpError(409, 'Recebemos antes uma candidatura sua para esta vaga. Ela continua em análise.');
    await q(`update ats_candidates set name = $2, phone = $3, city = coalesce($4, city), linkedin = coalesce($5, linkedin), portfolio = coalesce($6, portfolio),
        instagram = coalesce($7, instagram), consent_at = now(), consent_version = $8, anonymized_at = null,
        retention_until = (now() + interval '${C.RETENTION_MONTHS} months')::date, updated_at = now() where id = $1`, [candidateId, fields[0], ...fields.slice(2)]);
  } else {
    const rows = await q(`insert into ats_candidates (name, email, phone, city, linkedin, portfolio, instagram, consent_version, consent_at, retention_until)
      values ($1,$2,$3,$4,$5,$6,$7,$8, now(), (now() + interval '${C.RETENTION_MONTHS} months')::date) returning id`, fields);
    candidateId = rows[0].id;
  }
  const source = ['instagram', 'linkedin', 'indicacao'].includes(b.source) ? b.source : 'carreiras';
  const app = await q(`insert into ats_applications (job_id, candidate_id, source, referral, answers, message) values ($1,$2,$3,$4,$5,$6)
    on conflict (job_id, candidate_id) do nothing returning id`,
  [job.id, candidateId, source, str(b.referral, 120), JSON.stringify(answers), str(b.message, 3000)]);
  if (!app[0]) throw httpError(409, 'Recebemos antes uma candidatura sua para esta vaga. Ela continua em análise.');
  if (b.cv) {
    const saved = await cv.store(candidateId, b.cv);
    const [old] = await q('select cv_path from ats_candidates where id = $1', [candidateId]);
    await q('update ats_candidates set cv_path = $2, cv_name = $3 where id = $1', [candidateId, saved.path, saved.name]);
    if (old && old.cv_path) await cv.remove(old.cv_path).catch(() => {});
  }
  await C.logEvent({ applicationId: app[0].id, candidateId, jobId: job.id, type: 'candidatura_recebida', data: { origem: source, consentimento: C.CONSENT_VERSION } });
  return { ok: true };
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'GET') return C.send(res, 200, await list());
    if (req.method === 'POST') {
      if (!C.sameOrigin(req)) throw httpError(403, 'Origem inválida.');
      return C.send(res, 200, await apply(req));
    }
    res.setHeader('Allow', 'GET, POST');
    throw httpError(405, 'Método não permitido.');
  } catch (e) { return C.fail(res, e); }
};
module.exports.config = { api: { bodyParser: { sizeLimit: '4.5mb' } } };
