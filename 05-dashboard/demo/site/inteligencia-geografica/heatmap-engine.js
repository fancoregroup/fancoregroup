'use strict';
(function(root,factory){const api=factory(typeof module==='object'?require('./expansion.js'):root.GeoExpansion);if(typeof module==='object')module.exports=api;else root.GeoHeatEngine=api;})(typeof globalThis!=='undefined'?globalThis:this,E=>{
 const levels={macro:'Grandes regiões',intermediate:'Regiões intermediárias',immediate:'Regiões imediatas',city:'Municípios'};
 const macroIds={'Norte':'1','Nordeste':'2','Sudeste':'3','Sul':'4','Centro-Oeste':'5'};
 const sumKeys=new Set(['population','censusPopulation','area','gdp','agroGva','establishments','companies','employment','salaried','foodEstablishments','foodEmployment','youngAdults','seniors']);
 function create({data,regional,getCompetition=()=>null,getAssessment=()=>null,getScores=()=>new Map(),cnpj,ages,methodology=getAssessment()?.methodology||globalThis.GeoAssessmentMethodology}){
  const cities=new Map(data.cities.map(c=>[c.id,c])),regions=new Map((regional?.cities||[]).map(c=>[c.id,c]));
  const metrics=[{id:'competition',label:'Índice legado '+(getCompetition()?.brand==='estica'?'Estica':'Agrobar'),unit:'pontos',year:'Cenário legado atual',aggregation:'mean',group:'Modelos legados'},...Object.entries(data.indicators).filter(([,m])=>m.publicSelectable!==false).map(([id,m])=>({id,label:m.label+(m.publicationStatus==='review'?' · Em revisão':''),unit:m.unit,year:m.expansion?E.yearFor(m):m.years.join(', '),referenceYear:m.expansion?E.yearFor(m):null,aggregation:m.expansion?m.aggregation:id==='density'?'density':sumKeys.has(id)?'sum':'mean',group:m.expansion?m.group:'Economia e população',expansion:!!m.expansion,source:m.source,note:m.note,publicationStatus:m.publicationStatus}))];
  if(getAssessment())metrics.unshift({...methodology.definitionFor('assessment:demandResident'),id:'assessment:demandResident',aggregation:'mean',assessment:true,publicationStatus:'review'});
  if(!metrics.some(m=>m.id==='gdpPerCapita'))metrics.push({id:'gdpPerCapita',label:'PIB per capita',unit:'R$',year:'2023',aggregation:'mean',group:'Economia e população'});
  metrics.push({id:'customScore',label:'Índice personalizado de indicadores',unit:'pontos',year:'Pesos personalizados',aggregation:'mean',group:'Modelos legados e personalizados'});
  for(const n of cnpj?.niches||[]){if(metrics.some(m=>m.id==='niche:'+n.id))continue;metrics.push({id:'niche:'+n.id,label:n.label,unit:'CNPJs',year:'2026-09',aggregation:'sum',group:'Estabelecimentos · atividade principal',disabled:!cnpj.available(n)});metrics.push({id:'nicheAny:'+n.id,label:n.label,unit:'CNPJs',year:'2026-09',aggregation:'sum',group:'Estabelecimentos · principal ou secundária',disabled:!cnpj.available(n)});}
  for(const m of metrics){const layer=methodology?.layerForMetric(m.id,m),definition=methodology?.layers?.[layer];if(definition)m.group=definition.label||definition.title||m.group;m.layer=layer||null;m.aggregationLabel=m.assessment?'Média das notas municipais completas':m.expansion?E.aggregationLabel(m):m.aggregation==='sum'?'Soma dos municípios do recorte':m.aggregation==='density'?'População do Censo / área dos municípios com dados':'Média dos municípios do recorte';}
  const meta=new Map(metrics.map(m=>[m.id,m]));let lastRows,competitionIndex=new Map();
  function competitionValues(){const rows=getCompetition()?.all||[];if(rows!==lastRows){lastRows=rows;competitionIndex=new Map(rows.map(r=>[r.id,r.score]));}return competitionIndex;}
  function cityValue(id,metric){const c=cities.get(String(id));if(!c)return null;let v;
   if(metric==='assessment:demandResident')v=getAssessment()?.residentValue(c.id,getCompetition()?.brand||'agrobar');
   else if(metric==='competition')v=competitionValues().get(c.id);
   else if(metric==='customScore')v=getScores()?.get(c.id);
   else if(metric.startsWith('niche:')||metric.startsWith('nicheAny:'))v=cnpj?.count(c.id,metric.split(':')[1],metric.startsWith('nicheAny:')?'any':'primary');
   else if(metric==='gdpPerCapita')v=regions.get(c.id)?.gdpPerCapita??c.metrics.gdpPerCapita?.value;
   else{const record=c.metrics[metric],m=meta.get(metric);v=m?.expansion&&String(record?.year)!==m.referenceYear?null:record?.value;}
   return Number.isFinite(v)?v:null;
  }
  const groupIndex={};
  for(const level of Object.keys(levels)){
   const grouped=new Map();
   for(const c of data.cities){const r=regions.get(c.id);let id,name;
    if(level==='city'){id=c.id;name=c.name;}
    else if(level==='macro'){id=r?.macroId||macroIds[c.region];name=r?.macro||c.region;}
    else{id=r?.[level+'Id'];name=r?.[level];}
    if(!id)continue;id=String(id);if(!grouped.has(id))grouped.set(id,{id,name,uf:level==='macro'?'':c.uf,ids:[]});grouped.get(id).ids.push(c.id);
   }groupIndex[level]=[...grouped.values()];
  }
  function groups(metric,level,ids=null){const m=meta.get(metric);if(!m||!groupIndex[level])return [];const accepted=ids===null?null:new Set(ids.map(String));
   return groupIndex[level].flatMap(g=>{const selected=accepted?g.ids.filter(id=>accepted.has(id)):g.ids;if(!selected.length)return [];
    let n=0,value=null;
    if(m.expansion&&level!=='city'){const aggregated=E.aggregate(selected.map(id=>cities.get(id)),metric,{indicators:data.indicators,year:m.referenceYear});value=aggregated.value;n=aggregated.n;
    }else if(m.aggregation==='density'&&level!=='city'){let population=0,area=0;for(const id of selected){const c=cities.get(id),p=c.metrics.censusPopulation,a=c.metrics.area;if(String(p?.year)==='2022'&&String(a?.year)==='2022'&&Number.isFinite(p.value)&&Number.isFinite(a.value)&&a.value>0){population+=p.value;area+=a.value;n++;}}if(area>0)value=population/area;
    }else{const values=selected.map(id=>cityValue(id,metric)).filter(Number.isFinite);n=values.length;if(n)value=m.aggregation==='sum'?values.reduce((a,b)=>a+b,0):values.reduce((a,b)=>a+b,0)/n;}
    return [{id:g.id,name:g.name,uf:g.uf,value,n,total:g.ids.length,selected:selected.length,ids:[...selected],unit:m.unit,year:m.year,aggregation:m.aggregation,aggregationLabel:level==='city'?'Valor municipal':m.aggregationLabel}];
   });
  }
  return {metrics,groups,cityValue,levels};
 }
 return {create,levels};
});
