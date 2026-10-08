'use strict';
(function(root,factory){const api=factory();if(typeof module==='object')module.exports=api;else root.GeoAssessmentMethodology=api;})(typeof globalThis!=='undefined'?globalThis:this,()=>{
 const version='city-layers-v1.0.0',reference='2022',status='exploratory';
 const freeze=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
 const layers=freeze({
  demand:{id:'demand',label:'Demanda',order:1,question:'Qual é a escala residente e seu contexto de renda, economia e região?'},
  accessibility:{id:'accessibility',label:'Acessibilidade',order:2,question:'Que relações regionais têm percursos, modos e tempos documentados?'},
  affinity:{id:'affinity',label:'Afinidade',order:3,question:'Quais evidências sustentam a compatibilidade cultural com a marca?'},
  competition:{id:'competition',label:'Competição',order:4,question:'Qual é a oferta cadastrada e o que sabemos da pressão e maturidade?'},
  performance:{id:'performance',label:'Performance real',order:5,question:'Quais resultados observados permitem avaliar a tese?'}
 });
 const residentComponents=freeze([
  {key:'exp_ad18',label:'Adultos com 18 anos ou mais',unit:'pessoas',year:reference,weight:0.5,source:'https://sidra.ibge.gov.br/tabela/9514',universe:'População residente de 18 anos ou mais no Censo 2022'},
  {key:'medianIncome',label:'Renda domiciliar mediana per capita',unit:'R$/mês',year:reference,weight:0.5,source:'https://sidra.ibge.gov.br/tabela/10295',universe:'Universo publicado da renda domiciliar per capita no Censo 2022'}
 ]);
 const brandProfiles=freeze({agrobar:{id:'agrobar',label:'Agrobar',version:'agrobar-resident-core-v1',status,
  resident:{id:'demand-resident',label:'Demanda residente · escala e renda',scope:'resident-core-proxy',components:residentComponents,calibrated:false,
   note:'Média de dois percentis nacionais com pesos iguais. Aproximação de escala adulta e renda municipal de 2022; não mede demanda total, consumo da categoria, receita ou retorno.'},
  structural:{weights:{demand:0.5,accessibility:0.2,affinity:0.3},enabled:false,scope:'resident-core-proxy',calibrated:false,
   note:'Cenário metodológico com Demanda residente, Acessibilidade e Afinidade. Os pesos 50/20/30 são normativos e exploratórios. Sem os três termos válidos, não há nota pontual nem posição.'},
  exclusions:['performance','presence','legacy','competition'],
  activation:{
   accessibility:{status:'unavailable',reason:'Não há matriz municipal de percursos, modos e tempos validada para este método.',requirements:['Matriz dirigida com referências urbanas, modo, versão e tempos estimados identificados','Origens e alternativas compatíveis com os vínculos regionais','Regra multimodal e de cobertura, sem converter rota ausente em zero','Subindicadores, pesos e testes de sensibilidade homologados em nova versão']},
   affinity:{status:'insufficient_evidence',reason:'Eventos candidatos e contexto agro não constituem um protocolo cultural comparável entre cidades.',requirements:['Taxonomia Agrobar e janela de observação fixadas antes da coleta','Evidências realizadas e anunciadas separadas, deduplicadas e verificáveis','Evidências favoráveis, contrárias e ausentes com cobertura auditável','Regra numérica e critérios de publicação homologados em nova versão']}
  }
 }});
 const metricDefinitions={};
 const register=(keys,layer,role='descriptive',dataNature='official')=>keys.forEach(key=>{metricDefinitions[key]={key,layer,role,dataNature,publicSelectable:true};});
 register(['population','censusPopulation','area','density','income','medianIncome','gdp','gdpPerCapita','agroGva','agroShare','establishments','companies','employment','salaried','salary','foodEstablishments','foodEmployment','youngAdults','youngAdultsShare','seniors','seniorsShare','exp_urb','exp_rur','exp_ad18','exp_pres','exp_ead','exp_not','exp_agmat','exp_agc','exp_eduvar','exp_hosp','exp_leitos','exp_pam','exp_pamha','exp_sojavar','exp_bov','exp_bovvar','exp_ppm','exp_rais','exp_ra','exp_ri','exp_rc','exp_rt','exp_rs','exp_rm','exp_rw','exp_rn','exp_rmiss','exp_rv','exp_cs','exp_c12','exp_c24',...Array.from({length:12},(_,i)=>'exp_r'+i)],'demand');
 register(['bars','nightlife','barRate','nightlifeRate','gyms','gymRate','pilates','pilatesRate','peerCount','brand:pressure','exp_bares','exp_org'],'competition','descriptive','observed');
 register(['pickups'],'affinity','context','proxy');register(['exp_event'],'affinity','context','review');
 for(const key of ['exp_ad18','medianIncome'])metricDefinitions[key]={...metricDefinitions[key],role:'scored',scoringScope:'resident-core-proxy',requiredYear:reference};
 for(const key of ['exp_agmat','exp_agc','agroShare','agroGva','exp_pres','youngAdultsShare'])metricDefinitions[key].relatedLayers=['affinity'];
 for(const key of ['exp_rm','exp_rw','exp_rn','exp_rmiss'])metricDefinitions[key].dataNature='review';
 for(const key of ['score','baseline','rank','baseRank','rankChange','customScore'])metricDefinitions[key]={key,layer:null,role:'legacy',dataNature:'proxy',publicSelectable:true};
 const derivedNote='Método '+version+'. Percentis nacionais fixos de adultos 18+ e renda mediana per capita, ambos de 2022, com peso de 50% cada. Média Brasil/rede por município com os dois componentes válidos. Não é consumo, demanda total, receita ou probabilidade de sucesso.';
 metricDefinitions['assessment:demandResident']={key:'assessment:demandResident',label:'Demanda residente · escala e renda',unit:'pontos',year:reference,layer:'demand',group:'Demanda',role:'derived',dataNature:'proxy',methodVersion:version,publicSelectable:true,source:'https://sidra.ibge.gov.br/tabela/9514',sources:residentComponents.map(c=>c.source),note:derivedNote};
 const boundsNote='Limites matemáticos no cenário exploratório 50/20/30, usando a aproximação residente como termo D. Ausentes podem variar entre 0 e 100. Não são intervalos de confiança nem previsão; não usar em ranking.';
 for(const [suffix,label,unit] of [['structuralLower','Limite matemático inferior','pontos'],['structuralUpper','Limite matemático superior','pontos'],['coverage','Cobertura dos termos do cenário estrutural','%']])metricDefinitions['assessment:'+suffix]={key:'assessment:'+suffix,label,unit,year:reference,layer:null,group:'Método e cobertura',role:'quality',dataNature:'proxy',methodVersion:version,publicSelectable:false,source:'',note:suffix==='coverage'?'Soma dos pesos dos termos válidos no cenário estrutural. Não mede confiança, precisão nem completude de toda a análise.':boundsNote};
 freeze(metricDefinitions);
 function layerForMetric(key,meta={}){
  if(Object.hasOwn(metricDefinitions,key))return metricDefinitions[key].layer;
  if(/^(age:|ageGroup:|regionTotal:|category:|context:|macro:|intermediate:|immediate:)/.test(key))return 'demand';
  if(/^(cnpj:|niche:|nicheAny:)/.test(key))return 'competition';
  if(/^presence:/.test(key)||/^performance:/.test(key))return 'performance';
  if(/^(component:|contribution:)/.test(key))return null;
  return Object.hasOwn(layers,meta.layer)?meta.layer:null;
 }
 function definitionFor(key,meta={}){
  const known=Object.hasOwn(metricDefinitions,key)?metricDefinitions[key]:null,layer=layerForMetric(key,meta),role=known?.role||(/^(component:|contribution:)/.test(key)?'legacy':/^performance:/.test(key)?'validation':'descriptive');
  return {...meta,...known,key,layer,group:layer?layers[layer].label:(known?.group||'Índices anteriores'),role,label:known?.label||meta.label||key,
   dataNature:meta.publicationStatus==='review'?'review':known?.dataNature||meta.dataNature||(/^presence:/.test(key)?'observed':/^(age:|ageGroup:|macro:|intermediate:|immediate:|regionTotal:|cnpj:)/.test(key)?'official':'unspecified')};
 }
 return freeze({version,reference,status,layers,brandProfiles,metricDefinitions,residentComponents,boundsNote,layerForMetric,definitionFor,getBrandProfile:brand=>Object.hasOwn(brandProfiles,brand)?brandProfiles[brand]:null});
});
