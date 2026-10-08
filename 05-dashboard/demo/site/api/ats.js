'use strict';
// API interna do ATS Fancore. Rota escolhida por ?r=<rota>. Toda rota, exceto login, exige sessão.
const C = require('./_ats/core');
const cv = require('./_ats/cv');
const { q, httpError, str, uuid } = C;

const STAGE_KEYS = C.STAGES.map(s => s[0]);
const SEE_ALL = ['admin', 'recrutador', 'socio'];
const APPROVERS = ['admin', 'socio'];
const MANAGERS = ['admin', 'recrutador'];

// Vagas visíveis ao usuário, como cláusula SQL sobre o alias j.
function jobScope(user, params) {
  if (SEE_ALL.includes(user.role)) return 'true';
  params.push(user.id);
  const p = '$' + params.length;
  return `(j.owner_id = ${p} or exists (select 1 from ats_job_members m where m.job_id = j.id and m.user_id = ${p}))`;
}
async function loadJob(user, id) {
  const params = [uuid(id, 'Vaga')];
  const rows = await q(`select j.* from ats_jobs j where j.id = $1 and ${jobScope(user, params)}`, params);
  if (!rows[0]) throw httpError(404, 'Vaga não encontrada ou sem acesso.');
  return rows[0];
}
async function loadApplication(user, id) {
  const rows = await q('select a.*, j.title as job_title, j.owner_id from ats_applications a join ats_jobs j on j.id = a.job_id where a.id = $1', [uuid(id, 'Candidatura')]);
  if (!rows[0]) throw httpError(404, 'Candidatura não encontrada.');
  await loadJob(user, rows[0].job_id);
  return rows[0];
}
async function assertCandidateAccess(user, candidateId) {
  uuid(candidateId, 'Candidato');
  if (SEE_ALL.includes(user.role)) return;
  const params = [candidateId];
  const rows = await q(`select 1 from ats_applications a join ats_jobs j on j.id = a.job_id where a.candidate_id = $1 and ${jobScope(user, params)} limit 1`, params);
  if (!rows[0]) throw httpError(404, 'Candidato não encontrado ou sem acesso.');
}
function need(user, roles, msg = 'Seu perfil não tem permissão para esta ação.') {
  if (!roles.includes(user.role)) throw httpError(403, msg);
}

const DEFAULT_CRITERIA = [
  { name: 'Domínio técnico da função', kind: 'Conhecimento' },
  { name: 'Qualidade do portfólio ou entregas', kind: 'Habilidade' },
  { name: 'Velocidade e organização', kind: 'Habilidade' },
  { name: 'Comunicação', kind: 'Habilidade' },
  { name: 'Ambição e dono do resultado', kind: 'Atitude' },
  { name: 'Alinhamento à cultura Fancore', kind: 'Atitude' }
];

function cleanList(list, maxItems, maxLen) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, maxItems).map(x => str(x, maxLen)).filter(Boolean);
}
function cleanCriteria(list) {
  if (!Array.isArray(list) || !list.length) return DEFAULT_CRITERIA;
  return list.slice(0, 12).map(c => ({
    name: str(c && c.name, 80),
    kind: ['Conhecimento', 'Habilidade', 'Atitude'].includes(c && c.kind) ? c.kind : 'Habilidade'
  })).filter(c => c.name);
}

const JOB_FIELDS = {
  title: v => { const s = str(v, 120); if (!s) throw httpError(400, 'Informe o título da vaga.'); return s; },
  company: v => { const s = str(v, 40) || 'Fancore'; if (!C.COMPANIES.includes(s)) throw httpError(400, 'Empresa inválida.'); return s; },
  area: v => str(v, 80),
  contract: v => str(v, 20) || 'CLT',
  workplace: v => str(v, 20) || 'Presencial',
  location: v => str(v, 80) || 'Londrina/PR',
  headcount: v => Math.max(1, Math.min(50, parseInt(v, 10) || 1)),
  salary_range: v => str(v, 80),
  summary: v => str(v, 400),
  description: v => str(v, 8000),
  requirements: v => str(v, 6000),
  benefits: v => str(v, 3000),
  questions: v => JSON.stringify(cleanList(v, 6, 300)),
  criteria: v => JSON.stringify(cleanCriteria(v)),
  public: v => v !== false,
  target_date: v => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null),
  owner_id: v => (v ? uuid(v, 'Responsável') : null)
};

async function setMembers(jobId, members) {
  const ids = (Array.isArray(members) ? members : []).filter(C.isUuid).slice(0, 20);
  await q('delete from ats_job_members where job_id = $1', [jobId]);
  if (ids.length) await q('insert into ats_job_members (job_id, user_id) select $1, unnest($2::uuid[]) on conflict do nothing', [jobId, ids]);
}

async function uniqueSlug(title) {
  const base = C.slugify(title);
  for (let i = 0; i < 20; i++) {
    const slug = i ? `${base}-${i + 1}` : base;
    const rows = await q('select 1 from ats_jobs where slug = $1', [slug]);
    if (!rows[0]) return slug;
  }
  return `${base}-${Date.now().toString(36)}`;
}

// Candidato por e-mail (deduplica) ou novo.
async function upsertCandidate(user, b) {
  const email = C.email(b.email);
  const fields = {
    name: str(b.name, 120), email, phone: str(b.phone, 40), city: str(b.city, 80),
    linkedin: C.url(b.linkedin), portfolio: C.url(b.portfolio), instagram: str(b.instagram, 80)
  };
  if (!fields.name) throw httpError(400, 'Informe o nome do candidato.');
  if (email) {
    const found = await q('select id from ats_candidates where lower(email) = $1', [email]);
    if (found[0]) {
      await q(`update ats_candidates set name = $2, phone = coalesce($3, phone), city = coalesce($4, city), linkedin = coalesce($5, linkedin),
        portfolio = coalesce($6, portfolio), instagram = coalesce($7, instagram), updated_at = now() where id = $1`,
      [found[0].id, fields.name, fields.phone, fields.city, fields.linkedin, fields.portfolio, fields.instagram]);
      return found[0].id;
    }
  }
  const rows = await q(`insert into ats_candidates (name, email, phone, city, linkedin, portfolio, instagram, created_by, retention_until)
    values ($1,$2,$3,$4,$5,$6,$7,$8, (now() + interval '${C.RETENTION_MONTHS} months')::date) returning id`,
  [fields.name, fields.email, fields.phone, fields.city, fields.linkedin, fields.portfolio, fields.instagram, user ? user.id : null]);
  return rows[0].id;
}

const routes = {
  // Sessão
  async 'POST login'(req, res) {
    const b = C.body(req);
    const email = C.email(b.email);
    if (!email || typeof b.password !== 'string') throw httpError(400, 'Informe e-mail e senha.');
    await C.rateLimit('login', C.clientIp(req), 20, 15);
    await C.rateLimit('login-email', email, 8, 15);
    const rows = await q('select id, password_hash, active from ats_users where email = $1', [email]);
    const u = rows[0];
    if (!u || !u.active || !C.verifyPassword(b.password, u.password_hash)) throw httpError(401, 'E-mail ou senha incorretos.');
    await C.createSession(res, u.id);
    await q('update ats_users set last_login_at = now() where id = $1', [u.id]);
    return { ok: true };
  },
  async 'POST logout'(req, res) { await C.destroySession(req, res); return { ok: true }; },
  async 'GET me'(req, res, user) { return { user }; },
  async 'POST password'(req, res, user) {
    const b = C.body(req);
    const rows = await q('select password_hash from ats_users where id = $1', [user.id]);
    if (!C.verifyPassword(b.current || '', rows[0].password_hash)) throw httpError(400, 'Senha atual incorreta.');
    if (!C.validPassword(b.next)) throw httpError(400, 'A nova senha precisa de pelo menos 10 caracteres, com letras e números.');
    await q('update ats_users set password_hash = $2, must_change_password = false where id = $1', [user.id, C.hashPassword(b.next)]);
    await q('delete from ats_sessions where user_id = $1', [user.id]);
    await C.createSession(res, user.id);
    return { ok: true };
  },

  async 'GET meta'(req, res, user) {
    const users = await q('select id, name, role, title from ats_users where active order by name');
    return {
      user, users, roles: C.ROLES, stages: C.STAGES, jobStatus: C.JOB_STATUS, sources: C.SOURCES,
      rejectionReasons: C.REJECTION_REASONS, recommendations: C.RECOMMENDATIONS, interviewKinds: C.INTERVIEW_KINDS,
      companies: C.COMPANIES, defaultCriteria: DEFAULT_CRITERIA,
      can: {
        manageUsers: user.role === 'admin', approve: APPROVERS.includes(user.role), seeAll: SEE_ALL.includes(user.role),
        createJob: ['admin', 'recrutador', 'gestor'].includes(user.role), privacy: user.role === 'admin'
      }
    };
  },

  async 'GET dashboard'(req, res, user) {
    const p = [];
    const scope = jobScope(user, p);
    const [jobs, stages, upcoming, stale, approvals, myEvals, sources] = await Promise.all([
      q(`select j.status, count(*)::int as n from ats_jobs j where ${scope} group by j.status`, p),
      q(`select a.stage, count(*)::int as n from ats_applications a join ats_jobs j on j.id = a.job_id where a.status = 'ativo' and ${scope} group by a.stage`, p),
      q(`select i.id, i.scheduled_at, i.kind, i.duration_min, i.location, c.name as candidate, c.id as candidate_id, j.title as job, a.id as application_id
           from ats_interviews i join ats_applications a on a.id = i.application_id join ats_candidates c on c.id = a.candidate_id join ats_jobs j on j.id = a.job_id
          where i.status = 'agendada' and i.scheduled_at > now() - interval '2 hours' and i.scheduled_at < now() + interval '7 days' and ${scope}
          order by i.scheduled_at limit 12`, p),
      q(`select a.id, a.stage, a.stage_changed_at, c.name as candidate, c.id as candidate_id, j.title as job, j.id as job_id
           from ats_applications a join ats_candidates c on c.id = a.candidate_id join ats_jobs j on j.id = a.job_id
          where a.status = 'ativo' and a.stage not in ('contratado') and a.stage_changed_at < now() - interval '3 days' and j.status = 'aberta' and ${scope}
          order by a.stage_changed_at limit 12`, p),
      q(`(select 'vaga' as kind, j.id, j.title as label, null::text as candidate, null::uuid as candidate_id, j.updated_at as since from ats_jobs j where j.status = 'aguardando_aprovacao' and ${scope})
         union all
         (select 'contratacao', a.id, j.title, c.name, c.id, a.stage_changed_at from ats_applications a join ats_jobs j on j.id = a.job_id join ats_candidates c on c.id = a.candidate_id
           where a.status = 'ativo' and a.stage = 'aprovacao' and ${scope})
         order by since limit 20`, p),
      q(`select i.id, i.scheduled_at, i.kind, c.name as candidate, c.id as candidate_id, j.title as job, a.id as application_id
           from ats_interviews i join ats_applications a on a.id = i.application_id join ats_candidates c on c.id = a.candidate_id join ats_jobs j on j.id = a.job_id
          where i.status = 'realizada' and $1 = any(i.interviewers)
            and not exists (select 1 from ats_evaluations e where e.application_id = a.id and e.user_id = $1)
          order by i.scheduled_at desc limit 10`, [user.id]),
      q(`select a.source, count(*)::int as n from ats_applications a join ats_jobs j on j.id = a.job_id where a.created_at > now() - interval '30 days' and ${scope} group by a.source`, p)
    ]);
    return { jobs, stages, upcoming, stale, approvals, myEvals, sources };
  },

  // Vagas
  async 'GET jobs'(req, res, user) {
    const p = [];
    const rows = await q(`select j.id, j.slug, j.title, j.company, j.area, j.contract, j.workplace, j.location, j.headcount, j.status, j.public,
        j.target_date, j.opened_at, j.created_at, j.owner_id, o.name as owner_name,
        (select count(*)::int from ats_applications a where a.job_id = j.id) as total,
        (select count(*)::int from ats_applications a where a.job_id = j.id and a.status = 'ativo') as active,
        (select count(*)::int from ats_applications a where a.job_id = j.id and a.status = 'contratado') as hired,
        (select count(*)::int from ats_applications a where a.job_id = j.id and a.status = 'ativo' and a.stage = 'triagem') as triage
      from ats_jobs j left join ats_users o on o.id = j.owner_id where ${jobScope(user, p)}
      order by case j.status when 'aberta' then 0 when 'aguardando_aprovacao' then 1 when 'rascunho' then 2 when 'pausada' then 3 else 4 end, j.created_at desc`, p);
    return { jobs: rows };
  },
  async 'GET job'(req, res, user) {
    const job = await loadJob(user, req.query.id);
    const members = await q('select user_id from ats_job_members where job_id = $1', [job.id]);
    return { job: { ...job, members: members.map(m => m.user_id) } };
  },
  async 'POST job'(req, res, user) {
    need(user, ['admin', 'recrutador', 'gestor']);
    const b = C.body(req);
    const v = {};
    for (const [k, fn] of Object.entries(JOB_FIELDS)) v[k] = fn(b[k]);
    if (!v.owner_id) v.owner_id = user.id;
    const status = b.submit ? 'aguardando_aprovacao' : 'rascunho';
    const slug = await uniqueSlug(v.title);
    const rows = await q(`insert into ats_jobs (slug, title, company, area, contract, workplace, location, headcount, salary_range, summary, description,
        requirements, benefits, questions, criteria, public, target_date, owner_id, status, created_by)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) returning id`,
    [slug, v.title, v.company, v.area, v.contract, v.workplace, v.location, v.headcount, v.salary_range, v.summary, v.description,
      v.requirements, v.benefits, v.questions, v.criteria, v.public, v.target_date, v.owner_id, status, user.id]);
    await setMembers(rows[0].id, b.members);
    await C.logEvent({ jobId: rows[0].id, userId: user.id, type: 'vaga_criada', data: { status } });
    return { id: rows[0].id };
  },
  async 'PATCH job'(req, res, user) {
    const b = C.body(req);
    const job = await loadJob(user, b.id);
    if (user.role === 'gestor' && job.owner_id !== user.id) throw httpError(403, 'Só o responsável pela vaga pode editá-la.');
    if (user.role === 'socio') throw httpError(403, 'Sócios aprovam vagas, mas a edição fica com recrutamento ou gestor.');
    const sets = [], params = [job.id];
    for (const [k, fn] of Object.entries(JOB_FIELDS)) {
      if (k in b) { params.push(fn(b[k])); sets.push(`${k} = $${params.length}`); }
    }
    if (sets.length) await q(`update ats_jobs set ${sets.join(', ')}, updated_at = now() where id = $1`, params);
    if ('members' in b) await setMembers(job.id, b.members);
    await C.logEvent({ jobId: job.id, userId: user.id, type: 'vaga_editada', data: { campos: Object.keys(b).filter(k => k in JOB_FIELDS) } });
    return { ok: true };
  },
  async 'POST job-status'(req, res, user) {
    const b = C.body(req);
    const job = await loadJob(user, b.id);
    const to = b.status;
    if (!C.JOB_STATUS[to]) throw httpError(400, 'Status inválido.');
    const allowed = {
      rascunho: ['aguardando_aprovacao', 'cancelada'],
      aguardando_aprovacao: ['aberta', 'rascunho', 'cancelada'],
      aberta: ['pausada', 'fechada', 'cancelada'],
      pausada: ['aberta', 'fechada', 'cancelada'],
      fechada: ['aberta'],
      cancelada: ['rascunho']
    };
    if (!allowed[job.status].includes(to)) throw httpError(400, `Não é possível passar de ${C.JOB_STATUS[job.status]} para ${C.JOB_STATUS[to]}.`);
    const approving = job.status === 'aguardando_aprovacao' && to === 'aberta';
    const reopening = job.status === 'fechada' && to === 'aberta';
    if (approving || reopening) need(user, APPROVERS, 'Abrir uma vaga exige aprovação de um sócio ou da administração.');
    else if (user.role === 'gestor' && job.owner_id !== user.id) throw httpError(403, 'Só o responsável pela vaga pode mudar o status.');
    await q(`update ats_jobs set status = $2, updated_at = now(),
        approved_by = case when $3 then $4::uuid else approved_by end, approved_at = case when $3 then now() else approved_at end,
        opened_at = case when $2 = 'aberta' and opened_at is null then now() else opened_at end,
        closed_at = case when $2 in ('fechada','cancelada') then now() when $2 = 'aberta' then null else closed_at end
      where id = $1`, [job.id, to, approving, user.id]);
    await C.logEvent({ jobId: job.id, userId: user.id, type: 'vaga_status', data: { de: job.status, para: to, comentario: str(b.comment, 500) } });
    return { ok: true };
  },

  // Funil da vaga
  async 'GET pipeline'(req, res, user) {
    const job = await loadJob(user, req.query.id);
    const apps = await q(`select a.id, a.stage, a.status, a.source, a.rejection_reason, a.stage_changed_at, a.created_at,
        c.id as candidate_id, c.name, c.city, c.email, c.tags, c.cv_path is not null as has_cv,
        (select round(avg(e.average), 2) from ats_evaluations e where e.application_id = a.id) as score,
        (select count(*)::int from ats_evaluations e where e.application_id = a.id) as evals,
        (select min(i.scheduled_at) from ats_interviews i where i.application_id = a.id and i.status = 'agendada' and i.scheduled_at > now()) as next_interview
      from ats_applications a join ats_candidates c on c.id = a.candidate_id where a.job_id = $1 order by a.stage_changed_at desc`, [job.id]);
    const owner = job.owner_id ? (await q('select name from ats_users where id = $1', [job.owner_id]))[0] : null;
    return { job: { ...job, owner_name: owner && owner.name }, applications: apps };
  },
  async 'POST application'(req, res, user) {
    need(user, ['admin', 'recrutador', 'gestor']);
    const b = C.body(req);
    const job = await loadJob(user, b.job_id);
    if (['fechada', 'cancelada'].includes(job.status)) throw httpError(400, 'A vaga não está recebendo candidatos.');
    if (b.cv) cv.check(b.cv);
    const candidateId = b.candidate_id ? (await assertCandidateAccess(user, b.candidate_id), b.candidate_id) : await upsertCandidate(user, b);
    const source = C.SOURCES[b.source] ? b.source : 'outro';
    const rows = await q(`insert into ats_applications (job_id, candidate_id, source, referral, message) values ($1,$2,$3,$4,$5)
      on conflict (job_id, candidate_id) do nothing returning id`, [job.id, candidateId, source, str(b.referral, 120), str(b.message, 3000)]);
    if (!rows[0]) throw httpError(409, 'Este candidato já está nesta vaga.');
    if (b.cv) {
      const saved = await cv.store(candidateId, b.cv);
      await q('update ats_candidates set cv_path = $2, cv_name = $3, updated_at = now() where id = $1', [candidateId, saved.path, saved.name]);
    }
    await C.logEvent({ applicationId: rows[0].id, candidateId, jobId: job.id, userId: user.id, type: 'candidatura_criada', data: { origem: source } });
    return { id: rows[0].id, candidate_id: candidateId };
  },
  async 'POST move'(req, res, user) {
    const b = C.body(req);
    const app = await loadApplication(user, b.id);
    const to = b.stage;
    if (!STAGE_KEYS.includes(to)) throw httpError(400, 'Etapa inválida.');
    if (app.status !== 'ativo') throw httpError(400, 'Reative a candidatura antes de mover.');
    if (to === app.stage) return { ok: true };
    const from = STAGE_KEYS.indexOf(app.stage), dest = STAGE_KEYS.indexOf(to);
    if (dest >= STAGE_KEYS.indexOf('proposta') && from < STAGE_KEYS.indexOf('proposta')) need(user, APPROVERS, 'Seguir para proposta exige aprovação de um sócio ou da administração.');
    if (to === 'contratado') need(user, ['admin', 'recrutador', 'socio'], 'Registrar a contratação cabe a recrutamento ou sócios.');
    if (user.role === 'gestor' && app.owner_id !== user.id) throw httpError(403, 'Só o responsável pela vaga move candidatos.');
    const hired = to === 'contratado';
    await q(`update ats_applications set stage = $2, stage_changed_at = now(), updated_at = now(),
        status = case when $3 then 'contratado' else status end, hired_at = case when $3 then now() else hired_at end where id = $1`, [app.id, to, hired]);
    await C.logEvent({ applicationId: app.id, candidateId: app.candidate_id, jobId: app.job_id, userId: user.id, type: 'etapa', data: { de: app.stage, para: to, comentario: str(b.comment, 500) } });
    let filled = false;
    if (hired) {
      const r = await q(`select j.headcount, (select count(*)::int from ats_applications a where a.job_id = j.id and a.status = 'contratado') as hired from ats_jobs j where j.id = $1`, [app.job_id]);
      filled = r[0].hired >= r[0].headcount;
    }
    return { ok: true, filled };
  },
  async 'POST reject'(req, res, user) {
    const b = C.body(req);
    const app = await loadApplication(user, b.id);
    if (user.role === 'gestor' && app.owner_id !== user.id) throw httpError(403, 'Só o responsável pela vaga reprova candidatos.');
    const status = b.status === 'desistiu' ? 'desistiu' : 'reprovado';
    const reason = str(b.reason, 120);
    if (status === 'reprovado' && !C.REJECTION_REASONS.includes(reason)) throw httpError(400, 'Escolha o motivo da reprovação.');
    await q(`update ats_applications set status = $2, rejection_reason = $3, updated_at = now() where id = $1`, [app.id, status, reason]);
    await C.logEvent({ applicationId: app.id, candidateId: app.candidate_id, jobId: app.job_id, userId: user.id, type: status, data: { motivo: reason, etapa: app.stage, comentario: str(b.comment, 1000) } });
    return { ok: true };
  },
  async 'POST reactivate'(req, res, user) {
    const b = C.body(req);
    const app = await loadApplication(user, b.id);
    if (app.status === 'contratado') throw httpError(400, 'Candidatura já contratada.');
    await q(`update ats_applications set status = 'ativo', rejection_reason = null, stage_changed_at = now(), updated_at = now() where id = $1`, [app.id]);
    await C.logEvent({ applicationId: app.id, candidateId: app.candidate_id, jobId: app.job_id, userId: user.id, type: 'reativado', data: {} });
    return { ok: true };
  },

  // Candidatos
  async 'GET candidates'(req, res, user) {
    const params = [];
    const where = [];
    // Alguns ambientes entregam o espaço da query string como "+".
    const term = str(String(req.query.q || '').replace(/\+/g, ' '), 80);
    if (term) { params.push('%' + term.toLowerCase() + '%'); where.push(`(lower(c.name) like $${params.length} or lower(coalesce(c.email,'')) like $${params.length} or lower(coalesce(c.city,'')) like $${params.length} or exists (select 1 from unnest(c.tags) t where lower(t) like $${params.length}))`); }
    if (!SEE_ALL.includes(user.role)) {
      const scope = jobScope(user, params);
      where.push(`exists (select 1 from ats_applications a join ats_jobs j on j.id = a.job_id where a.candidate_id = c.id and ${scope})`);
    }
    where.push('c.anonymized_at is null');
    const rows = await q(`select c.id, c.name, c.email, c.city, c.tags, c.created_at, c.retention_until, c.cv_path is not null as has_cv,
        (select json_agg(json_build_object('job', j.title, 'stage', a.stage, 'status', a.status) order by a.created_at desc)
           from ats_applications a join ats_jobs j on j.id = a.job_id where a.candidate_id = c.id) as applications,
        (select round(avg(e.average), 2) from ats_evaluations e join ats_applications a on a.id = e.application_id where a.candidate_id = c.id) as score
      from ats_candidates c where ${where.join(' and ')} order by c.updated_at desc limit 300`, params);
    return { candidates: rows };
  },
  async 'GET candidate'(req, res, user) {
    const id = req.query.id;
    await assertCandidateAccess(user, id);
    const [cand] = await q('select * from ats_candidates where id = $1', [id]);
    if (!cand) throw httpError(404, 'Candidato não encontrado.');
    const params = [id];
    const scope = jobScope(user, params);
    const apps = await q(`select a.*, j.title as job_title, j.company, j.criteria, j.questions, j.owner_id
        from ats_applications a join ats_jobs j on j.id = a.job_id where a.candidate_id = $1 and ${scope} order by a.created_at desc`, params);
    const appIds = apps.map(a => a.id);
    const [evals, interviews, events] = await Promise.all([
      q(`select e.*, u.name as user_name from ats_evaluations e join ats_users u on u.id = e.user_id where e.application_id = any($1::uuid[]) order by e.created_at desc`, [appIds]),
      q(`select i.* from ats_interviews i where i.application_id = any($1::uuid[]) order by i.scheduled_at desc`, [appIds]),
      q(`select ev.id, ev.application_id, ev.type, ev.data, ev.created_at, u.name as user_name from ats_events ev left join ats_users u on u.id = ev.user_id
          where ev.candidate_id = $1 and (ev.application_id is null or ev.application_id = any($2::uuid[])) order by ev.created_at desc limit 200`, [id, appIds])
    ]);
    const { cv_path, ...rest } = cand;
    return { candidate: { ...rest, has_cv: !!cv_path }, applications: apps, evaluations: evals, interviews, events };
  },
  async 'PATCH candidate'(req, res, user) {
    const b = C.body(req);
    await assertCandidateAccess(user, b.id);
    need(user, ['admin', 'recrutador', 'gestor']);
    const tags = Array.isArray(b.tags) ? [...new Set(cleanList(b.tags, 15, 30).map(t => t.toLowerCase()))] : null;
    await q(`update ats_candidates set name = coalesce($2, name), email = $3, phone = $4, city = $5, linkedin = $6, portfolio = $7, instagram = $8,
        tags = coalesce($9, tags), updated_at = now() where id = $1`,
    [b.id, str(b.name, 120), C.email(b.email), str(b.phone, 40), str(b.city, 80), C.url(b.linkedin), C.url(b.portfolio), str(b.instagram, 80), tags]);
    await C.logEvent({ candidateId: b.id, userId: user.id, type: 'candidato_editado', data: {} });
    return { ok: true };
  },
  async 'POST note'(req, res, user) {
    const b = C.body(req);
    const text = str(b.text, 3000);
    if (!text) throw httpError(400, 'Escreva a anotação.');
    let applicationId = null, candidateId = b.candidate_id, jobId = null;
    if (b.application_id) {
      const app = await loadApplication(user, b.application_id);
      applicationId = app.id; candidateId = app.candidate_id; jobId = app.job_id;
    } else await assertCandidateAccess(user, candidateId);
    await C.logEvent({ applicationId, candidateId, jobId, userId: user.id, type: 'nota', data: { texto: text } });
    return { ok: true };
  },
  async 'POST cv'(req, res, user) {
    const b = C.body(req);
    await assertCandidateAccess(user, b.candidate_id);
    need(user, ['admin', 'recrutador', 'gestor']);
    const [old] = await q('select cv_path from ats_candidates where id = $1', [b.candidate_id]);
    const saved = await cv.store(b.candidate_id, b.file);
    await q('update ats_candidates set cv_path = $2, cv_name = $3, updated_at = now() where id = $1', [b.candidate_id, saved.path, saved.name]);
    if (old && old.cv_path) await cv.remove(old.cv_path).catch(() => {});
    await C.logEvent({ candidateId: b.candidate_id, userId: user.id, type: 'curriculo_enviado', data: { arquivo: saved.name } });
    return { ok: true };
  },
  async 'GET cv'(req, res, user) {
    await assertCandidateAccess(user, req.query.id);
    const [cand] = await q('select cv_path, cv_name, name from ats_candidates where id = $1', [req.query.id]);
    if (!cand || !cand.cv_path) throw httpError(404, 'Este candidato não tem currículo anexado.');
    await C.logEvent({ candidateId: req.query.id, userId: user.id, type: 'curriculo_baixado', data: {} });
    await cv.stream(res, cand.cv_path, cand.cv_name);
    return undefined;
  },

  // Avaliações e entrevistas
  async 'POST evaluation'(req, res, user) {
    const b = C.body(req);
    const app = await loadApplication(user, b.application_id);
    if (!C.RECOMMENDATIONS[b.recommendation]) throw httpError(400, 'Escolha a recomendação.');
    const [job] = await q('select criteria from ats_jobs where id = $1', [app.job_id]);
    const names = (job.criteria || []).map(c => c.name);
    const scores = {};
    for (const n of names) {
      const v = Number(b.scores && b.scores[n]);
      if (Number.isInteger(v) && v >= 0 && v <= 4) scores[n] = v;
    }
    const values = Object.values(scores);
    if (!values.length) throw httpError(400, 'Dê nota a pelo menos um critério.');
    const average = values.reduce((s, v) => s + v, 0) / values.length;
    const stage = STAGE_KEYS.includes(b.stage) ? b.stage : app.stage;
    await q(`insert into ats_evaluations (application_id, user_id, stage, scores, average, recommendation, comment) values ($1,$2,$3,$4,$5,$6,$7)
      on conflict (application_id, user_id, stage) do update set scores = excluded.scores, average = excluded.average, recommendation = excluded.recommendation,
      comment = excluded.comment, created_at = now()`,
    [app.id, user.id, stage, JSON.stringify(scores), average.toFixed(2), b.recommendation, str(b.comment, 3000)]);
    await C.logEvent({ applicationId: app.id, candidateId: app.candidate_id, jobId: app.job_id, userId: user.id, type: 'avaliacao', data: { etapa: stage, media: Number(average.toFixed(2)), recomendacao: b.recommendation } });
    return { ok: true };
  },
  async 'POST interview'(req, res, user) {
    const b = C.body(req);
    const app = await loadApplication(user, b.application_id);
    need(user, ['admin', 'recrutador', 'gestor', 'socio']);
    if (!C.INTERVIEW_KINDS[b.kind]) throw httpError(400, 'Tipo de entrevista inválido.');
    const when = new Date(b.scheduled_at);
    if (Number.isNaN(when.getTime())) throw httpError(400, 'Data e hora inválidas.');
    const interviewers = (Array.isArray(b.interviewers) ? b.interviewers : []).filter(C.isUuid).slice(0, 8);
    const rows = await q(`insert into ats_interviews (application_id, kind, scheduled_at, duration_min, location, interviewers, created_by)
      values ($1,$2,$3,$4,$5,$6::uuid[],$7) returning id`,
    [app.id, b.kind, when.toISOString(), Math.max(15, Math.min(240, parseInt(b.duration_min, 10) || 45)), str(b.location, 300), interviewers, user.id]);
    await C.logEvent({ applicationId: app.id, candidateId: app.candidate_id, jobId: app.job_id, userId: user.id, type: 'entrevista_agendada', data: { tipo: b.kind, quando: when.toISOString() } });
    return { id: rows[0].id };
  },
  async 'PATCH interview'(req, res, user) {
    const b = C.body(req);
    const [iv] = await q('select * from ats_interviews where id = $1', [uuid(b.id, 'Entrevista')]);
    if (!iv) throw httpError(404, 'Entrevista não encontrada.');
    const app = await loadApplication(user, iv.application_id);
    const status = ['agendada', 'realizada', 'cancelada', 'nao_compareceu'].includes(b.status) ? b.status : iv.status;
    await q('update ats_interviews set status = $2, notes = coalesce($3, notes) where id = $1', [iv.id, status, str(b.notes, 3000)]);
    if (status !== iv.status) await C.logEvent({ applicationId: app.id, candidateId: app.candidate_id, jobId: app.job_id, userId: user.id, type: 'entrevista_status', data: { tipo: iv.kind, status } });
    return { ok: true };
  },
  async 'GET interviews'(req, res, user) {
    const p = [];
    const scope = jobScope(user, p);
    const rows = await q(`select i.*, c.name as candidate, c.id as candidate_id, j.title as job, j.company
        from ats_interviews i join ats_applications a on a.id = i.application_id join ats_candidates c on c.id = a.candidate_id join ats_jobs j on j.id = a.job_id
       where i.scheduled_at > now() - interval '30 days' and ${scope} order by i.scheduled_at limit 300`, p);
    return { interviews: rows };
  },

  // Indicadores
  async 'GET reports'(req, res, user) {
    const days = [30, 90, 180, 365].includes(Number(req.query.days)) ? Number(req.query.days) : 90;
    const p = [String(days)];
    const scope = jobScope(user, p);
    const pj = [];
    const scopeJobs = jobScope(user, pj);
    const base = `from ats_applications a join ats_jobs j on j.id = a.job_id where a.created_at > now() - ($1 || ' days')::interval and ${scope}`;
    const [funnel, sources, reasons, hire, byJob, sourceHires] = await Promise.all([
      q(`select a.stage, a.status, count(*)::int as n ${base} group by a.stage, a.status`, p),
      q(`select a.source, count(*)::int as n ${base} group by a.source order by n desc`, p),
      q(`select a.rejection_reason as reason, count(*)::int as n ${base} and a.status = 'reprovado' group by a.rejection_reason order by n desc`, p),
      q(`select count(*)::int as hires, round(avg(extract(epoch from (a.hired_at - a.created_at)) / 86400)::numeric, 1) as days_to_hire,
          round(avg(extract(epoch from (a.hired_at - j.opened_at)) / 86400)::numeric, 1) as days_to_fill
         from ats_applications a join ats_jobs j on j.id = a.job_id where a.status = 'contratado' and a.hired_at > now() - ($1 || ' days')::interval and ${scope}`, p),
      q(`select j.id, j.title, j.company, j.status, j.opened_at, j.headcount,
          count(a.id)::int as total, count(a.id) filter (where a.status = 'contratado')::int as hired,
          count(a.id) filter (where a.status = 'ativo')::int as active
         from ats_jobs j left join ats_applications a on a.job_id = j.id where j.status in ('aberta','pausada') and ${scopeJobs}
         group by j.id order by j.opened_at nulls last`, pj),
      q(`select a.source, count(*)::int as n ${base} and a.status = 'contratado' group by a.source`, p)
    ]);
    return { days, funnel, sources, reasons, hire: hire[0], byJob, sourceHires };
  },

  // Usuários
  async 'GET users'(req, res, user) {
    need(user, ['admin']);
    return { users: await q('select id, name, email, role, title, active, must_change_password, created_at, last_login_at from ats_users order by active desc, name') };
  },
  async 'POST users'(req, res, user) {
    need(user, ['admin']);
    const b = C.body(req);
    const name = str(b.name, 120), email = C.email(b.email);
    if (!name || !email) throw httpError(400, 'Informe nome e e-mail.');
    if (!C.ROLES[b.role]) throw httpError(400, 'Perfil inválido.');
    const exists = await q('select 1 from ats_users where email = $1', [email]);
    if (exists[0]) throw httpError(409, 'Já existe um usuário com este e-mail.');
    const temp = C.tempPassword();
    const rows = await q('insert into ats_users (name, email, role, title, password_hash) values ($1,$2,$3,$4,$5) returning id', [name, email, b.role, str(b.title, 80), C.hashPassword(temp)]);
    await C.logEvent({ userId: user.id, type: 'usuario_criado', data: { usuario: rows[0].id, perfil: b.role } });
    return { id: rows[0].id, tempPassword: temp };
  },
  async 'PATCH users'(req, res, user) {
    need(user, ['admin']);
    const b = C.body(req);
    uuid(b.id, 'Usuário');
    if (b.id === user.id && (b.active === false || (b.role && b.role !== 'admin'))) throw httpError(400, 'Você não pode remover o próprio acesso de administração.');
    if (b.role && !C.ROLES[b.role]) throw httpError(400, 'Perfil inválido.');
    await q('update ats_users set role = coalesce($2, role), title = coalesce($3, title), active = coalesce($4, active), name = coalesce($5, name) where id = $1',
      [b.id, b.role || null, str(b.title, 80), typeof b.active === 'boolean' ? b.active : null, str(b.name, 120)]);
    if (b.active === false) await q('delete from ats_sessions where user_id = $1', [b.id]);
    let temp = null;
    if (b.resetPassword) {
      temp = C.tempPassword();
      await q('update ats_users set password_hash = $2, must_change_password = true where id = $1', [b.id, C.hashPassword(temp)]);
      await q('delete from ats_sessions where user_id = $1', [b.id]);
    }
    await C.logEvent({ userId: user.id, type: 'usuario_editado', data: { usuario: b.id, senha: !!temp } });
    return { ok: true, tempPassword: temp };
  },

  // LGPD
  async 'POST anonymize'(req, res, user) {
    need(user, ['admin'], 'Somente a administração trata pedidos de privacidade.');
    const b = C.body(req);
    const id = uuid(b.candidate_id, 'Candidato');
    const [cand] = await q('select cv_path from ats_candidates where id = $1', [id]);
    if (!cand) throw httpError(404, 'Candidato não encontrado.');
    if (cand.cv_path) await cv.remove(cand.cv_path).catch(() => {});
    await q(`update ats_candidates set name = 'Candidato anonimizado', email = null, phone = null, city = null, linkedin = null, portfolio = null,
        instagram = null, tags = '{}', cv_path = null, cv_name = null, anonymized_at = now(), updated_at = now() where id = $1`, [id]);
    await q(`update ats_applications set answers = '[]'::jsonb, message = null, referral = null where candidate_id = $1`, [id]);
    await q(`update ats_events set data = '{}'::jsonb where candidate_id = $1 and type = 'nota'`, [id]);
    await C.logEvent({ candidateId: id, userId: user.id, type: 'anonimizado', data: { motivo: str(b.reason, 300) } });
    return { ok: true };
  },
  async 'GET retention'(req, res, user) {
    need(user, ['admin']);
    const rows = await q(`select c.id, c.name, c.email, c.retention_until,
        exists (select 1 from ats_applications a where a.candidate_id = c.id and a.status in ('ativo','contratado')) as in_process
      from ats_candidates c where c.anonymized_at is null and c.retention_until < current_date + 30 order by c.retention_until limit 200`);
    return { candidates: rows };
  }
};

async function handler(req, res) {
  const r = String((req.query && req.query.r) || '');
  const route = routes[`${req.method} ${r}`];
  try {
    if (!route) throw httpError(404, 'Rota inexistente.');
    if (req.method !== 'GET' && !C.sameOrigin(req)) throw httpError(403, 'Origem inválida.');
    let user = null;
    if (r !== 'login') {
      user = await C.currentUser(req);
      if (!user) throw httpError(401, 'Sessão expirada. Entre de novo.');
      if (user.must_change_password && !['me', 'password', 'logout', 'meta'].includes(r)) throw httpError(428, 'Troque a senha provisória para continuar.');
    }
    const out = await route(req, res, user);
    if (out !== undefined) return C.send(res, 200, out);
  } catch (e) {
    if (res.headersSent) { console.error('[ats]', e); return res.end(); }
    return C.fail(res, e);
  }
}

module.exports = handler;
module.exports.config = { api: { bodyParser: { sizeLimit: '4.5mb' } } };
