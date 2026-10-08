'use strict';
// ATS Fancore · interface interna. Rotas por hash, dados pela API /api/ats.
(() => {
  const $app = document.getElementById('app');
  const state = { meta: null, user: null, counts: {} };
  const TZ = 'America/Sao_Paulo';

  // Utilidades
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const initials = n => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('');
  const fmtDate = (d, opts = { day: '2-digit', month: 'short' }) => d ? new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, ...opts }).format(new Date(d)).replace('.', '') : '';
  const fmtDateTime = d => d ? new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(d)).replace('.', '') : '';
  const fmtTime = d => new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date(d));
  const daysSince = d => Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
  const ago = d => { const n = daysSince(d); return n <= 0 ? 'hoje' : n === 1 ? 'ontem' : `há ${n} dias`; };
  const stageLabel = k => (state.meta.stages.find(s => s[0] === k) || [k, k])[1];
  const userName = id => (state.meta.users.find(u => u.id === id) || {}).name || 'Usuário removido';
  const ICONS = {
    home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/>',
    jobs: '<rect x="3" y="7" width="18" height="13" rx="3"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>',
    people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6"/>',
    cal: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M15 8l2 2"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m3 7 9 6 9-6"/>',
    phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
    pin: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    ext: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>'
  };
  const icon = n => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ''}</svg>`;

  function toast(msg, err = false) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.className = 'show' + (err ? ' err' : '');
    clearTimeout(t._h); t._h = setTimeout(() => { t.className = ''; }, 3600);
  }

  async function api(route, { method = 'GET', body, query = {} } = {}) {
    const qs = new URLSearchParams({ r: route, ...query });
    const res = await fetch('/api/ats?' + qs, {
      method, credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    });
    let data = {};
    try { data = await res.json(); } catch (_) { /* resposta sem corpo */ }
    if (res.status === 401 && route !== 'login') { state.user = null; renderLogin(); throw new Error(data.error || 'Sessão expirada.'); }
    if (res.status === 428) { renderChangePassword(true); throw new Error(data.error); }
    if (!res.ok) throw new Error(data.error || 'Não foi possível concluir.');
    return data;
  }

  function readFile(file) {
    return new Promise((resolve, reject) => {
      if (file.size > 3 * 1024 * 1024) return reject(new Error('O currículo deve ter no máximo 3 MB.'));
      const r = new FileReader();
      r.onload = () => resolve({ name: file.name, data: String(r.result) });
      r.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
      r.readAsDataURL(file);
    });
  }

  // Modal genérico: html do formulário; onSubmit recebe FormData e o form; retorna false para manter aberto.
  function modal(title, inner, onSubmit, { submit = 'Salvar', wide = false } = {}) {
    const d = document.createElement('dialog');
    if (wide) d.style.width = 'min(820px, calc(100vw - 32px))';
    d.innerHTML = `<form method="dialog" novalidate><h2>${esc(title)}</h2>${inner}<div class="error" data-err></div>
      <div class="foot"><button type="button" class="btn ghost" data-close>Cancelar</button>${submit ? `<button class="btn dark" type="submit">${esc(submit)}</button>` : ''}</div></form>`;
    document.body.appendChild(d);
    const form = d.querySelector('form');
    d.querySelector('[data-close]').onclick = () => d.close();
    d.addEventListener('close', () => d.remove());
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const btn = form.querySelector('[type=submit]');
      btn.disabled = true;
      form.querySelector('[data-err]').textContent = '';
      try {
        const keep = await onSubmit(new FormData(form), form);
        if (keep !== false) d.close();
      } catch (err) { form.querySelector('[data-err]').textContent = err.message; }
      finally { btn.disabled = false; }
    });
    d.showModal();
    return d;
  }

  // Shell
  function shell(active, content) {
    const can = state.meta.can;
    const items = [
      ['inicio', 'home', 'Início'],
      ['vagas', 'jobs', 'Vagas'],
      ['candidatos', 'people', 'Candidatos'],
      ['entrevistas', 'cal', 'Entrevistas'],
      ['indicadores', 'chart', 'Indicadores'],
      ...(can.manageUsers ? [['usuarios', 'key', 'Usuários']] : [])
    ];
    const u = state.user;
    $app.innerHTML = `<div class="shell" id="shell">
      <nav class="nav" aria-label="Navegação do recrutamento">
        <a class="nav-brand" href="#/inicio"><img src="../assets/logo-fancore.png" alt="Fancore"><span>Recrutamento</span></a>
        ${items.map(([k, ic, label]) => `<a class="item ${active === k ? 'active' : ''}" href="#/${k}">${icon(ic)}${label}${k === 'inicio' && state.counts.pending ? `<b>${state.counts.pending}</b>` : ''}</a>`).join('')}
        <a class="item" href="/carreiras/" target="_blank" rel="noopener">${icon('ext')}Página de carreiras</a>
        <div class="nav-foot"><div><strong>${esc(u.name)}</strong><small>${esc(state.meta.roles[u.role])}</small></div>
          <div class="actions"><button type="button" data-act="pwd">Trocar senha</button><button type="button" data-act="logout">Sair</button></div></div>
      </nav>
      <main id="main" tabindex="-1"><div class="topline"><a class="mark" href="#/inicio"><img src="../assets/logo-fancore.png" alt="Fancore"></a><button class="btn small menu-btn" data-act="menu">${icon('menu')}Menu</button></div>${content}</main>
    </div>`;
    $app.querySelector('[data-act=logout]').onclick = async () => { await api('logout', { method: 'POST' }).catch(() => {}); state.user = null; renderLogin(); };
    $app.querySelector('[data-act=pwd]').onclick = () => renderChangePassword(false);
    $app.querySelector('[data-act=menu]').onclick = () => document.getElementById('shell').classList.toggle('open');
    $app.querySelectorAll('.nav a.item').forEach(a => a.addEventListener('click', () => document.getElementById('shell').classList.remove('open')));
  }
  const head = (eyebrow, title, lead, actions = '') => `<div class="head"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1>${lead ? `<p>${lead}</p>` : ''}</div><div class="actions">${actions}</div></div>`;

  // Entrada
  function renderLogin() {
    $app.innerHTML = `<div class="auth">
      <section class="auth-art"><img src="../assets/logo-fancore.png" alt="Fancore">
        <div><h1>Gente que faz rede crescer.</h1><p>Vagas, candidatos, entrevistas e decisões de contratação da Fancore e das marcas, num só lugar.</p></div>
        <small class="tiny">Acesso restrito. Dados pessoais de candidatos tratados conforme a LGPD.</small></section>
      <section class="auth-form"><form id="login" novalidate>
        <div><div class="eyebrow">Recrutamento Fancore</div><h2>Entrar</h2></div>
        <label class="field">E-mail<input type="email" name="email" autocomplete="username" required></label>
        <label class="field">Senha<input type="password" name="password" autocomplete="current-password" required></label>
        <div class="error" data-err></div>
        <button class="btn primary" type="submit">Entrar</button>
        <p class="tiny">Esqueceu a senha? Peça à administração do ATS uma senha provisória.</p>
      </form></section></div>`;
    const f = document.getElementById('login');
    f.email.focus();
    f.onsubmit = async e => {
      e.preventDefault();
      f.querySelector('[data-err]').textContent = '';
      try {
        await api('login', { method: 'POST', body: { email: f.email.value, password: f.password.value } });
        await boot();
      } catch (err) { f.querySelector('[data-err]').textContent = err.message; }
    };
  }

  function renderChangePassword(forced) {
    const inner = `${forced ? '<p class="muted">Sua senha é provisória. Defina uma senha pessoal para continuar.</p>' : ''}
      <label class="field">Senha atual<input type="password" name="current" autocomplete="current-password" required></label>
      <label class="field">Nova senha<small>Pelo menos 10 caracteres, com letras e números.</small><input type="password" name="next" autocomplete="new-password" required></label>
      <label class="field">Repita a nova senha<input type="password" name="again" autocomplete="new-password" required></label>`;
    const d = modal('Trocar senha', inner, async fd => {
      if (fd.get('next') !== fd.get('again')) throw new Error('As duas senhas novas não conferem.');
      await api('password', { method: 'POST', body: { current: fd.get('current'), next: fd.get('next') } });
      toast('Senha atualizada.');
      if (forced) setTimeout(boot, 50);
    });
    if (forced) { d.querySelector('[data-close]').remove(); d.addEventListener('cancel', e => e.preventDefault()); }
  }

  // Início
  async function viewHome() {
    const d = await api('dashboard');
    const count = (arr, key, val) => (arr.find(x => x[key] === val) || {}).n || 0;
    const open = count(d.jobs, 'status', 'aberta');
    const active = d.stages.reduce((s, x) => s + x.n, 0);
    state.counts.pending = d.approvals.length + d.myEvals.length;
    const maxStage = Math.max(1, ...d.stages.map(s => s.n));
    const firstName = state.user.name.split(' ')[0];
    const sourceTotal = d.sources.reduce((s, x) => s + x.n, 0);
    shell('inicio', `${head('Recrutamento Fancore', `Olá, ${esc(firstName)}.`, 'O que pede sua atenção hoje no funil de pessoas da holding e das marcas.',
      state.meta.can.createJob ? `<a class="btn primary" href="#/vagas/nova">${icon('plus')}Nova vaga</a>` : '')}
      <div class="kpis">
        <div class="kpi"><span>Vagas abertas</span><strong>${open}</strong><small>${count(d.jobs, 'status', 'aguardando_aprovacao')} aguardando aprovação</small></div>
        <div class="kpi"><span>Candidatos em processo</span><strong>${active}</strong><small>${count(d.stages, 'stage', 'triagem')} em triagem</small></div>
        <div class="kpi"><span>Entrevistas em 7 dias</span><strong>${d.upcoming.length}</strong><small>agendadas</small></div>
        <div class="kpi"><span>Pedem sua ação</span><strong>${state.counts.pending}</strong><small>aprovações e avaliações</small></div>
      </div>
      <div class="cols">
        <section class="card c7"><h2>Pede sua ação</h2><p class="sub">Aprovações de vaga e de contratação, e avaliações de entrevistas que você conduziu.</p>
          <div class="list">${[...d.approvals.map(a => a.kind === 'vaga'
            ? `<a class="row" href="#/vaga/${a.id}"><span class="tag s-aguardando_aprovacao">Vaga</span><div class="row-main"><div class="row-title">${esc(a.label)}</div><div class="row-sub">Requisição aguardando aprovação · ${ago(a.since)}</div></div></a>`
            : `<a class="row" href="#/candidato/${a.candidate_id}"><span class="tag s-aguardando_aprovacao">Contratação</span><div class="row-main"><div class="row-title">${esc(a.candidate)}</div><div class="row-sub">${esc(a.label)} · em aprovação ${ago(a.since)}</div></div></a>`),
            ...d.myEvals.map(e => `<a class="row" href="#/candidato/${e.candidate_id}?avaliar=${e.application_id}"><span class="tag">Avaliar</span><div class="row-main"><div class="row-title">${esc(e.candidate)}</div><div class="row-sub">${esc(e.job)} · entrevista ${esc(state.meta.interviewKinds[e.kind])} em ${fmtDate(e.scheduled_at)}</div></div></a>`)
          ].join('') || '<div class="empty">Nada pendente com você.</div>'}</div></section>
        <section class="card c5"><h2>Próximas entrevistas</h2><p class="sub">Sete dias, horário de Brasília.</p>
          <div class="list">${d.upcoming.map(i => `<a class="row" href="#/candidato/${i.candidate_id}"><div class="date-chip"><b>${fmtDate(i.scheduled_at, { day: '2-digit' })}</b><i>${fmtDate(i.scheduled_at, { month: 'short' })}</i></div>
            <div class="row-main"><div class="row-title">${esc(i.candidate)}</div><div class="row-sub">${fmtTime(i.scheduled_at)} · ${esc(state.meta.interviewKinds[i.kind])} · ${esc(i.job)}</div></div></a>`).join('') || '<div class="empty">Nenhuma entrevista agendada.</div>'}</div></section>
        <section class="card c7"><h2>Parados há mais de 3 dias</h2><p class="sub">Candidatos ativos em vagas abertas sem mudança de etapa. Responder rápido é parte da marca empregadora.</p>
          <div class="list">${d.stale.map(s => `<a class="row" href="#/candidato/${s.candidate_id}"><div class="row-main"><div class="row-title">${esc(s.candidate)}</div><div class="row-sub">${esc(s.job)} · ${esc(stageLabel(s.stage))}</div></div><span class="tag late">${ago(s.stage_changed_at)}</span></a>`).join('') || '<div class="empty">Ninguém parado. Bom ritmo.</div>'}</div></section>
        <section class="card c5"><h2>Funil agora</h2><p class="sub">Candidatos ativos por etapa.</p>
          <div class="bars">${state.meta.stages.map(([k, l]) => { const n = count(d.stages, 'stage', k); return `<div class="b"><span>${l}</span><div class="bar"><i style="width:${(n / maxStage) * 100}%"></i></div><em>${n}</em></div>`; }).join('')}</div>
          <h3 style="margin-top:24px">Origem nos últimos 30 dias</h3>
          <div class="bars">${d.sources.length ? d.sources.sort((a, b) => b.n - a.n).map(s => `<div class="b"><span>${esc(state.meta.sources[s.source])}</span><div class="bar"><i style="width:${(s.n / sourceTotal) * 100}%"></i></div><em>${s.n}</em></div>`).join('') : '<div class="empty">Sem candidaturas no período.</div>'}</div></section>
      </div>`);
  }

  // Vagas
  async function viewJobs(filter = 'ativas') {
    const { jobs } = await api('jobs');
    const groups = {
      ativas: j => ['aberta', 'pausada', 'aguardando_aprovacao', 'rascunho'].includes(j.status),
      abertas: j => j.status === 'aberta',
      aprovacao: j => j.status === 'aguardando_aprovacao',
      encerradas: j => ['fechada', 'cancelada'].includes(j.status),
      todas: () => true
    };
    const labels = { ativas: 'Em andamento', abertas: 'Abertas', aprovacao: 'Em aprovação', encerradas: 'Encerradas', todas: 'Todas' };
    const list = jobs.filter(groups[filter] || groups.ativas);
    shell('vagas', `${head('Recrutamento', 'Vagas', 'Toda vaga nasce como requisição e só abre depois da aprovação de um sócio.',
      state.meta.can.createJob ? `<a class="btn primary" href="#/vagas/nova">${icon('plus')}Nova vaga</a>` : '')}
      <div class="board-tools"><div class="pills">${Object.entries(labels).map(([k, l]) => `<button class="pill ${k === filter ? 'on' : ''}" data-f="${k}">${l} <span class="tiny">${jobs.filter(groups[k]).length}</span></button>`).join('')}</div></div>
      <div class="jobs">${list.map(j => `<a class="job" href="#/vaga/${j.id}">
        <header><div><div class="eyebrow">${esc(j.company)}${j.area ? ' · ' + esc(j.area) : ''}</div><h2>${esc(j.title)}</h2></div><span class="tag s-${j.status}">${esc(state.meta.jobStatus[j.status])}</span></header>
        <div class="meta">${esc(j.contract)} · ${esc(j.workplace)} · ${esc(j.location)}${j.headcount > 1 ? ` · ${j.headcount} posições` : ''}<br>Responsável: ${esc(j.owner_name || 'a definir')}${j.opened_at ? ` · aberta ${ago(j.opened_at)}` : ''}</div>
        <div class="nums"><div><b>${j.active}</b><span>em processo</span></div><div><b>${j.triage}</b><span>em triagem</span></div><div><b>${j.hired}/${j.headcount}</b><span>contratados</span></div></div></a>`).join('') || '<div class="empty">Nenhuma vaga neste filtro.</div>'}</div>`);
    $app.querySelectorAll('[data-f]').forEach(b => b.onclick = () => viewJobs(b.dataset.f));
  }

  async function viewJobForm(id) {
    const m = state.meta;
    const job = id ? (await api('job', { query: { id } })).job : {
      company: 'Fancore', contract: 'CLT', workplace: 'Presencial', location: 'Londrina/PR', headcount: 1, public: true,
      questions: ['Por que você quer trabalhar na Fancore?'], criteria: m.defaultCriteria, members: [], owner_id: state.user.id
    };
    const opt = (arr, cur) => arr.map(v => `<option ${v === cur ? 'selected' : ''}>${esc(v)}</option>`).join('');
    const people = m.users.filter(u => u.role !== 'admin' || true);
    shell('vagas', `${head(`<a href="#/vagas">Vagas</a> / ${id ? 'Editar' : 'Nova'}`, id ? esc(job.title) : 'Nova vaga', id ? 'Mudanças valem para a página pública na hora.' : 'Preencha a requisição. Ela vai para aprovação de um sócio antes de abrir.')}
      <form id="jobform" class="stack" novalidate>
        <section class="card"><h2>A vaga</h2><p class="sub">O que aparece no topo da página pública.</p>
          <div class="grid3">
            <label class="field span2">Título<input type="text" name="title" value="${esc(job.title)}" required maxlength="120" placeholder="Social media"></label>
            <label class="field">Empresa<select name="company">${opt(m.companies, job.company)}</select></label>
            <label class="field">Área<input type="text" name="area" value="${esc(job.area)}" placeholder="Marketing"></label>
            <label class="field">Contrato<select name="contract">${opt(['CLT', 'PJ', 'Estágio', 'Temporário', 'Freelancer'], job.contract)}</select></label>
            <label class="field">Modelo<select name="workplace">${opt(['Presencial', 'Híbrido', 'Remoto'], job.workplace)}</select></label>
            <label class="field">Local<input type="text" name="location" value="${esc(job.location)}"></label>
            <label class="field">Posições<input type="number" name="headcount" min="1" max="50" value="${esc(job.headcount)}"></label>
            <label class="field">Faixa salarial<small>Opcional. Aparece na página pública.</small><input type="text" name="salary_range" value="${esc(job.salary_range)}" placeholder="R$ 3.000 a R$ 3.800"></label>
            <label class="field span3">Resumo<small>Uma ou duas frases para a lista de vagas.</small><input type="text" name="summary" value="${esc(job.summary)}" maxlength="400"></label>
            <label class="field span3">Sobre a vaga<textarea name="description" rows="6">${esc(job.description)}</textarea></label>
            <label class="field span3">O que esperamos<small>Um item por linha.</small><textarea name="requirements" rows="5">${esc(job.requirements)}</textarea></label>
            <label class="field span3">O que oferecemos<small>Um item por linha.</small><textarea name="benefits" rows="4">${esc(job.benefits)}</textarea></label>
          </div></section>
        <section class="card"><h2>Pessoas</h2><p class="sub">Responsável move candidatos; equipe acompanha e avalia.</p>
          <div class="grid2">
            <label class="field">Responsável<select name="owner_id">${people.map(u => `<option value="${u.id}" ${u.id === job.owner_id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select></label>
            <label class="field">Prazo para contratar<input type="date" name="target_date" value="${esc(job.target_date ? String(job.target_date).slice(0, 10) : '')}"></label>
            <fieldset class="span2" style="border:0;padding:0;margin:0"><legend class="field" style="margin-bottom:8px;font:500 12px var(--fc-fonte-rotulo);color:var(--ink-2)">Equipe da vaga</legend>
              <div class="pills">${people.map(u => `<label class="check" style="border:1px solid var(--line);border-radius:40px;padding:6px 12px"><input type="checkbox" name="members" value="${u.id}" ${job.members.includes(u.id) ? 'checked' : ''}>${esc(u.name)}</label>`).join('')}</div></fieldset>
          </div></section>
        <section class="card"><h2>Candidatura</h2><p class="sub">Perguntas que o candidato responde na página pública. Até seis.</p>
          <div class="stack" id="questions">${(job.questions || []).map(qq => `<input type="text" name="questions" value="${esc(qq)}" maxlength="300">`).join('')}</div>
          <div class="actions" style="margin-top:12px"><button type="button" class="btn small" id="addq">${icon('plus')}Pergunta</button>
          <label class="check"><input type="checkbox" name="public" ${job.public !== false ? 'checked' : ''}> Publicar na página de carreiras quando aberta</label></div></section>
        <section class="card"><h2>Critérios de avaliação</h2><p class="sub">Notas de 0 a 4 por entrevistador, no método CHA usado no PDI do time: conhecimento, habilidade e atitude.</p>
          <div class="stack" id="criteria">${(job.criteria || []).map(c => critRow(c)).join('')}</div>
          <button type="button" class="btn small" id="addc" style="margin-top:12px">${icon('plus')}Critério</button></section>
        <div class="error" data-err></div>
        <div class="actions">${id ? '<button class="btn dark" type="submit">Salvar alterações</button>' : '<button class="btn" type="submit" data-draft>Salvar rascunho</button><button class="btn primary" type="submit" data-submitreq>Enviar para aprovação</button>'}
          <a class="btn ghost" href="${id ? '#/vaga/' + id : '#/vagas'}">Cancelar</a></div>
      </form>`);
    function critRow(c = { name: '', kind: 'Habilidade' }) {
      return `<div class="grid3" data-crit><input type="text" class="span2" name="crit_name" value="${esc(c.name)}" maxlength="80" placeholder="Critério"><select name="crit_kind">${opt(['Conhecimento', 'Habilidade', 'Atitude'], c.kind)}</select></div>`;
    }
    const f = document.getElementById('jobform');
    document.getElementById('addq').onclick = () => {
      const box = document.getElementById('questions');
      if (box.children.length >= 6) return toast('Limite de seis perguntas.', true);
      box.insertAdjacentHTML('beforeend', '<input type="text" name="questions" maxlength="300" placeholder="Nova pergunta">');
    };
    document.getElementById('addc').onclick = () => {
      const box = document.getElementById('criteria');
      if (box.children.length >= 12) return toast('Limite de doze critérios.', true);
      box.insertAdjacentHTML('beforeend', critRow());
    };
    let submitReq = false;
    f.querySelectorAll('[type=submit]').forEach(b => b.addEventListener('click', () => { submitReq = b.hasAttribute('data-submitreq'); }));
    f.onsubmit = async e => {
      e.preventDefault();
      const fd = new FormData(f);
      const payload = Object.fromEntries(['title', 'company', 'area', 'contract', 'workplace', 'location', 'headcount', 'salary_range', 'summary', 'description', 'requirements', 'benefits', 'owner_id', 'target_date'].map(k => [k, fd.get(k)]));
      payload.public = !!fd.get('public');
      payload.members = fd.getAll('members');
      payload.questions = fd.getAll('questions').map(s => s.trim()).filter(Boolean);
      const names = fd.getAll('crit_name'), kinds = fd.getAll('crit_kind');
      payload.criteria = names.map((n, i) => ({ name: n.trim(), kind: kinds[i] })).filter(c => c.name);
      try {
        if (!payload.title || !payload.title.trim()) throw new Error('Informe o título da vaga.');
        if (id) { await api('job', { method: 'PATCH', body: { id, ...payload } }); toast('Vaga atualizada.'); location.hash = '#/vaga/' + id; }
        else { const r = await api('job', { method: 'POST', body: { ...payload, submit: submitReq } }); toast(submitReq ? 'Requisição enviada para aprovação.' : 'Rascunho salvo.'); location.hash = '#/vaga/' + r.id; }
      } catch (err) { f.querySelector('[data-err]').textContent = err.message; }
    };
  }

  async function viewPipeline(id, showClosed = false) {
    const { job, applications } = await api('pipeline', { query: { id } });
    const m = state.meta;
    const can = m.can;
    const mine = job.owner_id === state.user.id;
    const canMove = ['admin', 'recrutador', 'socio'].includes(state.user.role) || mine;
    const canEdit = ['admin', 'recrutador'].includes(state.user.role) || (state.user.role === 'gestor' && mine);
    const st = job.status;
    const transitions = {
      rascunho: [['aguardando_aprovacao', 'Enviar para aprovação', 'primary'], ['cancelada', 'Cancelar', 'ghost']],
      aguardando_aprovacao: can.approve ? [['aberta', 'Aprovar e abrir', 'primary'], ['rascunho', 'Devolver', ''], ['cancelada', 'Recusar', 'ghost']] : [['rascunho', 'Voltar a rascunho', '']],
      aberta: [['pausada', 'Pausar', ''], ['fechada', 'Encerrar', ''], ['cancelada', 'Cancelar', 'ghost']],
      pausada: [['aberta', 'Reabrir', 'primary'], ['fechada', 'Encerrar', '']],
      fechada: can.approve ? [['aberta', 'Reabrir', '']] : [],
      cancelada: [['rascunho', 'Reaproveitar como rascunho', '']]
    }[st] || [];
    const active = applications.filter(a => a.status === 'ativo' || a.status === 'contratado');
    const closed = applications.filter(a => a.status === 'reprovado' || a.status === 'desistiu');
    const publicUrl = `${location.origin}/carreiras/#${job.slug}`;
    shell('vagas', `${head(`<a href="#/vagas">Vagas</a> / ${esc(job.company)}`, esc(job.title),
      `<span class="tag s-${st}">${esc(m.jobStatus[st])}</span> ${esc(job.contract)} · ${esc(job.workplace)} · ${esc(job.location)} · responsável ${esc(job.owner_name || 'a definir')}${job.target_date ? ` · prazo ${fmtDate(job.target_date, { day: '2-digit', month: 'short', year: 'numeric' })}` : ''}`,
      `${transitions.filter(() => canEdit || can.approve).map(([to, l, cls]) => `<button class="btn ${cls}" data-status="${to}">${l}</button>`).join('')}
       ${canEdit ? `<a class="btn" href="#/vaga/${job.id}/editar">Editar</a>` : ''}
       ${st === 'aberta' && job.public ? `<button class="btn" data-copy>${icon('link')}Link público</button>` : ''}`)}
      <div class="board-tools">
        <div class="pills"><button class="pill ${!showClosed ? 'on' : ''}" data-v="0">Em processo ${active.length}</button><button class="pill ${showClosed ? 'on' : ''}" data-v="1">Reprovados e desistentes ${closed.length}</button></div>
        ${canMove && !['fechada', 'cancelada'].includes(st) ? `<button class="btn dark" data-add>${icon('plus')}Adicionar candidato</button>` : ''}
      </div>
      ${showClosed ? `<div class="card"><div class="table-wrap"><table><thead><tr><th>Candidato</th><th>Saiu em</th><th>Motivo</th><th>Nota</th><th></th></tr></thead><tbody>
          ${closed.map(a => `<tr><td><a href="#/candidato/${a.candidate_id}">${esc(a.name)}</a><div class="tiny">${esc(a.email || '')}</div></td><td>${esc(stageLabel(a.stage))}</td>
            <td><span class="tag st-${a.status}">${a.status === 'desistiu' ? 'Desistiu' : esc(a.rejection_reason || 'Reprovado')}</span></td><td>${a.score ?? '·'}</td>
            <td>${canMove ? `<button class="btn small" data-reactivate="${a.id}">Reativar</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5"><div class="empty">Ninguém por aqui.</div></td></tr>'}
        </tbody></table></div></div>`
      : `<div class="board" id="board">${m.stages.map(([k, l]) => {
        const cards = active.filter(a => a.stage === k);
        return `<section class="col" data-stage="${k}"><header>${l}<span>${cards.length}</span></header><div class="cards">${cards.map(a => candCard(a, canMove)).join('') || ''}</div></section>`;
      }).join('')}</div>
      <p class="tiny">Arraste os cartões entre etapas ou use o seletor de cada cartão. Seguir para proposta exige aprovação de sócio ou da administração.</p>`}`);

    function candCard(a, movable) {
      const late = a.status === 'ativo' && daysSince(a.stage_changed_at) > 3;
      const options = m.stages.map(([k, l]) => `<option value="${k}" ${k === a.stage ? 'selected' : ''}>${l}</option>`).join('');
      return `<article class="cand ${a.status !== 'ativo' ? 'off' : ''}" draggable="${movable && a.status === 'ativo'}" data-app="${a.id}">
        <a href="#/candidato/${a.candidate_id}">${esc(a.name)}</a>
        <div class="line"><span>${esc(m.sources[a.source])}${a.city ? ' · ' + esc(a.city) : ''}</span>${a.score != null ? `<span class="score ${a.score >= 3 ? 'hi' : ''}" title="Média de ${a.evals} avaliação(ões)">${Number(a.score).toFixed(1)}</span>` : ''}</div>
        <div class="line"><span class="${late ? 'late' : ''}">${a.status === 'contratado' ? 'Contratado ' + ago(a.stage_changed_at) : 'Na etapa ' + ago(a.stage_changed_at)}</span>${a.next_interview ? `<span>${icon('cal')} ${fmtDateTime(a.next_interview)}</span>` : ''}</div>
        ${movable && a.status === 'ativo' ? `<select aria-label="Mover ${esc(a.name)} para" data-move="${a.id}">${options}</select>` : ''}
      </article>`;
    }

    $app.querySelectorAll('[data-v]').forEach(b => b.onclick = () => viewPipeline(id, b.dataset.v === '1'));
    $app.querySelectorAll('[data-status]').forEach(b => b.onclick = () => changeJobStatus(job, b.dataset.status, () => viewPipeline(id, showClosed)));
    const copy = $app.querySelector('[data-copy]');
    if (copy) copy.onclick = async () => { try { await navigator.clipboard.writeText(publicUrl); toast('Link copiado.'); } catch (_) { prompt('Copie o link da vaga:', publicUrl); } };
    const add = $app.querySelector('[data-add]');
    if (add) add.onclick = () => addCandidate(job, () => viewPipeline(id));
    $app.querySelectorAll('[data-reactivate]').forEach(b => b.onclick = async () => { try { await api('reactivate', { method: 'POST', body: { id: b.dataset.reactivate } }); toast('Candidatura reativada.'); viewPipeline(id, true); } catch (e) { toast(e.message, true); } });
    $app.querySelectorAll('[data-move]').forEach(s => s.onchange = () => move(s.dataset.move, s.value, () => viewPipeline(id)));

    const board = document.getElementById('board');
    if (board) {
      let dragId = null;
      board.addEventListener('dragstart', e => { const c = e.target.closest('.cand'); if (!c) return; dragId = c.dataset.app; c.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
      board.addEventListener('dragend', e => { const c = e.target.closest('.cand'); if (c) c.classList.remove('dragging'); board.querySelectorAll('.drop').forEach(x => x.classList.remove('drop')); });
      board.querySelectorAll('.col').forEach(col => {
        col.addEventListener('dragover', e => { if (dragId) { e.preventDefault(); col.classList.add('drop'); } });
        col.addEventListener('dragleave', () => col.classList.remove('drop'));
        col.addEventListener('drop', e => { e.preventDefault(); col.classList.remove('drop'); if (dragId) move(dragId, col.dataset.stage, () => viewPipeline(id)); dragId = null; });
      });
    }
  }

  async function move(appId, stage, after) {
    try {
      const r = await api('move', { method: 'POST', body: { id: appId, stage } });
      toast(stage === 'contratado' ? 'Contratação registrada.' : `Movido para ${stageLabel(stage)}.`);
      if (r.filled) toast('Todas as posições da vaga foram preenchidas. Considere encerrar a vaga.');
    } catch (e) { toast(e.message, true); }
    after && after();
  }

  function changeJobStatus(job, to, after) {
    const label = state.meta.jobStatus[to];
    modal(`${label}: ${job.title}`, `<p class="muted">A vaga passa de ${esc(state.meta.jobStatus[job.status])} para ${esc(label)}.${to === 'aberta' ? ' Se estiver marcada como pública, aparece na página de carreiras.' : ''}</p>
      <label class="field">Comentário<small>Opcional. Fica no histórico.</small><textarea name="comment" rows="3"></textarea></label>`, async fd => {
      await api('job-status', { method: 'POST', body: { id: job.id, status: to, comment: fd.get('comment') } });
      toast(`Vaga: ${label}.`);
      after();
    }, { submit: 'Confirmar' });
  }

  function addCandidate(job, after) {
    const src = Object.entries(state.meta.sources).filter(([k]) => k !== 'carreiras').map(([k, l]) => `<option value="${k}">${l}</option>`).join('');
    modal(`Adicionar candidato · ${job.title}`, `<p class="muted">Para quem chegou pelo direct, indicação ou LinkedIn. Se o e-mail já existir no banco, o cadastro é reaproveitado.</p>
      <div class="grid2">
        <label class="field span2">Nome<input type="text" name="name" required></label>
        <label class="field">E-mail<input type="email" name="email"></label>
        <label class="field">WhatsApp<input type="tel" name="phone"></label>
        <label class="field">Cidade<input type="text" name="city"></label>
        <label class="field">Instagram<input type="text" name="instagram" placeholder="@perfil"></label>
        <label class="field">LinkedIn<input type="url" name="linkedin"></label>
        <label class="field">Portfólio<input type="url" name="portfolio"></label>
        <label class="field">Origem<select name="source">${src}</select></label>
        <label class="field">Indicado por<input type="text" name="referral"></label>
        <label class="field span2">Currículo<small>PDF, DOC ou DOCX até 3 MB.</small><input type="file" name="cv" accept=".pdf,.doc,.docx"></label>
        <label class="field span2">Observações<textarea name="message" rows="3"></textarea></label>
      </div>
      <label class="check"><input type="checkbox" name="ok" required> O candidato sabe que seus dados serão usados neste processo seletivo.</label>`, async fd => {
      if (!fd.get('ok')) throw new Error('Confirme que o candidato foi informado sobre o uso dos dados.');
      const file = fd.get('cv');
      const body = Object.fromEntries(['name', 'email', 'phone', 'city', 'instagram', 'linkedin', 'portfolio', 'source', 'referral', 'message'].map(k => [k, fd.get(k)]));
      body.job_id = job.id;
      if (file && file.size) body.cv = await readFile(file);
      await api('application', { method: 'POST', body });
      toast('Candidato adicionado em Triagem.');
      after();
    }, { submit: 'Adicionar', wide: true });
  }

  // Candidato
  async function viewCandidate(id, params) {
    const d = await api('candidate', { query: { id } });
    const m = state.meta;
    const c = d.candidate;
    const canWrite = ['admin', 'recrutador', 'gestor'].includes(state.user.role);
    let current = d.applications.find(a => a.id === params.get('app')) || d.applications.find(a => a.status === 'ativo') || d.applications[0];
    const link = (ic, href, text) => href ? `<div>${icon(ic)}<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(text)}</a></div>` : '';
    const stageIdx = a => m.stages.findIndex(s => s[0] === a.stage);
    const evalsFor = a => d.evaluations.filter(e => e.application_id === a.id);
    const intsFor = a => d.interviews.filter(i => i.application_id === a.id);
    const evLabel = ev => {
      const x = ev.data || {};
      return {
        candidatura_recebida: 'Candidatura recebida pela página de carreiras',
        candidatura_criada: `Adicionado ao processo (${m.sources[x.origem] || 'origem não informada'})`,
        etapa: `Movido de ${stageLabel(x.de)} para ${stageLabel(x.para)}`,
        reprovado: `Reprovado em ${stageLabel(x.etapa)}: ${x.motivo || ''}`,
        desistiu: `Desistiu em ${stageLabel(x.etapa)}`,
        reativado: 'Candidatura reativada',
        avaliacao: `Avaliação em ${stageLabel(x.etapa)}: média ${x.media} · ${m.recommendations[x.recomendacao] || ''}`,
        entrevista_agendada: `Entrevista ${m.interviewKinds[x.tipo] || ''} agendada para ${fmtDateTime(x.quando)}`,
        entrevista_status: `Entrevista ${m.interviewKinds[x.tipo] || ''}: ${String(x.status || '').replace('_', ' ')}`,
        curriculo_enviado: 'Currículo anexado',
        curriculo_baixado: 'Currículo baixado',
        candidato_editado: 'Cadastro editado',
        anonimizado: 'Dados pessoais anonimizados',
        nota: 'Anotação'
      }[ev.type] || ev.type;
    };

    function appPanel(a) {
      if (!a) return '<section class="card"><div class="empty">Este candidato não está em nenhuma vaga que você acompanha.</div></section>';
      const idx = stageIdx(a);
      const evs = evalsFor(a), ints = intsFor(a);
      const movable = a.status === 'ativo' && (['admin', 'recrutador', 'socio'].includes(state.user.role) || a.owner_id === state.user.id);
      const next = m.stages[idx + 1];
      const events = d.events.filter(e => !e.application_id || e.application_id === a.id);
      return `<section class="card">
          <div class="eyebrow">${esc(a.company)} · candidatura ${ago(a.created_at)} · ${esc(m.sources[a.source])}${a.referral ? ' · indicação de ' + esc(a.referral) : ''}</div>
          <h2><a href="#/vaga/${a.job_id}" style="text-decoration:none">${esc(a.job_title)}</a></h2>
          <div class="stagebar" aria-label="Etapa atual: ${esc(stageLabel(a.stage))}">${m.stages.map((s, i) => `<i class="${i < idx ? 'on' : i === idx ? 'cur' : ''}" title="${esc(s[1])}"></i>`).join('')}</div>
          <p class="muted" style="margin:0 0 16px">${a.status === 'ativo' ? `Etapa: <strong>${esc(stageLabel(a.stage))}</strong> desde ${fmtDate(a.stage_changed_at)}` : `<span class="tag st-${a.status}">${a.status === 'contratado' ? 'Contratado' : a.status === 'desistiu' ? 'Desistiu' : 'Reprovado: ' + esc(a.rejection_reason || '')}</span>`}</p>
          <div class="actions">
            ${movable && next ? `<button class="btn dark" data-next="${next[0]}">Avançar para ${esc(next[1])}</button>` : ''}
            ${movable ? `<select data-moveto style="width:auto"><option value="">Mover para…</option>${m.stages.map(([k, l]) => k !== a.stage ? `<option value="${k}">${l}</option>` : '').join('')}</select>` : ''}
            ${a.status === 'ativo' ? '<button class="btn" data-eval>Avaliar</button><button class="btn" data-sched>Agendar entrevista</button>' : ''}
            ${movable ? '<button class="btn ghost danger" data-reject>Reprovar ou desistência</button>' : ''}
            ${a.status !== 'ativo' && a.status !== 'contratado' && (['admin', 'recrutador', 'socio'].includes(state.user.role) || a.owner_id === state.user.id) ? '<button class="btn" data-react>Reativar</button>' : ''}
          </div>
        </section>
        ${(a.answers && a.answers.length) || a.message ? `<section class="card"><h3>Respostas da candidatura</h3><dl class="answers">${(a.answers || []).map(x => `<dt>${esc(x.question)}</dt><dd>${esc(x.answer || 'Sem resposta')}</dd>`).join('')}${a.message ? `<dt>Mensagem</dt><dd>${esc(a.message)}</dd>` : ''}</dl></section>` : ''}
        <section class="card"><h3>Avaliações ${evs.length ? `<span class="tiny">média ${(evs.reduce((s, e) => s + Number(e.average), 0) / evs.length).toFixed(2)} de 4</span>` : ''}</h3>
          <div class="evals">${evs.map(e => `<article class="eval"><header><strong>${esc(e.user_name)}</strong><span class="tiny">${esc(stageLabel(e.stage))} · ${fmtDate(e.created_at)}</span></header>
            <div class="crit">${Object.entries(e.scores).map(([k, v]) => `<span>${esc(k)}</span><span class="dots" aria-label="${v} de 4">${[1, 2, 3, 4].map(i => `<i class="${i <= v ? 'on' : ''}"></i>`).join('')}</span>`).join('')}</div>
            <p style="margin:12px 0 0"><span class="tag ${e.recommendation.includes('sim') ? 'st-contratado' : ''}">${esc(m.recommendations[e.recommendation])}</span> <span class="tiny">média ${Number(e.average).toFixed(2)}</span></p>
            ${e.comment ? `<p class="muted" style="white-space:pre-wrap;margin:8px 0 0">${esc(e.comment)}</p>` : ''}</article>`).join('') || '<div class="empty">Sem avaliações ainda.</div>'}</div></section>
        <section class="card"><h3>Entrevistas</h3><div class="list">${ints.map(i => `<div class="row"><div class="date-chip"><b>${fmtDate(i.scheduled_at, { day: '2-digit' })}</b><i>${fmtDate(i.scheduled_at, { month: 'short' })}</i></div>
            <div class="row-main"><div class="row-title">${esc(m.interviewKinds[i.kind])} · ${fmtTime(i.scheduled_at)} · ${i.duration_min} min</div><div class="row-sub">${esc(i.location || 'Local a definir')} · ${i.interviewers.map(userName).map(esc).join(', ') || 'sem entrevistadores'}</div></div>
            <select data-int="${i.id}" style="width:auto">${[['agendada', 'Agendada'], ['realizada', 'Realizada'], ['cancelada', 'Cancelada'], ['nao_compareceu', 'Não compareceu']].map(([k, l]) => `<option value="${k}" ${k === i.status ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`).join('') || '<div class="empty">Nenhuma entrevista.</div>'}</div></section>
        <section class="card"><h3>Histórico</h3>
          <form id="note" class="stack" style="margin-bottom:16px"><textarea name="text" rows="2" placeholder="Anotação visível para quem acompanha a vaga"></textarea><div><button class="btn small dark" type="submit">Anotar</button></div></form>
          <div class="timeline">${events.map(ev => `<div class="ev ${ev.type === 'nota' ? 'nota' : ''}"><div><small>${fmtDateTime(ev.created_at)} · ${esc(ev.user_name || 'Sistema')}</small><p>${esc(evLabel(ev))}${ev.type === 'nota' && ev.data.texto ? ': ' + esc(ev.data.texto) : ''}${ev.data && ev.data.comentario ? ` · “${esc(ev.data.comentario)}”` : ''}</p></div></div>`).join('') || '<div class="empty">Sem histórico.</div>'}</div></section>`;
    }

    function render() {
      shell('candidatos', `${head(`<a href="#/candidatos">Candidatos</a>`, esc(c.name), c.anonymized_at ? 'Dados pessoais anonimizados a pedido ou por retenção.' : '')}
        <div class="profile">
          <aside class="stack"><section class="card">
            <div class="avatar">${esc(initials(c.name))}</div>
            <div class="facts">
              ${c.email ? `<div>${icon('mail')}<a href="mailto:${esc(c.email)}">${esc(c.email)}</a></div>` : ''}
              ${c.phone ? `<div>${icon('phone')}<a href="https://wa.me/${esc(String(c.phone).replace(/\D/g, '').replace(/^(?!55)/, '55'))}" target="_blank" rel="noopener">${esc(c.phone)}</a></div>` : ''}
              ${c.city ? `<div>${icon('pin')}<span>${esc(c.city)}</span></div>` : ''}
              ${link('link', c.linkedin, 'LinkedIn')}${link('link', c.portfolio, 'Portfólio')}
              ${c.instagram ? `<div>${icon('link')}<a href="https://instagram.com/${esc(String(c.instagram).replace(/^@/, ''))}" target="_blank" rel="noopener noreferrer">${esc(c.instagram)}</a></div>` : ''}
              ${c.has_cv ? `<div>${icon('file')}<a href="/api/ats?r=cv&id=${c.id}">Baixar currículo</a></div>` : '<div class="tiny">Sem currículo anexado.</div>'}
            </div>
            <div class="pills" style="margin-bottom:16px">${(c.tags || []).map(t => `<span class="tag">${esc(t)}</span>`).join('') || '<span class="tiny">Sem etiquetas.</span>'}</div>
            ${canWrite && !c.anonymized_at ? `<div class="actions"><button class="btn small" data-edit>Editar</button><label class="btn small" style="cursor:pointer">${icon('file')}${c.has_cv ? 'Trocar currículo' : 'Anexar currículo'}<input type="file" accept=".pdf,.doc,.docx" data-cv hidden></label></div>` : ''}
          </section>
          <section class="card"><h3>Processos</h3><div class="list">${d.applications.map(a => `<a class="row" href="#/candidato/${c.id}?app=${a.id}" ${a === current ? 'aria-current="true" style="font-weight:500"' : ''}><div class="row-main"><div class="row-title">${esc(a.job_title)}</div><div class="row-sub">${esc(stageLabel(a.stage))}</div></div><span class="tag st-${a.status}">${a.status === 'ativo' ? 'Ativo' : a.status === 'contratado' ? 'Contratado' : a.status === 'desistiu' ? 'Desistiu' : 'Reprovado'}</span></a>`).join('') || '<div class="empty">Sem processos.</div>'}</div>
            ${canWrite && !c.anonymized_at ? '<button class="btn small" data-toJob style="margin-top:12px">Incluir em outra vaga</button>' : ''}</section>
          <section class="card"><h3>Privacidade</h3><p class="tiny">${c.consent_at ? `Consentimento em ${fmtDate(c.consent_at, { day: '2-digit', month: 'short', year: 'numeric' })} (${esc(c.consent_version)}).` : 'Cadastro manual, sem consentimento registrado pela página.'} ${c.retention_until ? `Retenção até ${fmtDate(c.retention_until, { day: '2-digit', month: 'short', year: 'numeric' })}.` : ''}</p>
            ${m.can.privacy && !c.anonymized_at ? '<button class="btn small ghost danger" data-anon>Anonimizar dados</button>' : ''}</section>
          </aside>
          <div class="stack">${appPanel(current)}</div>
        </div>`);
      bind();
    }

    const refresh = () => viewCandidate(id, new URLSearchParams(current ? { app: current.id } : {}));
    function bind() {
      const q = s => $app.querySelector(s);
      if (q('[data-next]')) q('[data-next]').onclick = () => move(current.id, q('[data-next]').dataset.next, refresh);
      if (q('[data-moveto]')) q('[data-moveto]').onchange = e => e.target.value && move(current.id, e.target.value, refresh);
      if (q('[data-eval]')) q('[data-eval]').onclick = () => evaluate(current, refresh);
      if (q('[data-sched]')) q('[data-sched]').onclick = () => schedule(current, refresh);
      if (q('[data-reject]')) q('[data-reject]').onclick = () => reject(current, refresh);
      if (q('[data-react]')) q('[data-react]').onclick = async () => { try { await api('reactivate', { method: 'POST', body: { id: current.id } }); toast('Candidatura reativada.'); refresh(); } catch (e) { toast(e.message, true); } };
      $app.querySelectorAll('[data-int]').forEach(s => s.onchange = async () => { try { await api('interview', { method: 'PATCH', body: { id: s.dataset.int, status: s.value } }); toast('Entrevista atualizada.'); if (s.value === 'realizada') evaluate(current, refresh); else refresh(); } catch (e) { toast(e.message, true); } });
      const note = q('#note');
      if (note) note.onsubmit = async e => { e.preventDefault(); try { await api('note', { method: 'POST', body: { application_id: current.id, text: note.text.value } }); refresh(); } catch (err) { toast(err.message, true); } };
      if (q('[data-edit]')) q('[data-edit]').onclick = () => editCandidate(c, refresh);
      const cvInput = q('[data-cv]');
      if (cvInput) cvInput.onchange = async () => { try { const file = await readFile(cvInput.files[0]); await api('cv', { method: 'POST', body: { candidate_id: c.id, file } }); toast('Currículo anexado.'); refresh(); } catch (e) { toast(e.message, true); } };
      if (q('[data-anon]')) q('[data-anon]').onclick = () => modal('Anonimizar dados', `<p class="muted">Apaga nome, contatos, links, currículo, respostas e anotações deste candidato. Avaliações e etapas ficam só como estatística. Não dá para desfazer.</p>
        <label class="field">Motivo<input type="text" name="reason" placeholder="Pedido do titular, fim da retenção…" required></label>`, async fd => {
        if (!fd.get('reason')) throw new Error('Informe o motivo.');
        await api('anonymize', { method: 'POST', body: { candidate_id: c.id, reason: fd.get('reason') } }); toast('Dados anonimizados.'); refresh();
      }, { submit: 'Anonimizar' });
      if (q('[data-toJob]')) q('[data-toJob]').onclick = async () => {
        const { jobs } = await api('jobs');
        const open = jobs.filter(j => ['aberta', 'pausada'].includes(j.status) && !d.applications.some(a => a.job_id === j.id));
        if (!open.length) return toast('Nenhuma outra vaga aberta para incluir.', true);
        modal('Incluir em outra vaga', `<label class="field">Vaga<select name="job">${open.map(j => `<option value="${j.id}">${esc(j.title)} · ${esc(j.company)}</option>`).join('')}</select></label>`, async fd => {
          await api('application', { method: 'POST', body: { job_id: fd.get('job'), candidate_id: c.id, source: 'banco' } });
          toast('Incluído em Triagem.'); refresh();
        }, { submit: 'Incluir' });
      };
    }
    render();
    if (params.get('avaliar') && current) { const a = d.applications.find(x => x.id === params.get('avaliar')); if (a) { current = a; render(); evaluate(a, refresh); } }
  }

  function evaluate(a, after) {
    const m = state.meta;
    const crits = a.criteria && a.criteria.length ? a.criteria : m.defaultCriteria;
    const scale = name => `<div class="scale" role="radiogroup" aria-label="${esc(name)}">${[0, 1, 2, 3, 4].map(v => `<label><input type="radio" name="s:${esc(name)}" value="${v}"><span>${v}</span></label>`).join('')}</div>`;
    modal('Avaliar candidato', `<p class="muted">0 não demonstra · 1 iniciante · 2 em desenvolvimento · 3 atende · 4 referência. Sua avaliação substitui a anterior nesta etapa.</p>
      <label class="field">Etapa<select name="stage">${m.stages.map(([k, l]) => `<option value="${k}" ${k === a.stage ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <div>${crits.map(c => `<div class="crit-row"><div>${esc(c.name)}<small>${esc(c.kind)}</small></div>${scale(c.name)}</div>`).join('')}</div>
      <label class="field">Recomendação<select name="recommendation" required><option value="">Escolha</option>${Object.entries(m.recommendations).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
      <label class="field">Comentário<small>Evidências observadas, não impressões. Fica visível para quem acompanha a vaga.</small><textarea name="comment" rows="4"></textarea></label>`, async fd => {
      const scores = {};
      for (const c of crits) { const v = fd.get('s:' + c.name); if (v !== null) scores[c.name] = Number(v); }
      if (!Object.keys(scores).length) throw new Error('Dê nota a pelo menos um critério.');
      if (!fd.get('recommendation')) throw new Error('Escolha a recomendação.');
      await api('evaluation', { method: 'POST', body: { application_id: a.id, stage: fd.get('stage'), scores, recommendation: fd.get('recommendation'), comment: fd.get('comment') } });
      toast('Avaliação registrada.'); after();
    }, { submit: 'Registrar avaliação', wide: true });
  }

  function schedule(a, after) {
    const m = state.meta;
    const tomorrow = new Date(Date.now() + 86400000);
    const local = new Date(tomorrow.toLocaleString('en-US', { timeZone: TZ }));
    local.setHours(10, 0, 0, 0);
    const pad = n => String(n).padStart(2, '0');
    const def = `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}T10:00`;
    modal('Agendar entrevista', `<div class="grid2">
        <label class="field">Tipo<select name="kind">${Object.entries(m.interviewKinds).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
        <label class="field">Duração<select name="duration_min">${[30, 45, 60, 90].map(n => `<option ${n === 45 ? 'selected' : ''} value="${n}">${n} min</option>`).join('')}</select></label>
        <label class="field">Data e hora<small>Horário de Brasília.</small><input type="datetime-local" name="when" value="${def}" required></label>
        <label class="field">Local ou link<input type="text" name="location" placeholder="Escritório Fancore ou link do Meet"></label>
      </div>
      <fieldset style="border:0;padding:0;margin:0"><legend class="field" style="margin-bottom:8px;font:500 12px var(--fc-fonte-rotulo);color:var(--ink-2)">Entrevistadores</legend>
        <div class="pills">${m.users.map(u => `<label class="check" style="border:1px solid var(--line);border-radius:40px;padding:6px 12px"><input type="checkbox" name="interviewers" value="${u.id}" ${u.id === state.user.id ? 'checked' : ''}>${esc(u.name)}</label>`).join('')}</div></fieldset>
      <p class="tiny">O convite de calendário ainda é enviado por fora. Registre aqui para o time acompanhar e cobrar a avaliação.</p>`, async fd => {
      const when = fd.get('when');
      if (!when) throw new Error('Informe data e hora.');
      await api('interview', { method: 'POST', body: { application_id: a.id, kind: fd.get('kind'), duration_min: fd.get('duration_min'), scheduled_at: when + ':00-03:00', location: fd.get('location'), interviewers: fd.getAll('interviewers') } });
      toast('Entrevista agendada.'); after();
    }, { submit: 'Agendar', wide: true });
  }

  function reject(a, after) {
    const m = state.meta;
    modal('Encerrar candidatura', `<div class="pills" role="radiogroup"><label class="check"><input type="radio" name="status" value="reprovado" checked> Reprovado pela Fancore</label><label class="check"><input type="radio" name="status" value="desistiu"> Candidato desistiu</label></div>
      <label class="field">Motivo<select name="reason">${m.rejectionReasons.map(r => `<option>${esc(r)}</option>`).join('')}</select></label>
      <label class="field">Comentário interno<textarea name="comment" rows="3"></textarea></label>
      <p class="tiny">Dê retorno ao candidato. O envio de mensagem ainda é manual.</p>`, async fd => {
      await api('reject', { method: 'POST', body: { id: a.id, status: fd.get('status'), reason: fd.get('reason'), comment: fd.get('comment') } });
      toast('Candidatura encerrada.'); after();
    }, { submit: 'Encerrar' });
  }

  function editCandidate(c, after) {
    modal('Editar candidato', `<div class="grid2">
        <label class="field span2">Nome<input type="text" name="name" value="${esc(c.name)}" required></label>
        <label class="field">E-mail<input type="email" name="email" value="${esc(c.email)}"></label>
        <label class="field">WhatsApp<input type="tel" name="phone" value="${esc(c.phone)}"></label>
        <label class="field">Cidade<input type="text" name="city" value="${esc(c.city)}"></label>
        <label class="field">Instagram<input type="text" name="instagram" value="${esc(c.instagram)}"></label>
        <label class="field">LinkedIn<input type="url" name="linkedin" value="${esc(c.linkedin)}"></label>
        <label class="field">Portfólio<input type="url" name="portfolio" value="${esc(c.portfolio)}"></label>
        <label class="field span2">Etiquetas<small>Separadas por vírgula. Ajudam a achar no banco de talentos.</small><input type="text" name="tags" value="${esc((c.tags || []).join(', '))}" placeholder="vídeo, capcut, bom para estágio"></label>
      </div>`, async fd => {
      const body = Object.fromEntries(['name', 'email', 'phone', 'city', 'instagram', 'linkedin', 'portfolio'].map(k => [k, fd.get(k)]));
      body.id = c.id;
      body.tags = String(fd.get('tags') || '').split(',').map(s => s.trim()).filter(Boolean);
      await api('candidate', { method: 'PATCH', body });
      toast('Cadastro atualizado.'); after();
    }, { wide: true });
  }

  // Banco de talentos
  async function viewCandidates(term = '') {
    const { candidates } = await api('candidates', { query: term ? { q: term } : {} });
    shell('candidatos', `${head('Recrutamento', 'Banco de talentos', 'Todos os candidatos, de todas as vagas. Busque por nome, e-mail, cidade ou etiqueta.')}
      <div class="board-tools"><form class="search" id="search">${icon('search')}<input type="search" name="q" value="${esc(term)}" placeholder="Buscar candidato" aria-label="Buscar candidato"></form><span class="tiny">${candidates.length} candidato(s)${candidates.length === 300 ? ', mostrando os 300 mais recentes' : ''}</span></div>
      <div class="card"><div class="table-wrap"><table><thead><tr><th>Nome</th><th>Cidade</th><th>Processos</th><th>Nota</th><th>Etiquetas</th><th>Entrada</th></tr></thead><tbody>
        ${candidates.map(c => `<tr><td><a href="#/candidato/${c.id}">${esc(c.name)}</a><div class="tiny">${esc(c.email || '')}</div></td><td>${esc(c.city || '·')}</td>
          <td>${(c.applications || []).map(a => `<div>${esc(a.job)} <span class="tag ${a.status !== 'ativo' ? 'st-' + a.status : ''}">${a.status === 'ativo' ? esc(stageLabel(a.stage)) : a.status === 'contratado' ? 'Contratado' : a.status === 'desistiu' ? 'Desistiu' : 'Reprovado'}</span></div>`).join('')}</td>
          <td>${c.score != null ? Number(c.score).toFixed(1) : '·'}</td><td>${(c.tags || []).map(t => `<span class="tag">${esc(t)}</span>`).join(' ')}</td><td class="tiny">${fmtDate(c.created_at, { day: '2-digit', month: 'short', year: '2-digit' })}</td></tr>`).join('') || '<tr><td colspan="6"><div class="empty">Nenhum candidato encontrado.</div></td></tr>'}
      </tbody></table></div></div>`);
    const f = document.getElementById('search');
    f.onsubmit = e => { e.preventDefault(); viewCandidates(f.q.value.trim()); };
    let t; f.q.oninput = () => { clearTimeout(t); t = setTimeout(() => viewCandidates(f.q.value.trim()).then(() => { const i = document.querySelector('#search input'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }), 400); };
  }

  // Agenda
  async function viewInterviews() {
    const { interviews } = await api('interviews');
    const m = state.meta;
    const upcoming = interviews.filter(i => new Date(i.scheduled_at) > Date.now() - 3600000 && i.status === 'agendada');
    const past = interviews.filter(i => !upcoming.includes(i)).reverse();
    const byDay = {};
    upcoming.forEach(i => { const k = fmtDate(i.scheduled_at, { weekday: 'long', day: '2-digit', month: 'long' }); (byDay[k] = byDay[k] || []).push(i); });
    const row = i => `<a class="row" href="#/candidato/${i.candidate_id}?app=${i.application_id}"><div class="date-chip"><b style="font-size:16px">${fmtTime(i.scheduled_at)}</b><i>${i.duration_min} min</i></div>
      <div class="row-main"><div class="row-title">${esc(i.candidate)} · ${esc(m.interviewKinds[i.kind])}</div><div class="row-sub">${esc(i.job)} · ${esc(i.company)} · ${esc(i.location || 'local a definir')} · ${i.interviewers.map(userName).map(esc).join(', ')}</div></div>
      ${i.status !== 'agendada' ? `<span class="tag">${esc(i.status.replace('_', ' '))}</span>` : ''}</a>`;
    shell('entrevistas', `${head('Recrutamento', 'Entrevistas', 'Agenda das vagas que você acompanha, em horário de Brasília.')}
      <div class="cols"><section class="card c7"><h2>Próximas</h2><p class="sub">${upcoming.length} agendada(s).</p>
        ${Object.entries(byDay).map(([day, list]) => `<h3 style="margin-top:16px">${esc(day)}</h3><div class="list">${list.map(row).join('')}</div>`).join('') || '<div class="empty">Nenhuma entrevista agendada.</div>'}</section>
      <section class="card c5"><h2>Últimos 30 dias</h2><p class="sub">Marque como realizada para liberar a avaliação.</p><div class="list">${past.map(row).join('') || '<div class="empty">Sem histórico recente.</div>'}</div></section></div>`);
  }

  // Indicadores
  async function viewReports(days = 90) {
    const r = await api('reports', { query: { days } });
    const m = state.meta;
    const total = r.funnel.reduce((s, x) => s + x.n, 0);
    const reached = m.stages.map(([k], i) => r.funnel.filter(x => m.stages.findIndex(s => s[0] === x.stage) >= i).reduce((s, x) => s + x.n, 0));
    const max = Math.max(1, reached[0]);
    const hires = r.hire.hires || 0;
    const srcHire = Object.fromEntries(r.sourceHires.map(s => [s.source, s.n]));
    shell('indicadores', `${head('Recrutamento', 'Indicadores', 'Funil, velocidade e qualidade das fontes. Contagens por candidaturas criadas no período.',
      `<div class="pills">${[30, 90, 180, 365].map(n => `<button class="pill ${n === r.days ? 'on' : ''}" data-d="${n}">${n} dias</button>`).join('')}</div>`)}
      <div class="kpis">
        <div class="kpi"><span>Candidaturas</span><strong>${total}</strong><small>últimos ${r.days} dias</small></div>
        <div class="kpi"><span>Contratações</span><strong>${hires}</strong><small>${total ? ((hires / total) * 100).toFixed(1) + '% das candidaturas' : 'sem base'}</small></div>
        <div class="kpi"><span>Tempo até contratar</span><strong>${r.hire.days_to_hire ?? '·'}</strong><small>dias, da candidatura à contratação</small></div>
        <div class="kpi"><span>Tempo para preencher</span><strong>${r.hire.days_to_fill ?? '·'}</strong><small>dias, da abertura da vaga à contratação</small></div>
      </div>
      <div class="cols">
        <section class="card c7"><h2>Funil por etapa alcançada</h2><p class="sub">Quantos chegaram pelo menos até cada etapa, e a conversão da etapa anterior.</p>
          <div class="bars">${m.stages.map(([k, l], i) => `<div class="b"><span>${l}</span><div class="bar"><i style="width:${(reached[i] / max) * 100}%"></i></div><em>${reached[i]}${i ? `<span class="tiny"> ${reached[i - 1] ? Math.round((reached[i] / reached[i - 1]) * 100) : 0}%</span>` : ''}</em></div>`).join('')}</div></section>
        <section class="card c5"><h2>Fontes</h2><p class="sub">Volume e contratações por origem.</p>
          <div class="table-wrap"><table><thead><tr><th>Origem</th><th>Candidaturas</th><th>Contratados</th></tr></thead><tbody>
            ${r.sources.map(s => `<tr><td>${esc(m.sources[s.source])}</td><td>${s.n}</td><td>${srcHire[s.source] || 0}</td></tr>`).join('') || '<tr><td colspan="3"><div class="empty">Sem dados.</div></td></tr>'}</tbody></table></div></section>
        <section class="card c5"><h2>Motivos de reprovação</h2><p class="sub">Onde o funil perde gente.</p>
          <div class="bars">${r.reasons.map(x => `<div class="b"><span>${esc(x.reason || 'Sem motivo')}</span><div class="bar"><i style="width:${(x.n / Math.max(1, r.reasons[0].n)) * 100}%"></i></div><em>${x.n}</em></div>`).join('') || '<div class="empty">Sem reprovações no período.</div>'}</div></section>
        <section class="card c7"><h2>Vagas em andamento</h2><p class="sub">Idade da vaga desde a abertura.</p>
          <div class="table-wrap"><table><thead><tr><th>Vaga</th><th>Aberta há</th><th>Em processo</th><th>Contratados</th></tr></thead><tbody>
            ${r.byJob.map(j => `<tr><td><a href="#/vaga/${j.id}">${esc(j.title)}</a><div class="tiny">${esc(j.company)} · ${esc(m.jobStatus[j.status])}</div></td><td>${j.opened_at ? daysSince(j.opened_at) + ' dias' : '·'}</td><td>${j.active}</td><td>${j.hired}/${j.headcount}</td></tr>`).join('') || '<tr><td colspan="4"><div class="empty">Nenhuma vaga aberta.</div></td></tr>'}</tbody></table></div></section>
      </div>`);
    $app.querySelectorAll('[data-d]').forEach(b => b.onclick = () => viewReports(Number(b.dataset.d)));
  }

  // Usuários
  async function viewUsers() {
    const { users } = await api('users');
    const m = state.meta;
    let retention = { candidates: [] };
    try { retention = await api('retention'); } catch (_) { /* opcional */ }
    shell('usuarios', `${head('Administração', 'Usuários', 'Quem acessa o ATS e com qual perfil. Senhas provisórias aparecem uma única vez.', '<button class="btn primary" data-new>Novo usuário</button>')}
      <div class="card" style="margin-bottom:16px"><div class="table-wrap"><table><thead><tr><th>Nome</th><th>Perfil</th><th>Último acesso</th><th>Situação</th><th></th></tr></thead><tbody>
        ${users.map(u => `<tr><td>${esc(u.name)}<div class="tiny">${esc(u.email)}${u.title ? ' · ' + esc(u.title) : ''}</div></td>
          <td><select data-role="${u.id}" style="width:auto">${Object.entries(m.roles).map(([k, l]) => `<option value="${k}" ${k === u.role ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
          <td class="tiny">${u.last_login_at ? fmtDateTime(u.last_login_at) : 'Nunca'}</td>
          <td>${u.active ? (u.must_change_password ? '<span class="tag">Senha provisória</span>' : '<span class="tag st-contratado">Ativo</span>') : '<span class="tag st-reprovado">Inativo</span>'}</td>
          <td class="actions"><button class="btn small" data-reset="${u.id}">Nova senha</button><button class="btn small ghost" data-toggle="${u.id}" data-active="${u.active}">${u.active ? 'Desativar' : 'Reativar'}</button></td></tr>`).join('')}
      </tbody></table></div></div>
      <div class="cols"><section class="card c6"><h2>Perfis</h2><div class="list">
        <div class="row"><div class="row-main"><div class="row-title">Administração</div><div class="row-sub">Tudo, inclusive usuários e pedidos de privacidade.</div></div></div>
        <div class="row"><div class="row-main"><div class="row-title">Recrutamento</div><div class="row-sub">Todas as vagas e candidatos. Cria vagas, move, reprova, registra contratação.</div></div></div>
        <div class="row"><div class="row-main"><div class="row-title">Sócio</div><div class="row-sub">Vê tudo, aprova abertura de vaga e a passagem para proposta.</div></div></div>
        <div class="row"><div class="row-main"><div class="row-title">Gestor da vaga</div><div class="row-sub">Só as vagas em que é responsável ou da equipe. Avalia e, se responsável, move candidatos.</div></div></div>
      </div></section>
      <section class="card c6"><h2>Retenção vencendo</h2><p class="sub">Candidatos com prazo de guarda vencido ou vencendo em 30 dias. Anonimize quem não está em processo.</p>
        <div class="list">${retention.candidates.map(c => `<a class="row" href="#/candidato/${c.id}"><div class="row-main"><div class="row-title">${esc(c.name)}</div><div class="row-sub">Até ${fmtDate(c.retention_until, { day: '2-digit', month: 'short', year: 'numeric' })}${c.in_process ? ' · em processo' : ''}</div></div></a>`).join('') || '<div class="empty">Nada vencendo.</div>'}</div></section></div>`);
    const showTemp = (title, temp, email) => modal(title, `<p class="muted">Envie por canal privado para ${esc(email)}. A troca é obrigatória no primeiro acesso e esta senha não será exibida de novo.</p><div class="secret">${esc(temp)}</div><p class="tiny">Endereço: ${esc(location.origin)}/recrutamento/</p>`, async () => {}, { submit: 'Pronto' });
    $app.querySelector('[data-new]').onclick = () => modal('Novo usuário', `<div class="grid2">
        <label class="field span2">Nome<input type="text" name="name" required></label>
        <label class="field">E-mail<input type="email" name="email" required></label>
        <label class="field">Cargo<input type="text" name="title" placeholder="Head de Growth"></label>
        <label class="field span2">Perfil<select name="role">${Object.entries(m.roles).map(([k, l]) => `<option value="${k}" ${k === 'gestor' ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>`, async fd => {
      const r = await api('users', { method: 'POST', body: Object.fromEntries(fd) });
      await loadMeta();
      setTimeout(() => showTemp('Usuário criado', r.tempPassword, fd.get('email')), 50);
      viewUsers();
    });
    $app.querySelectorAll('[data-role]').forEach(s => s.onchange = async () => { try { await api('users', { method: 'PATCH', body: { id: s.dataset.role, role: s.value } }); toast('Perfil atualizado.'); await loadMeta(); } catch (e) { toast(e.message, true); viewUsers(); } });
    $app.querySelectorAll('[data-reset]').forEach(b => b.onclick = async () => {
      const u = users.find(x => x.id === b.dataset.reset);
      if (!confirm(`Gerar nova senha provisória para ${u.name}? A sessão atual dessa pessoa será encerrada.`)) return;
      try { const r = await api('users', { method: 'PATCH', body: { id: u.id, resetPassword: true } }); showTemp('Nova senha provisória', r.tempPassword, u.email); viewUsers(); } catch (e) { toast(e.message, true); }
    });
    $app.querySelectorAll('[data-toggle]').forEach(b => b.onclick = async () => { try { await api('users', { method: 'PATCH', body: { id: b.dataset.toggle, active: b.dataset.active !== 'true' } }); toast('Situação atualizada.'); await loadMeta(); viewUsers(); } catch (e) { toast(e.message, true); } });
  }

  // Roteador
  async function route() {
    if (!state.user) return;
    const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
    const parts = path.split('/').filter(Boolean);
    const params = new URLSearchParams(query);
    window.scrollTo(0, 0);
    try {
      if (!parts.length || parts[0] === 'inicio') return await viewHome();
      if (parts[0] === 'vagas' && parts[1] === 'nova') return await viewJobForm(null);
      if (parts[0] === 'vagas') return await viewJobs();
      if (parts[0] === 'vaga' && parts[2] === 'editar') return await viewJobForm(parts[1]);
      if (parts[0] === 'vaga') return await viewPipeline(parts[1]);
      if (parts[0] === 'candidatos') return await viewCandidates();
      if (parts[0] === 'candidato') return await viewCandidate(parts[1], params);
      if (parts[0] === 'entrevistas') return await viewInterviews();
      if (parts[0] === 'indicadores') return await viewReports();
      if (parts[0] === 'usuarios' && state.meta.can.manageUsers) return await viewUsers();
      location.hash = '#/inicio';
    } catch (e) {
      if (!state.user) return;
      shell('', `${head('Recrutamento', 'Não foi possível abrir', esc(e.message))}<a class="btn" href="#/inicio">Voltar ao início</a>`);
    }
  }

  async function loadMeta() { state.meta = await api('meta'); state.user = state.meta.user; }
  async function boot() {
    try {
      await loadMeta();
      if (state.user.must_change_password) { shell('', head('Recrutamento', 'Bem-vindo.', 'Defina sua senha para começar.')); renderChangePassword(true); return; }
      await route();
    } catch (e) { if (!state.user) renderLogin(); }
  }
  window.addEventListener('hashchange', route);
  boot();
})();
