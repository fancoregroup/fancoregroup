'use strict';
(function(root,factory){const api=factory(typeof module==='object'?require('./assessment-methodology.js'):root.GeoAssessmentMethodology);if(typeof module==='object')module.exports=api;else root.GeoCityAssessment=api;})(typeof globalThis!=='undefined'?globalThis:this,M=>{
 const finite=Number.isFinite;
 const missingLabels={indicator_unavailable:'Indicador não carregado.',no_observation:'Sem observação numérica na fonte carregada.',invalid_value:'Valor incompatível com a definição.',invalid_unit:'Unidade diferente da definição metodológica.',incompatible_period:'Período diferente de 2022.',under_review:'Indicador em revisão; não pontua.',methodology_unavailable:'Esta marca ainda não tem metodologia própria nesta versão.'};
 const average=values=>{let sum=0,n=0;for(const value of values)if(finite(value)){sum+=value;n++;}return {mean:n?sum/n:null,n};};
 function percentiles(values){
  const sorted=values.filter(finite).sort((a,b)=>a-b),lookup=new Map();
  for(let i=0;i<sorted.length;){let j=i;while(j+1<sorted.length&&sorted[j+1]===sorted[i])j++;lookup.set(sorted[i],sorted.length===1?50:100*(i+j)/(2*(sorted.length-1)));i=j+1;}
  return {lookup,n:sorted.length,discriminating:lookup.size>1};
 }
 function create({data,networks={records:[]},competition}={}){
  if(!data?.indicators||!Array.isArray(data.cities))throw Error('Base municipal indisponível para avaliação.');
  const cities=new Map(data.cities.map(c=>[String(c.id),c]));if(cities.size!==data.cities.length)throw Error('Município duplicado na base da avaliação.');
  const definitions=Object.fromEntries(Object.entries(data.indicators).map(([key,meta])=>[key,M.definitionFor(key,meta)]));
  const candidateKeys=[...Object.keys(definitions),'gdpPerCapita','pickups','bars','nightlife','barRate','nightlifeRate','gyms','gymRate','pilates','pilatesRate',...['macro','intermediate','immediate'].flatMap(level=>[level+':share',level+':rank',...(level==='macro'?[]:[level+':pole'])])];
  const layerKeys=Object.fromEntries(Object.keys(M.layers).map(layer=>[layer,[...new Set(candidateKeys.filter(key=>M.layerForMetric(key,definitions[key])===layer))]]));
  const records=(networks.records||[]).map(r=>({id:String(r.id),brand:r.brand,status:r.status}));
  const cohorts=new Map(),core=new Map(),distributions=new Map(),rawNational=new Map(),referenceCache=new Map();
  const source=typeof competition==='function'?competition()?.source:competition?.source||competition;
  const legacyRows=new Map((source?.cities||[]).map(c=>[String(c.id),c]));
  const generatedAt=data.expansion?.generatedAt||data.generatedAt||null;
  function observe(city,component){
   const meta=data.indicators[component.key],r=city.metrics?.[component.key];let reason=null;
   if(!meta)reason='indicator_unavailable';else if(meta.publicationStatus==='review')reason='under_review';else if(meta.unit!==component.unit)reason='invalid_unit';else if(!Array.isArray(meta.years)||!meta.years.some(y=>String(y)===component.year))reason='incompatible_period';else if(r?.value==null)reason='no_observation';else if(!finite(r.value)||r.value<0)reason='invalid_value';else if(String(r.year)!==component.year)reason='incompatible_period';
   return {value:reason?null:r.value,year:r?.year==null?component.year:String(r.year),missingReason:reason,missingLabel:reason?missingLabels[reason]:null,dataNature:reason==='under_review'?'review':definitions[component.key]?.dataNature||'unspecified'};
  }
  for(const c of M.residentComponents){const observed=[...cities.values()].map(city=>observe(city,c).value);distributions.set(c.key,percentiles(observed));rawNational.set(c.key,average(observed));}
  for(const city of cities.values()){
   const components=M.residentComponents.map(c=>{const observation=observe(city,c),distribution=distributions.get(c.key);return {...c,...observation,percentile:finite(observation.value)?distribution.lookup.get(observation.value):null,referenceN:distribution.n,discriminating:distribution.discriminating};});
   const coverage=components.reduce((sum,c)=>sum+(finite(c.percentile)?c.weight:0),0),score=coverage===1?components.reduce((sum,c)=>sum+c.weight*c.percentile,0):null;
   core.set(String(city.id),{score,coverage,components});
  }
  const national=average([...core.values()].map(r=>r.score));
  function cohort(brand){if(!cohorts.has(brand))cohorts.set(brand,[...new Set(records.filter(r=>r.status==='operando'&&(!brand||r.brand===brand)&&cities.has(r.id)).map(r=>r.id))]);return cohorts.get(brand);}
  function benchmark(brand='agrobar',cohortBrand=brand){
   const supported=!!M.getBrandProfile(brand),cacheKey=JSON.stringify([brand,cohortBrand]);if(!referenceCache.has(cacheKey)){
    const ids=cohort(cohortBrand),byComponent=Object.fromEntries(M.residentComponents.map((c,i)=>[c.key,{national:{...rawNational.get(c.key)},network:average(ids.map(id=>core.get(id).components[i].value))}]));
    referenceCache.set(cacheKey,{national:supported?{...national}:{mean:null,n:0},network:supported?average(ids.map(id=>core.get(id).score)):{mean:null,n:0},operatingIds:[...ids],components:byComponent});
   }return referenceCache.get(cacheKey);
  }
  const residentValue=(id,brand='agrobar')=>M.getBrandProfile(brand)?core.get(String(id))?.score??null:null;
  function snapshot(id,options='agrobar',cohortArg){
   id=String(id);const city=cities.get(id);if(!city)throw Error('Município não encontrado na avaliação.');
   const brand=typeof options==='object'?options.brand||'agrobar':options||'agrobar',cohortBrand=typeof options==='object'?options.cohortBrand??brand:cohortArg??brand;
   const profile=M.getBrandProfile(brand),supported=!!profile,baseline=core.get(id),refs=benchmark(brand,cohortBrand),score=supported?baseline.score:null;
   const components=baseline.components.map(c=>({...c,percentile:supported?c.percentile:null,national:{...refs.components[c.key].national},network:{...refs.components[c.key].network}}));
   const missing=components.filter(c=>c.missingReason).map(c=>({key:c.key,reason:c.missingReason,label:c.missingLabel}));
   const reason=!supported?missingLabels.methodology_unavailable:score===null?'Faltam componentes válidos de 2022. Os pesos não foram redistribuídos.':'Aproximação residente de escala e renda; demanda total ainda não calculada.';
   const makeLayer=(key,status,why,extra={})=>({...M.layers[key],status,reason:why,note:why,score:null,year:M.reference,coverage:0,metricKeys:layerKeys[key],national:{mean:null,n:0},network:{mean:null,n:0},...extra});
   const layers={
    demand:makeLayer('demand',!supported?'methodology_unavailable':score===null?'incomplete':'exploratory',reason,{score,residentScore:score,scoreLabel:'Demanda residente · escala e renda',scope:'resident-core-proxy',coverage:supported?baseline.coverage:0,components,national:{...refs.national},network:{...refs.network},missingReasons:missing,completeDemand:{status:'partial',reason:'Orçamento por categoria, demanda flutuante, projeções e alocação regional não estão estimados neste método.'}}),
    accessibility:makeLayer('accessibility',supported?'unavailable':'methodology_unavailable',supported?profile.activation.accessibility.reason:missingLabels.methodology_unavailable,{activationRequirements:profile?.activation.accessibility.requirements||[]}),
    affinity:makeLayer('affinity',supported?'insufficient_evidence':'methodology_unavailable',supported?profile.activation.affinity.reason:missingLabels.methodology_unavailable,{activationRequirements:profile?.activation.affinity.requirements||[]}),
    competition:makeLayer('competition','diagnostic','Oferta cadastrada é contexto de pressão e maturidade. Menos concorrentes não gera bônus automático; não há nota composta nesta versão.',{axes:['pressao_competitiva','maturidade_comercial']}),
    performance:makeLayer('performance','no_results','Não há resultados de unidades integrados à avaliação. Presença e semelhança municipal não são performance observada.',{excludedFromStructural:true,presenceCount:records.filter(r=>r.id===id&&(!cohortBrand||r.brand===cohortBrand)).length})
   };
   const structuralCoverage=supported&&finite(score)?profile.structural.weights.demand:0,lower=structuralCoverage?score*structuralCoverage:0;
   const structural={label:'Cenário estrutural exploratório',status:supported?'incomplete':'methodology_unavailable',score:null,rank:null,scope:'resident-core-proxy',year:M.reference,
    weights:profile?.structural.weights||null,coverage:structuralCoverage,bounds:supported?{min:lower,max:lower+100*(1-structuralCoverage)}:null,
    missingLayers:[...(finite(score)?[]:['demand']),'accessibility','affinity'],note:M.boundsNote,calibrated:false,enabled:false};
   const scoreDiff=mean=>finite(score)&&finite(mean)?{value:score-mean,unit:'pontos'}:null;
   const row=(key,value,ref={national:{mean:null,n:0},network:{mean:null,n:0}})=>({...M.definitionFor(key),value,methodVersion:M.version,national:{...ref.national},network:{...ref.network},diffNational:key==='assessment:demandResident'?scoreDiff(ref.national.mean):null,diffNetwork:key==='assessment:demandResident'?scoreDiff(ref.network.mean):null});
   const metrics=[row('assessment:demandResident',score,refs),row('assessment:structuralLower',structural.bounds?.min??null),row('assessment:structuralUpper',structural.bounds?.max??null),row('assessment:coverage',supported?100*structuralCoverage:null)];
   const observationStatus=Object.fromEntries(Object.keys(definitions).map(key=>{const r=city.metrics?.[key],meta=definitions[key];return[key,{status:finite(r?.value)?meta.dataNature:'unavailable',role:meta.role,value:finite(r?.value)?r.value:null,year:r?.year??null,missingReason:finite(r?.value)?null:'no_observation'}];}));
   const quality={scoreCoverage:supported?baseline.coverage:0,structuralCoverage,missingReasons:[...(!supported?[{reason:'methodology_unavailable',label:missingLabels.methodology_unavailable}]:[]),...missing],
    observations:observationStatus,nonDiscriminating:components.filter(c=>!c.discriminating).map(c=>c.key),note:'Cobertura indica disponibilidade, não precisão ou probabilidade de sucesso. Fontes e períodos têm limites próprios.'};
   return {city:{id,name:city.name,uf:city.uf},brand,cohortBrand,version:M.version,methodVersion:M.version,brandProfileVersion:profile?.version||null,status:M.status,generatedAt,reference:M.reference,
    layers,structural,metrics,quality,operatingIds:[...refs.operatingIds],legacy:{version:source?.version||null,score:legacyRows.get(id)?.[brand]?.baseline??null,label:'Índice anterior da marca',excludedFromAssessment:true},calibrated:false};
  }
  return {snapshot,get:snapshot,residentValue,benchmark,methodology:M,metricDefinitions:M.metricDefinitions,definitions,version:M.version};
 }
 return {create,percentiles,average,methodology:M};
});
