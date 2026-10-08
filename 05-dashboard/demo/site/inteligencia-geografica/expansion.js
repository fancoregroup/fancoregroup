'use strict';
(function(root,factory){const api=factory();if(typeof module==='object')module.exports=api;else root.GeoExpansion=api;})(typeof globalThis!=='undefined'?globalThis:this,()=>{
 const dimensions={population:'Público e população',publico:'Público e população',demography:'Público e população',income:'Renda e consumo',renda:'Renda e consumo',labor:'Trabalho e remuneração',trabalho:'Trabalho e remuneração',education:'Ensino superior',educacao:'Ensino superior',tourism:'Turismo e hospedagem',turismo:'Turismo e hospedagem',events:'Eventos',eventos:'Eventos',agro:'Economia agropecuária',agriculture:'Economia agropecuária',regional:'Influência regional',territory:'Influência regional'};
 let state={status:'not_loaded',indicatorCount:0,cityCount:0,sources:[],notes:[]};
 const finite=Number.isFinite;
 const isKey=key=>typeof key==='string'&&/^exp_[A-Za-z0-9_]+$/.test(key);
 const norm=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 const group=meta=>dimensions[norm(meta?.dimension)]||String(meta?.dimension||'Contexto de expansão').replaceAll('_',' ');
 const yearFor=(meta,record)=>record?.year!=null?String(record.year):String([...(meta?.years||[])].sort((a,b)=>String(a).localeCompare(String(b),undefined,{numeric:true})).at(-1)??'');
 const aggregationLabel=meta=>meta?.aggregation==='sum'?'Soma dos municípios com dado':meta?.aggregation==='ratio'?'Razão das somas: numerador e denominador no mesmo ano':'Média dos valores municipais com dado';

 function merge(data,payload){
  if(!data||!Array.isArray(data.cities)||!data.indicators)throw Error('Base municipal inválida.');
  if(payload?.version!==1||!payload.indicators||!payload.cities||Array.isArray(payload.cities))throw Error('Formato dos novos indicadores indisponível.');
  const accepted={},notes=[];
  for(const [key,raw] of Object.entries(payload.indicators)){
   if(!isKey(key)||!raw||typeof raw.label!=='string'||typeof raw.unit!=='string'||!Array.isArray(raw.years)||!raw.years.length){notes.push('Indicador inválido ignorado: '+key);continue;}
   const aggregation=['sum','mean','ratio'].includes(raw.aggregation)?raw.aggregation:'mean';
   accepted[key]={...raw,years:[...raw.years],aggregation,expansion:true,group:group(raw),benchmarkAggregation:'mean',coverage:{valid:0,total:data.cities.length,byYear:{}},aggregationLabel:aggregationLabel({aggregation})};
  }
  if(!Object.keys(accepted).length)throw Error('Nenhum indicador válido na nova base.');
  let cityCount=0,validValues=0,missingValues=0,rejectedValues=0;
  const known=new Set(data.cities.map(c=>String(c.id)));
  for(const city of data.cities){
   const present=payload.cities[String(city.id)],row=present||{};if(present)cityCount++;city.metrics=city.metrics||{};
   for(const key of Object.keys(accepted)){
    const record=row[key],meta=accepted[key];
    const year=record?.year,validYear=year!=null&&meta.years.some(y=>String(y)===String(year));
    const value=validYear&&finite(record?.value)?record.value:null;
    if(record?.value!=null&&(!validYear||!finite(record.value)))rejectedValues++;
    city.metrics[key]={value,year:validYear?year:yearFor(meta)};if(value===null)missingValues++;else{validValues++;meta.coverage.valid++;const y=String(year);meta.coverage.byYear[y]=(meta.coverage.byYear[y]||0)+1;}
   }
  }
  Object.assign(data.indicators,accepted);
  const sources=Array.isArray(payload.sources)?payload.sources.map(s=>({...s})):[];
  state={status:'ready',version:payload.version,generatedAt:payload.generatedAt,indicatorCount:Object.keys(accepted).length,
   cityCount,validValues,missingValues,rejectedValues,unknownCityCount:Object.keys(payload.cities).filter(id=>!known.has(id)).length,
   reviewCount:Object.values(accepted).filter(m=>m.publicationStatus==='review').length,
   dimensions:[...new Set(Object.values(accepted).map(group))],indicators:accepted,sources,notes};
  data.expansion=state;return state;
 }

 async function load(data,{source,url='dados/expansion-data.json'}={}){
  try{if(!source){const response=await fetch(url);if(!response.ok)throw Error('A nova base não respondeu ('+response.status+').');source=await response.json();}return merge(data,source);}
  catch(error){state={status:'unavailable',indicatorCount:0,cityCount:0,sources:[],notes:[error.message],error:error.message};data.expansion=state;return state;}
 }

 function aggregate(cities,key,{indicators={},year,mode='territory'}={}){
  const meta=indicators[key]||{},referenceYear=String(year??yearFor(meta));
  const included=[];let numerator=0,denominator=0;
  for(const city of cities){
   const value=city?.metrics?.[key];if(!finite(value?.value)||String(value.year)!==referenceYear)continue;
   if(mode==='territory'&&meta.aggregation==='ratio'){
    const a=city.metrics[meta.numerator],b=city.metrics[meta.denominator];
    if(!finite(a?.value)||!finite(b?.value)||b.value<=0||String(a.year)!==referenceYear||String(b.year)!==referenceYear)continue;
    numerator+=a.value;denominator+=b.value;
   }
   included.push(value.value);
  }
  const n=included.length,total=included.reduce((a,b)=>a+b,0),aggregation=mode==='benchmark'?'mean':meta.aggregation||'mean';
  const value=!n?null:aggregation==='ratio'?(denominator>0?numerator/denominator*(meta.unit==='%'?100:1):null):aggregation==='sum'?total:total/n;
  return {value,mean:value,n,selected:cities.length,year:referenceYear,aggregation,label:aggregationLabel({aggregation}),
   ...(aggregation==='ratio'?{numerator:n?numerator:null,denominator:n?denominator:null}:{}),publicationStatus:meta.publicationStatus||null};
 }

 function presets(data){
  const valid=new Set(Object.keys(data?.indicators||{}));
  return [
   {id:'exp-public',label:'Público e renda',keys:['exp_ad18','exp_urb','exp_rur','medianIncome','exp_r0']},
   {id:'exp-work',label:'Trabalho formal',keys:['exp_rais','exp_rw','exp_rv','exp_cs','exp_c12','exp_c24']},
   {id:'exp-education',label:'Ensino e turismo',keys:['exp_pres','exp_ead','exp_agmat','exp_hosp','exp_leitos','exp_org']},
   {id:'exp-agro',label:'Economia agropecuária',keys:['exp_pam','exp_pamha','exp_sojavar','exp_bov','exp_bovvar','exp_ppm']}
  ].map(p=>({...p,keys:p.keys.filter(k=>valid.has(k))})).filter(p=>p.keys.some(k=>k.startsWith('exp_')));
 }
 return {load,merge,aggregate,group,yearFor,aggregationLabel,presets,get state(){return state;}};
});
