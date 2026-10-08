'use strict';
(function(root,factory){const api=factory(typeof module==='object'?require('./competitiveness.js'):root.GeoCompetition,typeof module==='object'?require('./regions.js'):root.GeoRegions,typeof module==='object'?require('./assessment-methodology.js'):root.GeoAssessmentMethodology);if(typeof module==='object')module.exports=api;else root.GeoCityProfile=api;})(typeof globalThis!=='undefined'?globalThis:this,(C,R,M)=>{
 const average=values=>{const valid=values.filter(Number.isFinite);return {mean:valid.length?valid.reduce((s,v)=>s+v,0)/valid.length:null,n:valid.length};};
 function operatingIds(records,brand=''){return [...new Set(records.filter(r=>r.status==='operando'&&(!brand||r.brand===brand)).map(r=>r.id))];}
 function difference(value,mean,unit){if(!Number.isFinite(value)||!Number.isFinite(mean))return null;if(unit==='%'||unit==='pontos')return {value:value-mean,unit:unit==='%'?'p.p.':'pontos'};return mean===0?{value:value-mean,unit,absolute:true}:{value:(value-mean)/Math.abs(mean)*100,unit:'%'};}
 function create({data,competition,regional,networks,cnpj,ages,assessment}){
  const cities=new Map(data.cities.map(c=>[c.id,c])),comp=new Map((competition?.cities||[]).map(r=>[r.id,r])),reg=new Map((regional?.cities||[]).map(r=>[r.id,r]));
  const groups=Object.fromEntries(Object.keys(R.levels).map(k=>[k,R.groups(regional?.cities||[],k)]));
  const groupMaps=Object.fromEntries(Object.entries(groups).map(([k,g])=>[k,new Map(g.map(r=>[r.id,r]))]));
  function snapshot(id,brand='agrobar',cohortBrand=brand,weights=competition?.defaults?.[brand]||C.defaults?.[brand]){
   if(!cities.has(id))throw Error('Município não encontrado.');
   const city=cities.get(id),row=comp.get(id),region=reg.get(id),allIds=[...cities.keys()],operating=operatingIds(networks.records,cohortBrand).filter(id=>cities.has(id));
   const ranked=competition&&C.validWeights(weights)?C.ranked([...comp.values()].map(r=>({...r,name:cities.get(r.id)?.name||r.id})),brand,weights):[];
   const ranks=new Map(ranked.map(r=>[r.id,r]));
   const baseline=competition?new Map(C.ranked([...comp.values()].map(r=>({...r,name:cities.get(r.id)?.name||r.id})),brand,competition.defaults[brand]).map(r=>[r.id,r.rank])):new Map();
   const defs=[];
   const add=(key,label,unit,year,section,get,source='',note='',meta={})=>defs.push({...meta,key,label,unit,year,section,get,source,note});
   for(const [key,m] of Object.entries(data.indicators)){
    const year=m.years?.length===1?String(m.years[0]):String(city.metrics[key]?.year??'');
    add(key,m.label,m.unit,year,m.expansion?'expansion':'market',id=>{const v=cities.get(id)?.metrics[key];return String(v?.year)===year?v.value:null;},m.source,(m.publicationStatus==='review'?'Em revisão. ':'')+(m.note||''),m.expansion?{expansion:true,group:m.group,dimension:m.dimension,aggregation:m.aggregation,publicationStatus:m.publicationStatus,coverage:m.coverage}:{});
   }
   if(competition){
    add('score','Índice legado · cenário','pontos','2026-09-27','competition',id=>ranks.get(id)?.score,'dados/competitividade.json','Mesmos pesos para cidade, Brasil e rede. Filtros da tela não alteram as médias.');
    add('baseline','Índice legado · base da marca','pontos','2026-09-27','competition',id=>comp.get(id)?.[brand]?.baseline);
    add('rank','Posição nacional no cenário','posição','2026-09-27','competition',id=>ranks.get(id)?.rank);
    add('baseRank','Posição nacional na base','posição','2026-09-27','competition',id=>baseline.get(id));
    add('rankChange','Posições ganhas no cenário','posições','2026-09-27','competition',id=>{const a=ranks.get(id)?.rank,b=baseline.get(id);return Number.isFinite(a)&&Number.isFinite(b)?b-a:null;});
    const total=C.keys.reduce((s,k)=>s+(weights?.[k]||0),0);
    for(const k of C.keys){
     add('component:'+k,C.labels(brand)[k],'pontos','2026-09-27','competition',id=>comp.get(id)?.[brand]?.[k]);
     add('contribution:'+k,'Contribuição: '+C.labels(brand)[k],'pontos','2026-09-27','competition',id=>!weights?.[k]?0:Number.isFinite(comp.get(id)?.[brand]?.[k])?comp.get(id)[brand][k]*weights[k]/total:null);
    }
    add('peerCount','Cidades no grupo de concorrência','cidades','2026-09-27','competition',id=>comp.get(id)?.peerCount);
    for(const [key,label,unit,year] of [
     ['pickups','Caminhonetes nos veículos leves','%','2026-07'],['bars','Bares · CNAE principal','CNPJs','2026-09'],['nightlife','Entretenimento e casas noturnas · principal','CNPJs','2026-09'],['barRate','Bares por 10 mil habitantes','por 10 mil','2026'],['nightlifeRate','Entretenimento e noturnas por 10 mil','por 10 mil','2026'],['gyms','Academias · CNAE principal','CNPJs','2026-09'],['gymRate','Academias por 10 mil habitantes','por 10 mil','2026'],['pilates','Pilates no nome · principal','CNPJs','2026-09'],['pilatesRate','Pilates por 10 mil habitantes','por 10 mil','2026']])add(key,label,unit,year,'competition',id=>comp.get(id)?.[key],'dados/competitividade.json');
   }
   for(const level of Object.keys(R.levels)){
    const title=R.levels[level];
    add(level+':share','Participação da cidade no PIB da '+title.toLowerCase(),'%','2023','regions',id=>{const r=reg.get(id);return R.share(r,groupMaps[level].get(r?.[level+'Id']));},regional?.source.url,'Média das participações municipais, cada cidade uma vez.');
    add(level+':rank','Posição da cidade por PIB na '+title.toLowerCase(),'posição','2023','regions',id=>{const r=reg.get(id),g=groupMaps[level].get(r?.[level+'Id']);return r&&g?1+g.cities.filter(c=>c.gdp>r.gdp).length:null;});
    if(level!=='macro')add(level+':pole','É polo da '+title.toLowerCase(),'%','2023','regions',id=>{const r=reg.get(id);return r?r[level+'Role']==='Polo'?100:0:null;},regional?.source.url,'Cidade: 100% = polo; 0% = entorno. Médias: proporção de cidades que são polos.');
   }
   for(const n of cnpj?.niches||[])for(const mode of ['primary','any'])add('cnpj:'+n.id+':'+mode,n.label+' · '+(mode==='primary'?'principal':'principal ou secundária'),'CNPJs','2026-09','niches',id=>cnpj.count(id,n,mode),'https://www.gov.br/receitafederal/dados/cnpj-metadados.pdf','Ativos cadastrais; categorias podem se sobrepor.');
   for(const b of ages?.bands||[])add('age:'+b.id,b.label,'%','2022','ages',id=>ages.rate(id,b.id),'https://sidra.ibge.gov.br/tabela/9514','Média das proporções municipais, não participação na população total do país.');
   const assessmentSnapshot=assessment?.snapshot(id,brand,cohortBrand)||null;
   const metrics=defs.map(d=>{const value=d.get(id),national=average(allIds.map(d.get)),network=average(operating.map(d.get));const {get,...meta}=d;return {...meta,layer:M.layerForMetric(d.key,d),role:M.definitionFor(d.key,d).role,methodVersion:assessmentSnapshot?.version||null,value:Number.isFinite(value)?value:null,national,network,diffNational:difference(value,national.mean,d.unit),diffNetwork:difference(value,network.mean,d.unit)};});
   if(assessmentSnapshot)metrics.push(...assessmentSnapshot.metrics.filter(r=>r.publicSelectable!==false).map(r=>({...r,section:'assessment'})));
   const regionalMetrics=[];
   for(const level of Object.keys(R.levels)){
    const current=groupMaps[level].get(region?.[level+'Id']);
    const networkGroups=[...new Set(operating.map(id=>reg.get(id)?.[level+'Id']).filter(Boolean))].map(id=>groupMaps[level].get(id));
    for(const [key,label,unit,get] of [['gdp','PIB total','R$',g=>g.gdp],['count','Quantidade de municípios','cidades',g=>g.cities.length],['topShare','Concentração nas três maiores','%',g=>g.topShare],['poles','Polos indicados na planilha','cidades',g=>level==='macro'?null:g.poles.length]]){
     if(key==='poles'&&level==='macro')continue;
     const value=current?get(current):null,national=average(groups[level].map(get)),network=average(networkGroups.map(get));
     regionalMetrics.push({key:level+':'+key,label:R.levels[level]+' · '+label,section:'regionTotals',unit,year:'2023',value,national,network,diffNational:difference(value,national.mean,unit),diffNetwork:difference(value,network.mean,unit),source:regional?.source.url,note:'Cada região uma vez. Rede: regiões com ao menos uma cidade operando. Amostra em regiões.'});
    }
   }
   const categories=['macro','intermediate','immediate','hierarchy'].map(key=>{const value=region?.[key]??null,matchKey=key==='hierarchy'?key:key+'Id',match=region?.[matchKey];const stats=ids=>{const known=ids.map(id=>reg.get(id)?.[matchKey]).filter(Boolean);return {n:known.length,mean:match&&known.length?100*known.filter(v=>v===match).length/known.length:null};};return {key,value,national:stats(allIds),network:stats(operating)};});
   return {city,row,region,brand,cohortBrand,weights,legacyBaseWeights:competition?.defaults?.[brand]||C.defaults?.[brand],assessment:assessmentSnapshot,operating,metrics,regionalMetrics,categories,regionalContext:Object.fromEntries(Object.keys(R.levels).map(k=>[k,groupMaps[k].get(region?.[k+'Id'])||null])),cohort:operating.map(id=>cities.get(id)),units:networks.at(id)};
  }
  return {snapshot,groups};
 }
 function csv(s){
  const safe=v=>'"'+String(v??'').replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"';
  const metricWeights=r=>{
   if(r.key==='assessment:demandResident')return s.assessment?.brandProfileVersion?JSON.stringify(Object.fromEntries((s.assessment.layers.demand.components||[]).map(c=>[c.key,c.weight]))):'';
   if(['baseline','baseRank'].includes(r.key))return JSON.stringify(s.legacyBaseWeights);
   if(r.key==='rankChange')return JSON.stringify({base:s.legacyBaseWeights,scenario:s.weights});
   if(['score','rank'].includes(r.key)||r.key.startsWith('contribution:'))return JSON.stringify(s.weights);
   return '';
  };
  const header=['IBGE','Cidade','Índice da marca','Rede de referência','Seção','Indicador','Unidade','Ano','Cidade ou sua região','Média Brasil','Amostra Brasil','Média rede operando','Amostra rede','Diferença Brasil','Unidade diferença Brasil','Diferença rede','Unidade diferença rede','Fonte','Método','Pesos do indicador','Cidades operando (IBGE)','Camada','Versão da avaliação','Papel no método'];
  const rows=[...s.metrics,...s.regionalMetrics].map(r=>[s.city.id,s.city.name,s.brand,s.cohortBrand||'holding',r.section,r.label,r.unit,r.year,r.value,r.national.mean,r.national.n,r.network.mean,r.network.n,r.diffNational?.value,r.diffNational?.unit,r.diffNetwork?.value,r.diffNetwork?.unit,r.sources?.join(' | ')||r.source,r.note||'Média aritmética por cidade; ausências excluídas',metricWeights(r),s.operating.join(','),M.layers[M.layerForMetric(r.key,r)]?.label||'Contexto ou legado',r.methodVersion||s.assessment?.version||'',r.role||M.definitionFor(r.key,r).role]);
  for(const r of s.categories)rows.push([s.city.id,s.city.name,s.brand,s.cohortBrand||'holding','categorias',r.key,'% das cidades na mesma categoria','2023',r.value,r.national.mean,r.national.n,r.network.mean,r.network.n,'','','','','dados/regioes-pib.json','Frequência da categoria da cidade; não é média de nomes','',s.operating.join(','),'Demanda',s.assessment?.version||'','descriptive']);
  return '\uFEFF'+[header,...rows].map(r=>r.map(safe).join(';')).join('\r\n');
 }
 return {average,operatingIds,difference,create,csv};
});
