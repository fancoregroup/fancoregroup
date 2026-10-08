'use strict';
// Carreiras Fancore · lista de vagas abertas e formulário de candidatura (API /api/carreiras).
(() => {
  const $main = document.getElementById('main');
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const arrow = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
  const source = new URLSearchParams(location.search).get('origem');
  let jobs = [], company = 'todas';

  const lines = t => String(t || '').split('\n').map(s => s.replace(/^[\s\-*•·]+/, '').trim()).filter(Boolean);
  const chips = j => [j.company, j.contract, j.workplace, j.location, j.salary_range].filter(Boolean).map(x => `<span class="chip">${esc(x)}</span>`).join('');

  function renderList() {
    const companies = [...new Set(jobs.map(j => j.company))];
    const shown = jobs.filter(j => company === 'todas' || j.company === company);
    document.title = 'Trabalhe na Fancore';
    $main.innerHTML = `<section class="hero"><div class="wrap">
        <div class="eyebrow">Trabalhe na Fancore</div>
        <h1>Onde negócios viram redes.</h1>
        <p class="lead">A Fancore cria e expande marcas de franquia. Procuramos gente com visão para enxergar antes, coragem para agir e método para fazer rodar.</p>
        <div class="values"><div><b>Visão para criar</b><span>Marcas, modelos e mercados novos saem daqui.</span></div><div><b>Método para operar</b><span>Testar, validar e escalar o que funciona.</span></div><div><b>Dono do resultado</b><span>Autonomia com responsabilidade sobre a entrega.</span></div></div>
      </div></section>
      <section class="list-sec"><div class="wrap">
        <div class="eyebrow">Vagas abertas</div><h2>${jobs.length ? `${jobs.length} ${jobs.length === 1 ? 'vaga aberta' : 'vagas abertas'}` : 'Nenhuma vaga aberta agora'}</h2>
        ${companies.length > 1 ? `<div class="filters">${['todas', ...companies].map(c => `<button class="${c === company ? 'on' : ''}" data-c="${esc(c)}">${c === 'todas' ? 'Todas' : esc(c)}</button>`).join('')}</div>` : '<div style="height:32px"></div>'}
        <div class="jobs">${shown.map(j => `<a class="job" href="#${encodeURIComponent(j.slug)}"><div><h3>${esc(j.title)}</h3>${j.summary ? `<p>${esc(j.summary)}</p>` : ''}<div class="meta">${chips(j)}</div></div><span class="arrow">${arrow}</span></a>`).join('')
          || '<div class="empty">Não há vagas abertas neste momento. Acompanhe a Fancore no Instagram para saber das próximas.</div>'}</div>
      </div></section>`;
    $main.querySelectorAll('[data-c]').forEach(b => b.onclick = () => { company = b.dataset.c; renderList(); });
  }

  function renderJob(j) {
    document.title = `${j.title} · Trabalhe na Fancore`;
    const req = lines(j.requirements), ben = lines(j.benefits);
    const questions = Array.isArray(j.questions) ? j.questions : [];
    $main.innerHTML = `<section class="detail"><div class="wrap">
      <a class="back" href="#">← Todas as vagas</a>
      <div class="eyebrow">${esc(j.company)}${j.area ? ' · ' + esc(j.area) : ''}</div>
      <h1>${esc(j.title)}</h1>
      <div class="meta">${chips(j)}</div>
      <div class="cols">
        <div class="body">
          ${j.description ? `<h2>Sobre a vaga</h2><p>${esc(j.description)}</p>` : ''}
          ${req.length ? `<h2>O que esperamos</h2><ul>${req.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
          ${ben.length ? `<h2>O que oferecemos</h2><ul>${ben.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
        </div>
        <aside class="apply" id="apply"><h2>Candidate-se</h2><p>Leva poucos minutos. Respondemos a todos que se candidatarem.</p>
          <form id="form" novalidate>
            <label class="f">Nome completo<input name="name" autocomplete="name" required maxlength="120"></label>
            <div class="two"><label class="f">E-mail<input type="email" name="email" autocomplete="email" required></label>
            <label class="f">WhatsApp<input type="tel" name="phone" autocomplete="tel" required placeholder="(43) 99999-9999"></label></div>
            <div class="two"><label class="f">Cidade<input name="city" autocomplete="address-level2"></label>
            <label class="f">Instagram<input name="instagram" placeholder="@seuperfil"></label></div>
            <div class="two"><label class="f">LinkedIn<input name="linkedin" inputmode="url" placeholder="linkedin.com/in/…"></label>
            <label class="f">Portfólio<input name="portfolio" inputmode="url" placeholder="Drive, Behance, site"></label></div>
            <label class="f">Currículo<small>PDF, DOC ou DOCX até 3 MB. Opcional se enviar portfólio ou LinkedIn.</small>
              <span class="file" id="filelabel">Escolher arquivo<input type="file" name="cv" accept=".pdf,.doc,.docx"></span></label>
            ${questions.map((qq, i) => `<label class="f">${esc(qq)}<textarea name="a${i}" maxlength="2000"></textarea></label>`).join('')}
            <label class="f">Como soube da vaga?<select name="source"><option value="carreiras">Site ou link da vaga</option><option value="instagram" ${source === 'instagram' ? 'selected' : ''}>Instagram</option><option value="linkedin" ${source === 'linkedin' ? 'selected' : ''}>LinkedIn</option><option value="indicacao" ${source === 'indicacao' ? 'selected' : ''}>Indicação</option></select></label>
            <label class="f" id="refwrap" hidden>Quem indicou?<input name="referral" maxlength="120"></label>
            <label class="hp" aria-hidden="true">Site<input name="website" tabindex="-1" autocomplete="off"></label>
            <label class="consent"><input type="checkbox" name="consent" required><span>Concordo que a Fancore use meus dados para este e futuros processos seletivos do grupo, por até 12 meses. Posso pedir correção ou exclusão a qualquer momento.</span></label>
            <div class="error" id="err" role="alert"></div>
            <button class="btn" type="submit">Enviar candidatura</button>
          </form></aside>
      </div></div></section>`;
    const f = document.getElementById('form');
    const fileInput = f.cv, label = document.getElementById('filelabel');
    fileInput.onchange = () => { const file = fileInput.files[0]; label.firstChild.textContent = file ? file.name : 'Escolher arquivo'; };
    f.source.onchange = () => { document.getElementById('refwrap').hidden = f.source.value !== 'indicacao'; };
    f.source.onchange();
    f.onsubmit = async e => {
      e.preventDefault();
      const err = document.getElementById('err');
      const btn = f.querySelector('.btn');
      err.textContent = '';
      if (!f.elements['name'].value.trim() || !f.email.value.trim() || !f.phone.value.trim()) return (err.textContent = 'Preencha nome, e-mail e WhatsApp.');
      if (!f.consent.checked) return (err.textContent = 'Marque a concordância com o uso dos dados para enviar.');
      const file = fileInput.files[0];
      if (!file && !f.linkedin.value.trim() && !f.portfolio.value.trim()) return (err.textContent = 'Envie o currículo ou um link de portfólio ou LinkedIn.');
      if (file && file.size > 3 * 1024 * 1024) return (err.textContent = 'O currículo deve ter no máximo 3 MB.');
      btn.disabled = true; btn.textContent = 'Enviando…';
      try {
        const body = {
          slug: j.slug, name: f.elements['name'].value, email: f.email.value, phone: f.phone.value, city: f.city.value, instagram: f.instagram.value,
          linkedin: f.linkedin.value, portfolio: f.portfolio.value, source: f.source.value, referral: f.referral.value, website: f.website.value,
          consent: f.consent.checked, answers: questions.map((_, i) => f['a' + i].value)
        };
        if (file) body.cv = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve({ name: file.name, data: String(r.result) }); r.onerror = reject; r.readAsDataURL(file); });
        const res = await fetch('/api/carreiras', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Não foi possível enviar. Tente de novo.');
        document.getElementById('apply').innerHTML = `<div class="done"><h2>Recebemos sua candidatura.</h2><p>Obrigado, ${esc(f.elements['name'].value.split(' ')[0])}. Nosso time vai analisar e responder pelo WhatsApp ou e-mail informados.</p><a class="back" href="#" style="margin:16px 0 0">← Ver outras vagas</a></div>`;
      } catch (ex) {
        err.textContent = ex.message; btn.disabled = false; btn.textContent = 'Enviar candidatura';
      }
    };
  }

  function route() {
    const slug = decodeURIComponent(location.hash.replace(/^#/, ''));
    window.scrollTo(0, 0);
    if (!slug) return renderList();
    const j = jobs.find(x => x.slug === slug);
    if (j) renderJob(j);
    else { renderList(); }
  }

  fetch('/api/carreiras').then(r => r.json()).then(d => { jobs = d.jobs || []; route(); })
    .catch(() => { $main.innerHTML = '<div class="loading">Não foi possível carregar as vagas agora. Tente de novo em instantes.</div>'; });
  window.addEventListener('hashchange', route);
})();
