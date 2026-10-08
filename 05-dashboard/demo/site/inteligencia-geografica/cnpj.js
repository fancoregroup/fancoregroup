'use strict';
window.GeoCnpjUI={async mount({num,esc}){
 const sources={},indexes={},errors=[];
 await Promise.all(['food','estica'].map(async key=>{try{const r=await fetch(`dados/${key==='food'?'cnpj':'estica'}.json`);if(!r.ok)throw Error();const d=await r.json();if(!Array.isArray(d.cities)||!Array.isArray(d.taxonomy)||!d.reference)throw Error();indexes[key]=new Map(d.cities.map(c=>[c.id,c]));sources[key]=d;}catch(_){errors.push(key);}}));
 const common=[
  {id:'bars',label:'Bares e similares',source:'food',cat:'bars',symbol:'B',tone:'orange'},
  {id:'academias',label:'Academias',source:'estica',cat:'academias',symbol:'A',tone:'text'},
  {id:'pilates',label:'Pilates no nome',source:'estica',cat:'pilates',symbol:'P',tone:'boundary'},
  {id:'restaurantes',label:'Restaurantes',source:'food',cat:'restaurantes',symbol:'R',tone:'orange'},
  {id:'fisioterapia',label:'Fisioterapia',source:'estica',cat:'fisioterapia',symbol:'F',tone:'text'}
 ];
 const more=(sources.food?.taxonomy||[]).filter(c=>!['restaurantes'].includes(c.id)).map(c=>({id:c.id,label:c.label,source:'food',cat:c.id,symbol:'•',tone:'orange'}));
 const niches=[...common,...more];
 function count(id,niche,mode='primary'){
  const def=typeof niche==='string'?niches.find(n=>n.id===niche):niche,r=indexes[def?.source]?.get(id);if(!def||!r?.covered)return null;
  if(def.cat==='bars')return r[mode==='primary'?'barsPrimary':'barsAny'];
  if(def.cat==='pilates')return r[mode==='primary'?'pilatesPrimary':'pilatesAny'];
  const i=sources[def.source].taxonomy.findIndex(c=>c.id===def.cat);return i<0?null:r[mode][i];
 }
 const safe=v=>'"'+String(v??'').replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"';
 function enrichCSV(original,cities,mode='primary',active=[]){const extra=[['Vínculo CNAE',...common.map(n=>n.label+' CNPJs ativos'),'Referência CNPJ','Camadas de nichos ativas','Fonte CNPJ'],...cities.map(c=>[mode==='primary'?'principal':'principal_ou_secundaria',...common.map(n=>count(c.id,n,mode)),'2026-09',active.join(', '),'Receita Federal'])];return original.split('\r\n').map((line,i)=>line+';'+extra[i].map(safe).join(';')).join('\r\n');}
 function detailHTML(id,mode='primary'){
  return `<section class="niche-city"><div class="panel-heading"><h3>Nichos nesta cidade</h3><span>Receita Federal · set/2026</span></div><p class="fine">${mode==='primary'?'Atividade principal':'Principal ou secundária'} · CNPJs ativos, sem confirmação de funcionamento.</p><div class="niche-city-grid">${common.map(n=>`<button data-enable-niche="${n.id}" data-niche-city="${id}"><span>${esc(n.label)}</span><strong>${num(count(id,n,mode))}</strong><small>Ver no mapa</small></button>`).join('')}</div><p class="fine">Pilates é um subconjunto identificado pelo nome. Não some aos demais grupos. Academias inclui condicionamento e instrutores individuais; fisioterapia é atividade relacionada.</p><details><summary>Ver as 15 atividades de alimentação e lazer</summary><div class="table-wrap"><table><tbody>${(sources.food?.taxonomy||[]).map(c=>`<tr><th>${esc(c.label)}</th><td>${num(count(id,{source:'food',cat:c.id},mode))}</td></tr>`).join('')}</tbody></table></div></details></section>`;
 }
 function comparisonHTML(cities,mode='primary'){return common.map(n=>`<tr><th>${esc(n.label)}<small>CNPJ ${mode==='primary'?'principal':'principal ou secundário'}</small></th>${cities.map(c=>`<td><strong>${num(count(c.id,n,mode))}</strong><small>Receita Federal · set/2026</small></td>`).join('')}</tr>`).join('');}
 return {sources,indexes,errors,niches,common,count,enrichCSV,detailHTML,comparisonHTML,available:n=>!!sources[(typeof n==='string'?niches.find(x=>x.id===n):n)?.source]};
}};
