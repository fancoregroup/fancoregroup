'use strict';
(function(root,factory){const api=factory();if(typeof module==='object')module.exports=api;else root.GeoAges=api;})(typeof globalThis!=='undefined'?globalThis:this,()=>{
  const source='https://sidra.ibge.gov.br/tabela/9514';
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const num=(value,digits=0)=>value===null||value===undefined?'Sem dado':new Intl.NumberFormat('pt-BR',{maximumFractionDigits:digits}).format(value);
  const safe=value=>'"'+String(value??'').replaceAll('"','""')+'"';
  async function mount(){
    const response=await fetch('dados/idades-municipios.json');
    if(!response.ok)throw Error('Base etária indisponível.');
    const data=await response.json();
    if(data.bands?.length!==21||Object.keys(data.cities||{}).length!==5570)throw Error('Base etária incompleta.');
    const bands=data.bands;
    const at=code=>data.cities[code]||null;
    const rate=(code,band)=>{const city=at(code),position=bands.findIndex(item=>item.id===band);return city&&position>=0?city.total[position]/city.population*100:null;};
    const label=band=>bands.find(item=>item.id===band)?.label||'Faixa etária';
    function detailHTML(code){
      const city=at(code);
      if(!city)return '<article class="age-profile"><h3>Faixas etárias</h3><p class="fine">Sem recorte municipal no Censo 2022 para esta cidade.</p></article>';
      const groups=[['0 a 19 anos',0,4],['20 a 39 anos',4,8],['40 a 59 anos',8,12],['60 a 74 anos',12,15],['75 anos ou mais',15,21]];
      const cards=groups.map(([name,start,end])=>{const value=city.total.slice(start,end).reduce((sum,item)=>sum+item,0);return `<div class="age-group"><span>${name}</span><strong>${num(value)}</strong><small>${num(100*value/city.population,1)}% da população</small></div>`;}).join('');
      return `<article class="age-profile"><h3>Perfil de idade · Censo 2022</h3><p class="fine">${num(city.population)} moradores no Censo. Os grupos abaixo somam a população recenseada; não são projeções de 2026.</p><div class="age-groups">${cards}</div><p class="fine"><a href="${source}" target="_blank" rel="noopener">IBGE · Censo 2022</a></p></article>`;
    }
    function comparisonHTML(cities){const groups=[['0 a 19 anos',0,4],['20 a 39 anos',4,8],['40 a 59 anos',8,12],['60 a 74 anos',12,15],['75 anos ou mais',15,21]];return groups.map(([label,start,end])=>`<tr><th>${label}<small style="display:block">Censo 2022 · população por idade</small></th>${cities.map(city=>{const row=at(city.id),total=row?.total.slice(start,end).reduce((sum,n)=>sum+n,0);return `<td>${row?`<strong>${num(total)} · ${num(100*total/row.population,1)}%</strong>`:'Sem dado'}</td>`;}).join('')}</tr>`).join('');}
    function enrichCSV(original,cities){
      const extra=[['Censo 2022 total','Idade presumida total','Idade presumida % da população',...bands.flatMap(band=>[`${band.label} · pessoas`,`${band.label} · % da população`,`${band.label} · idade presumida · pessoas`,`${band.label} · idade presumida · % da população`]),'Fonte etária'],...cities.map(city=>{const row=at(city.id);return row?[row.population,row.presumedPopulation,row.presumedPopulationPct,...bands.flatMap((band,index)=>[row.total[index],Number((100*row.total[index]/row.population).toFixed(4)),row.presumed[index],row.presumedPct[index]??0]),source]:['','','',...bands.flatMap(()=>['','','','']),source];})];
      return original.split('\r\n').map((line,index)=>line+';'+extra[index].map(safe).join(';')).join('\r\n');
    }
    return {data,bands,at,rate,label,detailHTML,comparisonHTML,enrichCSV};
  }
  return {mount};
});
