'use strict';
(function(root,factory){const api=factory();if(typeof module==='object')module.exports=api;else root.GeoCompetition=api;})(typeof globalThis!=='undefined'?globalThis:this,()=>{
  const keys=['competition','fit','market','economy'];
  const defaults={agrobar:{competition:60,fit:25,market:15,economy:0},estica:{competition:50,fit:20,market:30,economy:0}};
  const labels=brand=>({competition:'Menor pressão competitiva',fit:brand==='agrobar'?'Afinidade agro (aproximação)':'Concentração urbana',market:'Escala e renda',economy:'PIB municipal'});
  const norm=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const validWeights=w=>w&&keys.every(k=>Number.isFinite(w[k])&&w[k]>=0&&w[k]<=100)&&keys.some(k=>w[k]>0);
  const round=n=>Math.round((n+Number.EPSILON)*100)/100;
  function score(row,brand,weights){
    if(!validWeights(weights))return null;
    const total=keys.reduce((s,k)=>s+weights[k],0);
    if(defaults[brand]&&keys.every(k=>Math.abs(weights[k]/total-defaults[brand][k]/100)<1e-10))return row[brand]?.baseline??null;
    const used=keys.filter(k=>weights[k]>0);
    if(used.some(k=>!Number.isFinite(row[brand]?.[k])))return null;
    return round(used.reduce((s,k)=>s+weights[k]*row[brand][k],0)/used.reduce((s,k)=>s+weights[k],0));
  }
  function ranked(rows,brand,weights){
    const result=rows.map(r=>({...r,score:score(r,brand,weights)})).sort((a,b)=>(b.score??-1)-(a.score??-1)||a.name.localeCompare(b.name,'pt-BR')||a.id.localeCompare(b.id));
    let last=null,rank=0;
    result.forEach((r,i)=>{if(r.score!==last)rank=i+1;r.rank=r.score===null?null:rank;last=r.score;});return result;
  }
  function filter(rows,brand,f,network){
    const between=(v,min,max)=>(min===''||min===undefined||(Number.isFinite(v)&&v>=Number(min)))&&(max===''||max===undefined||(Number.isFinite(v)&&v<=Number(max)));
    return rows.filter(r=>{
      const units=network.at(r.id,brand),components=r[brand],rate=brand==='agrobar'?r.barRate:r.gymRate;
      return (!f.query||norm(r.name+' '+r.uf+' '+r.id).includes(norm(f.query)))&&(!f.uf||r.uf===f.uf)&&(!f.region||r.region===f.region)
        &&(!f.intermediateId||r.intermediateId===f.intermediateId)&&(!f.immediateId||r.immediateId===f.immediateId)&&between(r.gdpPerCapita,f.minGdpPerCapita,'')
        &&between(r.population,f.minPop,f.maxPop)&&between(r.income,f.minIncome,'')&&between(rate,'',f.maxRate)&&between(r.agroShare,f.minAgro,'')&&between(r.gdp,f.minGdp,'')
        &&(!f.status||(f.status==='new'?!units.length:f.status==='history'?units.some(x=>['fechou','voltou'].includes(x.status)):units.some(x=>x.status===f.status)))
        &&(!f.quadrant||(Number.isFinite(components.competition)&&Number.isFinite(components.market)&&quadrant(r,brand)===f.quadrant))
        &&(!f.onlySaved||f.saved?.includes(r.id));
    });
  }
  function quadrant(r,b){const c=r[b];return c.competition>=50?(c.market>=50?'study':'scale'):(c.market>=50?'compete':'caution');}
  const quadrants={study:'Menor pressão + maior escala/renda',scale:'Menor pressão + menor escala/renda',compete:'Maior pressão + maior escala/renda',caution:'Maior pressão + menor escala/renda'};
  function csv(rows,brand,weights,filters,version,network,extraColumns=[]){
    const safe=v=>'"'+String(v??'').replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"';
    const headers=['IBGE','Município','UF','Marca','Índice cenário 0-100','Índice base 0-100','Posição nacional cenário (empates)','Grupo concorrência','Cidades no grupo',...keys.map(k=>labels(brand)[k]+' 0-100'),'População 2026','Renda mediana por pessoa R$/mês 2022','Densidade hab/km² 2022','PIB R$ 2023','PIB per capita R$ 2023','Região intermediária','Região imediata','Papel intermediária','Papel imediata','VAB agro R$ 2021','Agro no VAB % 2021','Caminhonetes nos leves % jul/2026','Bares principal set/2026','Bares por 10 mil hab 2026','Academias principal set/2026','Academias por 10 mil hab 2026','Pilates no nome principal set/2026','Pilates por 10 mil hab 2026','Situação e referência da marca','Pesos','Filtros','Versão','Estado'];
    return '\uFEFF'+[[...headers,...extraColumns.map(c=>c.label)],...rows.map(r=>[r.id,r.name,r.uf,brand,r.score,r[brand].baseline,r.rank,r.group,r.peerCount,...keys.map(k=>r[brand][k]),r.population,r.income,r.density,r.gdp,r.gdpPerCapita,r.intermediate,r.immediate,r.intermediateRole,r.immediateRole,r.agroGva,r.agroShare,r.pickups,r.bars,r.barRate,r.gyms,r.gymRate,r.pilates,r.pilatesRate,network.at(r.id,brand).map(x=>x.status+' · '+x.reference).join(' | ')||'Sem registro',JSON.stringify(weights),JSON.stringify(filters),version,'Exploratório · Revisão',...extraColumns.map(c=>c.value(r))])].map(r=>r.map(safe).join(';')).join('\r\n');
  }
  return {keys,labels,score,ranked,filter,validWeights,quadrant,quadrants,csv};
});
