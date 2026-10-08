'use strict';
window.GeoExpansionUI=(()=>{
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const number=value=>new Intl.NumberFormat('pt-BR',{maximumFractionDigits:2}).format(value);
 const safeURL=url=>typeof url==='string'&&/^https?:\/\//i.test(url)?url:null;
 const format=(value,unit)=>!Number.isFinite(value)?'Sem dado':(unit?.startsWith('R$')?'R$ ':'')+number(value)+(unit==='%'?'%':'');
 const review=meta=>meta?.publicationStatus==='review'?'<span class="exp-review">Em revisão</span>':'';
 const stateOf=value=>value?.expansion||value||window.GeoExpansion?.state||{};
 const statuses={ready:'Disponível',complete:'Adquirida',downloaded:'Adquirida',acquired:'Adquirida',integrated:'Integrada',published:'Disponível',review:'Em revisão',partial:'Cobertura parcial',not_integrated:'Adquirida, sem indicador municipal',downloaded_not_integrated:'Adquirida, sem indicador municipal',unavailable:'Indisponível',blocked:'Indisponível',pending:'Pendente',prepared_local:'Preparada para análise local',prepared_regional:'Preparada por região',processing_pending:'Tratamento pendente'};
 function summaryHTML(input){
  const state=stateOf(input);if(state.status==='not_loaded')return '';
  if(state.status!=='ready')return '<section class="exp-summary exp-unavailable" role="status"><strong>Contexto ampliado indisponível</strong><p>A base de novos indicadores não carregou. As demais análises continuam disponíveis.</p></section>';
  return `<section class="exp-summary"><div><span class="exp-eyebrow">Contexto para expansão</span><h3>Mais dados para investigar cada cidade</h3><p>${number(state.indicatorCount||0)} indicadores · ${number(state.cityCount||0)} municípios com registros na nova base</p></div><p class="exp-summary-note">Fontes e anos próprios. Matrículas, vínculos de trabalho e cadastros turísticos não são pessoas adicionais. O índice da marca mantém seus pesos.</p>${state.reviewCount?`<span class="exp-review">${number(state.reviewCount)} indicadores em revisão</span>`:''}</section>`;
 }
 function sourcesHTML(input){
  const state=stateOf(input),sources=state.sources||[];if(!sources.length)return '';
  return `<section class="exp-sources" aria-label="Fontes dos novos indicadores"><h3>Origem, cobertura e limites</h3><p>Uma fonte adquirida pode exigir tratamento antes de virar indicador. Consulte o estado de cada base.</p><div class="exp-source-list">${sources.map(s=>{
   const url=safeURL(s.url),status=statuses[s.status]||String(s.status||'Consultar cobertura').replaceAll('_',' '),coverage=typeof s.coverage==='string'?s.coverage:typeof s.coverage==='number'?number(s.coverage)+' registros':s.coverage&&typeof s.coverage==='object'?Object.entries(s.coverage).filter(([,v])=>typeof v==='string'||typeof v==='number').map(([k,v])=>k.replaceAll('_',' ')+': '+(typeof v==='number'?number(v):v)).join(' · '):'';
   return `<details class="exp-source" data-exp-source="${escape(s.id)}"><summary><span><strong>${escape(s.label||s.id)}</strong><small>${escape(s.reference||'Referência no documento')}</small></span><span class="exp-source-status">${escape(status)}</span></summary><div>${s.note?`<p>${escape(s.note)}</p>`:''}${coverage?`<p class="exp-coverage">${escape(coverage)}</p>`:''}${url?`<a href="${escape(url)}" target="_blank" rel="noopener">Consultar fonte oficial ↗</a>`:''}</div></details>`;
  }).join('')}</div>${coverageHTML(state)}</section>`;
 }
 function coverageHTML(state){
  const indicators=Object.entries(state.indicators||{});if(!indicators.length)return '';
  return `<details class="exp-source exp-metric-coverage"><summary><strong>Cobertura de cada indicador</strong><span>${number(indicators.length)} indicadores</span></summary><p>Municípios com valor numérico, incluindo zero informado. Ausências ficam fora das médias. Cobertura não mede precisão.</p><div class="exp-city-table-wrap" tabindex="0" role="region" aria-label="Cobertura municipal por indicador"><table class="exp-city-table"><thead><tr><th>Indicador</th><th>Ano</th><th>Com dado</th><th>Total da base</th></tr></thead><tbody>${indicators.map(([key,m])=>`<tr data-exp-coverage="${escape(key)}"><th>${escape(m.label)} ${review(m)}</th><td>${escape((m.years||[]).join(', '))}</td><td>${number(m.coverage?.valid||0)}</td><td>${number(m.coverage?.total||0)}</td></tr>`).join('')}</tbody></table></div></details>`;
 }
 function cityHTML(snapshot){
  const rows=(snapshot?.metrics||[]).filter(m=>m.expansion||m.key?.startsWith('exp_'));if(!rows.length)return '';
  const groupOf=m=>m.group||window.GeoExpansion?.group(m)||'Contexto de expansão',groups=[...new Set(rows.map(groupOf))];
  return `<section class="exp-city" aria-label="Indicadores adicionais de expansão"><div class="exp-city-heading"><h3>Aprofunde por tema</h3><p>Compare a cidade com a média municipal do Brasil e da rede selecionada, no mesmo ano.</p></div>${groups.map(group=>`<details class="exp-theme"><summary><span>${escape(group)}</span><small>${rows.filter(m=>groupOf(m)===group).length} indicadores</small></summary><div class="exp-city-table-wrap" tabindex="0" role="region" aria-label="Indicadores de ${escape(group)}"><table class="exp-city-table"><thead><tr><th>Indicador</th><th>Cidade</th><th>Média Brasil</th><th>Média da rede</th></tr></thead><tbody>${rows.filter(m=>groupOf(m)===group).map(m=>`<tr data-exp-metric="${escape(m.key)}"><th>${escape(m.label)} ${review(m)}<small>${escape(m.unit)} · ${escape(m.year)}</small>${m.note?`<details class="exp-definition"><summary>Definição e limites</summary><p>${escape(m.note)}</p>${safeURL(m.source)?`<a href="${escape(m.source)}" target="_blank" rel="noopener">Fonte oficial ↗</a>`:''}</details>`:''}</th><td>${format(m.value,m.unit)}</td><td>${format(m.national?.mean,m.unit)}<small>n = ${number(m.national?.n||0)}</small></td><td>${format(m.network?.mean,m.unit)}<small>n = ${number(m.network?.n||0)}</small></td></tr>`).join('')}</tbody></table></div></details>`).join('')}</section>`;
 }
 return {summaryHTML,sourcesHTML,cityHTML};
})();
