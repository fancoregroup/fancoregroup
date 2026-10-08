/* Plano combinado no alinhamento de 07–08/10/2026 (Daniel + Lucas): metas, ritmo de verba,
   divisão volume × conversão, diário cruzado e origem dos leads. Usa o mesmo state e filtros do dashboard.js. */
'use strict';
const PLANO={
 agrobar:{verba:{lead:35000,video:4000,google:1000},divisao:{form:70,lp:30},
  semana:{leads:500,qualificados:40,reunioes:10},
  cadeia:'~2.000 leads/mês → 80 reuniões agendadas → 40 realizadas (50%) → 21 propostas → 3 vendas (1 em 7)'},
 estica:{verba:{lead:22000,video:3000},divisao:{form:50,lp:50},
  semana:{leads:150,qualificados:12,reunioes:3},
  cadeia:'600 leads/mês → reuniões realizadas → 6,3 vendas/mês para chegar a 100 unidades em dez/2027'}
}[document.body.dataset.brand];
// Tipo da campanha pelo nome (padrão Cliente|Objetivo|Oferta|MM-AAAA).
function tipoCampanha(nome){const n=(nome||'').toLocaleLowerCase('pt-BR');
 if(/v[ií]deo ?view|\bvv\b|visualiza/.test(n))return 'video';
 if(/tr[aá]fego|\blp\b|landing|convers|site/.test(n))return 'lp';return 'form'}
function campanhaDe(r){return state.data.media.ads[r.ad]?.campaignName||r.campaign}
function diasNoMes(d){const x=new Date(d+'T12:00:00Z');return new Date(Date.UTC(x.getUTCFullYear(),x.getUTCMonth()+1,0)).getUTCDate()}
function barra(label,valor,meta,fmt,extra=''){const p=meta?Math.min(valor/meta*100,100):0,ok=meta&&valor>=meta;
 return `<div class="pl-bar"><div class="pl-l"><b>${esc(label)}</b><span>${fmt(valor)} de ${fmt(meta)} ${extra}</span></div><div class="pl-t"><i class="${ok?'ok':''}" style="width:${p.toFixed(1)}%"></i></div></div>`}
function renderRitmo(){const rows=mediaRows(),end=state.end,ini=end.slice(0,7)+'-01',dia=Number(end.slice(8,10)),tot=diasNoMes(end);
 const mes=state.data.media.rows.filter(r=>within(r.date,ini,end)&&(state.account==='all'||r.account===state.account));
 const g={form:0,lp:0,video:0};for(const r of mes)g[tipoCampanha(campanhaDe(r))]+=Number(r.spend||0);
 const lead=g.form+g.lp,proj=v=>v/dia*tot,v=PLANO.verba;
 let h=barra('Lead + tráfego para LP',lead,v.lead,money,`· projeção no fim do mês ${money(proj(lead))}`)+barra('Video view',g.video,v.video,money,`· projeção ${money(proj(g.video))}`);
 if(v.google)h+=`<p class="note">Google Ads (meta ${money(v.google)}/mês) ainda não entra na coleta automática.</p>`;
 const tl=g.form+g.lp||1,d=PLANO.divisao;
 h+=`<h3>Volume × conversão</h3><p class="note">Combinado: ${d.form}% formulário nativo (volume) e ${d.lp}% campanha para a LP (lead mais qualificado). Campanha classificada pelo nome.</p>`+
  `<div class="pl-split"><i style="width:${(g.form/tl*100).toFixed(1)}%">Formulário ${(g.form/tl*100).toFixed(0)}%</i><i class="lp" style="width:${(g.lp/tl*100).toFixed(1)}%">LP ${(g.lp/tl*100).toFixed(0)}%</i></div><div class="pl-split meta"><i style="width:${d.form}%">Meta ${d.form}%</i><i class="lp" style="width:${d.lp}%">Meta ${d.lp}%</i></div>`;
 return `<div class="panel"><h3>Ritmo da verba no mês (${displayDate(ini)} a ${displayDate(end)}, dia ${dia} de ${tot})</h3>${h}</div>`}
function renderMetasSemana(){const crm=state.data.crm,s=PLANO.semana;const weeks=getWeeks();
 const cel=(v,m)=>v==null?'<td>N/D</td>':`<td class="${v>=m?'ok':'bad'}">${number(v)} <small>/ ${number(m)}</small></td>`;
 const rows=weeks.map((w,i)=>{const held=crm.meetingsAvailable?(crm.meetingEvents||[]).filter(e=>within(e.date,w.start,w.end)).reduce((n,e)=>n+e.count,0):null;
  return `<tr><td>Semana ${i+1}<small>${displayDate(w.start)} a ${displayDate(w.end)}</small></td>${cel(w.media.leads,s.leads)}${cel(crm.available?w.count:null,s.qualificados)}${cel(held,s.reunioes)}</tr>`});
 return `<div class="panel"><h3>Metas da semana</h3><p class="note">Verde = meta batida, vermelho = abaixo. ${esc(PLANO.cadeia)}.</p><div class="table-scroll">${table(['Semana','Leads Meta','Entradas CRM (qualificados)','Reuniões realizadas'],rows)}</div></div>`}
function linhas(series,dias){const W=1000,H=200,L=40,B=175,T=12,n=Math.max(dias.length-1,1);let svg='';
 for(const [nome,vals,cor] of series){const v=vals.filter(x=>x!=null);if(!v.length)continue;const lo=Math.min(...v),hi=Math.max(...v),rg=hi-lo||1;
  const pts=vals.map((x,i)=>x==null?null:[L+(W-L-20)*i/n,B-(B-T)*(x-lo)/rg]).filter(Boolean);
  svg+=`<polyline fill="none" stroke="${cor}" stroke-width="2.5" points="${pts.map(p=>p.join(',')).join(' ')}"><title>${esc(nome)}</title></polyline>`}
 dias.forEach((d,i)=>{if(dias.length<15||i%Math.ceil(dias.length/10)===0)svg+=`<text x="${L+(W-L-20)*i/n}" y="${H-4}" text-anchor="middle">${displayDate(d)}</text>`});
 return `<svg role="img" aria-label="Métricas diárias normalizadas" viewBox="0 0 ${W} ${H}">${svg}</svg>`}
function renderDiario(){const by=group(mediaRows(),r=>r.date).sort((a,b)=>a.key<b.key?-1:1),dias=by.map(d=>d.key);if(!dias.length)return '';
 const cpm=by.map(d=>ratio(d.spend,d.impressions,1000)),cpc=by.map(d=>ratio(d.spend,d.clicks)),ctr=by.map(d=>d.ctr),cpl=by.map(d=>d.cpl);
 const S=[['CPL',cpl,'#e8b04a'],['CPM',cpm,'#7aa7ff'],['CTR',ctr,'#5fd38d'],['CPC',cpc,'#ff7a7a']];
 const ult=by[by.length-1];
 return `<div class="panel"><h3>Diário cruzado: CPL × CPM × CTR × CPC</h3><p class="note">Cada linha na própria escala, para ler tendência: CPM subindo e CTR caindo costuma puxar o CPL no dia seguinte. Último dia (${displayDate(ult.key)}): CPL ${money(ult.cpl)} · CPM ${money(ratio(ult.spend,ult.impressions,1000))} · CTR ${percent(ult.ctr)} · CPC ${money(ratio(ult.spend,ult.clicks))}.</p>${linhas(S,dias)}<div class="legend">${S.map(s=>`<span><i style="background:${s[2]}"></i>${s[0]}</span>`).join('')}</div></div>`}
function renderOrigem(){const m=state.data.media,rows=mediaRows(),tot=sum(rows).leads||1;
 const lista=(gs,nome)=>gs.filter(g=>g.leads>0).sort((a,b)=>b.leads-a.leads).slice(0,6).map(g=>`<div class="pl-o"><span>${esc(nome(g))}</span><div class="pl-t"><i style="width:${(g.leads/tot*100).toFixed(1)}%"></i></div><b>${number(g.leads)} · ${money(g.cpl)}</b></div>`).join('')||empty('Sem leads no recorte.');
 const tipo={form:'Formulário nativo',lp:'Campanha para LP',video:'Video view'};
 return `<div class="panel"><h3>De onde vieram os leads</h3><div class="pl-cols"><div><h4>Canal</h4>${lista(group(rows,r=>tipoCampanha(campanhaDe(r))),g=>tipo[g.key])}</div><div><h4>Campanha</h4>${lista(group(rows,campanhaDe),g=>g.key)}</div><div><h4>Criativo</h4>${lista(group(rows,r=>r.ad),g=>m.ads[g.key]?.name||g.key)}</div></div><p class="note">Leads atribuídos pela Meta. O cruzamento com qualificado/reunião por criativo depende da UTM no CRM.</p></div>`}
function renderPlano(){if(!PLANO||!state.data?.media?.available)return;$('plano-body').innerHTML=renderMetasSemana()+renderRitmo()+renderDiario()+renderOrigem()}
// Atualização contínua: busca o snapshot de novo a cada 5 min e redesenha mantendo os filtros.
setInterval(async()=>{if(!state.data)return;try{const r=await fetch('/api/campaign-reports?brand='+brand,{cache:'no-store'});if(!r.ok)return;const d=await r.json();
 if(d.generatedAt!==state.data.generatedAt){state.data=d;render()}$('stamp-check').textContent='verificado às '+new Date().toLocaleTimeString('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit'})}catch{}},300000);
