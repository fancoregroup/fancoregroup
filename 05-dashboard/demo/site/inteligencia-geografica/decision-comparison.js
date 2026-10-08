'use strict';
window.GeoDecisionComparison={create({data,networks,competition,regional,cnpj,ages,num,esc,genericScore,genericWeights,nicheMode,assessment,onChange=()=>{}}){
 const P=GeoCityProfile,model=P.create({data,competition:competition()?.source,regional,networks,cnpj,ages,assessment});
 const themes={overview:'Resumo',demand:'Demanda',accessibility:'Acessibilidade',affinity:'Afinidade',competition:'Competição',performance:'Performance'};
 const methodology=()=>window.GeoAssessmentMethodology;
 const legacyKeys=key=>['score','baseline','rank','baseRank','rankChange','customScore'].includes(key)||/^(component:|contribution:)/.test(key);
 const layerFor=(key,meta)=>methodology()?.layerForMetric(key,meta)||null;
 const definitionFor=(key,meta)=>methodology()?.definitionFor(key,meta)||meta||{};
 const legacyLabel=(key,label,brand)=>key==='score'?'Índice legado '+brandName(brand):key==='baseline'?'Índice legado '+brandName(brand)+' · base':legacyKeys(key)&&key!=='customScore'?'Legado · '+label:label;
 const regionLabels={immediate:'Região imediata',intermediate:'Região intermediária',macro:'Grande região'};
 const state={theme:'overview',reference:'national',regionLevel:'intermediate',nicheMode:nicheMode?.()==='any'?'any':'primary'};
 const indicatorStorage='fancore-geo-comparison-indicators-v1';
 let indicatorKeys=null,lastList=[],indicatorPicker=null,indicatorSaveWarning=false;
 try{const saved=JSON.parse(localStorage.getItem(indicatorStorage));if(saved?.version===1&&Array.isArray(saved.keys))indicatorKeys=saved.keys;}catch(_){}
 let cachedScenario='',snapshots=new Map();
 const ageCache=new Map(),brandName=id=>networks.brands.find(b=>b.id===id)?.name||id;
 const countUnits=new Set(['pessoas','cidades','CNPJs','empresas','unidades','posição','posições','matrículas','vínculos','leitos','registros','estabelecimentos','cursos','cabeças']);
 const number=(v,unit='',compact=false)=>!Number.isFinite(v)?'Sem dado':(unit.startsWith('R$')?'R$ ':'')+(compact&&Math.abs(v)>=1e6?new Intl.NumberFormat('pt-BR',{notation:'compact',maximumFractionDigits:2}).format(v):num(v,countUnits.has(unit)?0:unit.startsWith('R$')?2:1))+(unit==='%'?'%':unit==='pontos'?' pts':'');
 const cityLink=c=>`<button class="dc-city-link" data-profile-city="${c.id}" aria-label="Abrir ficha de ${esc(c.name)} / ${esc(c.uf)}">${esc(c.name)} <small>${esc(c.uf)}</small><span>Abrir ficha ↗</span></button>`;
 const lookup=(s,key)=>s.metrics.find(r=>r.key===key);
 function getSnapshot(city){const comp=competition(),brand=comp?.brand||'agrobar',key=JSON.stringify([brand,comp?.weights]);if(key!==cachedScenario){snapshots.clear();cachedScenario=key;}if(!snapshots.has(city.id))snapshots.set(city.id,model.snapshot(city.id,brand,brand,comp?.weights));return snapshots.get(city.id);}
 function setView(next={}){
  let changed=false;for(const key of Object.keys(state)){
   const aliases={market:'demand',population:'demand',regions:'demand',niches:'competition'},value=key==='theme'?(aliases[next[key]]||next[key]):next[key],valid=key==='theme'?Object.hasOwn(themes,value):key==='reference'?['national','network'].includes(value):key==='regionLevel'?Object.hasOwn(regionLabels,value):['primary','any'].includes(value);
   if(valid&&state[key]!==value){state[key]=value;changed=true;}
  }
  if(changed)onChange({...state});return {...state};
 }
 document.addEventListener('click',event=>{
  if(event.target.closest('#dc-choose-indicators')){openIndicators();return;}
  const control=event.target.closest('[data-dc-theme]');if(control?.closest('[data-dc-workspace]')){const value=control.dataset.dcTheme;setView({theme:value});document.querySelector('[data-dc-theme="'+value+'"]')?.focus({preventScroll:true});}
 });
 document.addEventListener('change',event=>{const control=event.target.closest('[data-dc-setting]');if(control?.closest('[data-dc-workspace]')){const key=control.dataset.dcSetting;setView({[key]:control.value});document.querySelector('[data-dc-setting="'+key+'"]')?.focus({preventScroll:true});}});
 function groupAges(s){
  const definitions=[['0 a 19 anos',0,4],['20 a 39 anos',4,8],['40 a 59 anos',8,12],['60 a 74 anos',12,15],['75 anos ou mais',15,21]];
  return definitions.map(([label,start,end])=>{
   const key='ageGroup:'+start+'-'+end;
   if(!ageCache.has(key)){
    const values=new Map(data.cities.map(c=>{const r=ages?.at(c.id);return [c.id,r&&r.population>0?100*r.total.slice(start,end).reduce((a,b)=>a+b,0)/r.population:null];}));
    ageCache.set(key,{values,national:P.average([...values.values()]),networks:new Map()});
   }
   const item=ageCache.get(key),cohort=s.operating.join(',');if(!item.networks.has(cohort))item.networks.set(cohort,P.average(s.operating.map(id=>item.values.get(id))));
   const value=item.values.get(s.city.id)??null,national=item.national,network=item.networks.get(cohort);
   return {key,label,unit:'%',year:'2022',value,national,network,diffNational:P.difference(value,national.mean,'%'),diffNetwork:P.difference(value,network.mean,'%'),source:'https://sidra.ibge.gov.br/tabela/9514',note:'Soma de faixas quinquenais sem sobreposição. Brasil e operações: média das proporções municipais.'};
  });
 }
 const makeRows=(keys,list)=>keys.map(key=>({key,values:list.map(s=>lookup(s,key))})).filter(row=>row.values.some(Boolean));
 function rowsFor(list){
  const catalog=indicatorCatalog(list),byKey=new Map(catalog.map(item=>[item.key,item.row]));
  if(state.theme==='overview')return selectedIndicators(catalog).map(key=>byKey.get(key));
  return catalog.filter(item=>item.layer===state.theme).filter(item=>{
   const key=item.key;
   if(key.startsWith('cnpj:')&&!key.endsWith(':'+state.nicheMode))return false;
   if(key.startsWith('regionTotal:'))return key.startsWith('regionTotal:'+state.regionLevel+':');
   if(key.startsWith('category:')||key.startsWith('presence:'))return false;
   return true;
  }).map(item=>item.row);
 }

 function presets(){const brand=lastList[0]?.brand||competition()?.brand||'agrobar',resident=brand==='agrobar'?'assessment:demandResident':'score';return [
  {id:'essential',label:'Resumo da decisão',keys:[resident,'exp_ad18','medianIncome','gdpPerCapita','brand:pressure','exp_c12']},
  {id:'market',label:'Demanda residente',keys:['assessment:demandResident','exp_ad18','medianIncome','exp_urb','exp_rur','exp_pres']},
  {id:'competition',label:'Oferta e competição',keys:['brand:pressure','cnpj:bars:primary','cnpj:restaurantes:primary','cnpj:discotecas:primary']},
  {id:'territory',label:'Entorno e contexto',keys:['context:macro','context:intermediate','context:immediate','context:hierarchy','immediate:share','regionTotal:immediate:gdp']},
  {id:'legacy',label:'Índice legado',keys:['score','baseline','component:competition','component:fit','component:market','component:economy']}
 ].concat(window.GeoExpansion?.presets(data)||[]);}
 function indicatorCatalog(list){
  if(!list.length)return [];const first=list[0],entries=[],population=new Set(['population','censusPopulation','density','area','youngAdults','youngAdultsShare','seniors','seniorsShare']);
  const push=(row,group,override={})=>{const original=row.text?row:metadata(row),d=definitionFor(row.key,original),layer=layerFor(row.key,original),label=legacyLabel(row.key,original.label,first.brand),m={...original,label,note:d.note||original.note};if(!row.text)row={...row,values:row.values.map(v=>v?{...v,label,note:m.note}:v)};else row={...row,label,note:m.note};const layerDefinition=methodology()?.layers?.[layer];entries.push({key:row.key,label:label+(m.publicationStatus==='review'?' · Em revisão':''),group:layerDefinition?.label||layerDefinition?.title||(legacyKeys(row.key)?'Modelos legados e personalizados':group),layer,unit:row.text?'Informação':m.unit,year:m.year,note:m.note||'',keywords:row.key.startsWith('ageGroup:')?'idade faixa etária perfil etário':'',...override,row});};
  for(const row of makeRows(first.metrics.filter(r=>r.section!=='ages'&&r.publicSelectable!==false).map(r=>r.key),list)){
   const m=metadata(row),group=m.expansion?m.group:m.section==='regions'?'Região e polos':m.section==='competition'?'Competitividade':m.section==='niches'?'Estabelecimentos':population.has(row.key)?'População':'Mercado e economia';push(row,group);
  }
  const pressure=first.brand==='estica'?'gymRate':'barRate';
  push({key:'brand:pressure',values:list.map(s=>{const value=lookup(s,pressure);return value?{...value,label:'Oferta da categoria · '+value.label,note:'Acompanha a marca: bares no Agrobar e academias na Estica. CNPJ é atividade cadastrada, sem confirmação de concorrência direta ou funcionamento. A classificação primária, substituta ou complementar depende da proposta e ocasião de consumo; não somar categorias sobrepostas.'}:null;})},'Competitividade');
  const grouped=list.map(groupAges);for(let i=0;i<grouped[0].length;i++)push({key:grouped[0][i].key,values:grouped.map(rows=>rows[i])},'População');
  const contexts=[...Object.keys(regionLabels).map(level=>({key:'context:'+level,label:regionLabels[level],get:s=>s.region?.[level]})),{key:'context:hierarchy',label:'Hierarquia urbana da cidade',get:s=>s.region?.hierarchy},...['immediate','intermediate'].map(level=>({key:'context:'+level+':poles',label:'Polos da '+regionLabels[level].toLowerCase(),get:s=>s.regionalContext[level]?.poles.map(c=>c.name+' / '+c.uf).join(', ')}))];
  for(const r of contexts)push({key:r.key,text:true,label:r.label,year:'2023',values:list.map(s=>r.get(s)||null)},'Região e polos');
  for(const r of first.regionalMetrics)push({key:'regionTotal:'+r.key,regional:true,values:list.map(s=>s.regionalMetrics.find(v=>v.key===r.key))},'Região e polos');
  for(const b of networks.brands)push({key:'presence:'+b.id,text:true,label:'Presença '+b.name,year:'Referência informada na base',note:'Presença municipal não informa quantidade de lojas nem performance.',values:list.map(s=>[...new Set(networks.at(s.city.id,b.id).map(u=>(networks.labels[u.status]||u.status)+(u.reference?' · '+u.reference:'')))].join('; ')||'Sem registro na base')},'Rede e contexto');
  for(const key of [...Object.keys(regionLabels),'hierarchy'])push({key:'category:'+key,text:true,label:(key==='hierarchy'?'Hierarquia urbana':regionLabels[key])+' · cidades na mesma categoria',year:'2023',note:'Frequência da categoria da cidade na base nacional e na rede operando. Não é uma média de nomes.',values:list.map(s=>{const r=s.categories.find(c=>c.key===key);return r?.value?r.value+' · Brasil: '+number(r.national.mean,'%')+' (n='+num(r.national.n)+') · operações: '+number(r.network.mean,'%')+' (n='+num(r.network.n)+')':'Sem dado';})},'Rede e contexto');
  if(genericScore)push({key:'customScore',text:true,label:'Índice personalizado de indicadores',year:'Modelo distinto do índice legado da marca',note:'Não substitui o índice de competitividade. Pesos: '+Object.entries(genericWeights?.()||{}).map(([key,value])=>(data.indicators[key]?.label||key)+': '+value).join(' · '),values:list.map(s=>number(genericScore(s.city.id),'pontos'))},'Rede e contexto');
  return entries;
 }
 function normalizeIndicators(keys,catalog){const valid=new Set(catalog.map(item=>item.key));return [...new Set((Array.isArray(keys)?keys:[]).filter(key=>typeof key==='string'&&valid.has(key)))];}
 function selectedIndicators(catalog=indicatorCatalog(lastList)){
  const valid=normalizeIndicators(indicatorKeys,catalog);return valid.length?valid:normalizeIndicators(presets()[0].keys,catalog);
 }
 function setIndicators(keys){
  const next=normalizeIndicators(keys,indicatorCatalog(lastList));if(!next.length)return false;
  indicatorKeys=next;state.theme='overview';
  try{localStorage.setItem(indicatorStorage,JSON.stringify({version:1,keys:next}));indicatorSaveWarning=false;}catch(_){indicatorSaveWarning=true;}
  onChange({...state});return true;
 }
 function openIndicators(){
  if(!lastList.length||!window.GeoComparisonIndicators)return;
  if(!indicatorPicker)indicatorPicker=window.GeoComparisonIndicators.create({getCatalog:()=>indicatorCatalog(lastList).map(({row,...item})=>item),getSelected:()=>selectedIndicators(),getPresets:presets,onApply:setIndicators});
  indicatorPicker.open();
 }
 function metadata(row){return row.values.find(Boolean)||{};}
 function referenceData(row){
  if(row.text)return null;const available=row.values.filter(Boolean),first=available[0];if(!first)return null;
  const ref=first[state.reference],same=available.every(r=>r.year===first.year&&r.unit===first.unit&&r[state.reference]?.mean===ref?.mean&&r[state.reference]?.n===ref?.n);
  return same?{...ref,unit:first.unit,year:first.year}:false;
 }
 function differenceHTML(r,reference){
  const diff=state.reference==='national'?r?.diffNational:r?.diffNetwork;
  if(!diff)return '<span class="dc-difference dc-missing">Sem comparação</span>';
  const value=Math.abs(diff.value),direction=diff.value>0?'acima':diff.value<0?'abaixo':'na média',against=state.reference==='national'?'Brasil':'operações';
  return `<span class="dc-difference" title="Diferença em relação à média ${against}${diff.absolute?' (referência zero; diferença absoluta)':''}">${diff.value===0?'Na média':num(value,1)+(diff.unit==='%'?'%':' '+esc(diff.unit))+' '+direction}${diff.absolute?' · ref. zero':''}</span>${reference===false?`<small class="dc-per-city-reference">Ref. ${number(r[state.reference]?.mean,r.unit,true)} · n=${num(r[state.reference]?.n||0)}</small>`:''}`;
 }
 function referenceCell(row,reference){
  if(row.text)return '<span class="dc-missing">Não se aplica</span>';
  if(reference===false)return '<span class="dc-missing">Referência por ano</span><small>Ver cada cidade</small>';
  return `<strong title="${number(reference?.mean,reference?.unit)}">${number(reference?.mean,reference?.unit,true)}</strong><small>n = ${num(reference?.n||0)} ${row.regional?'regiões':'cidades'}</small>`;
 }
 function cityCell(row,value,reference){
  if(row.text)return `<span class="dc-context-value">${esc(value||'Sem dado')}</span>`;
  if(!value)return '<strong class="dc-missing">Sem dado</strong><span class="dc-difference dc-missing">Sem comparação</span>';
  const pole=value.key.endsWith(':pole'),formatted=pole?(value.value===null?'Sem dado':value.value===100?'Polo':'Entorno'):number(value.value,value.unit,true);
  return `<strong class="${value.value===null?'dc-missing':''}" title="${number(value.value,value.unit)}">${formatted}</strong>${differenceHTML(value,reference)}${String(value.year)!==String(metadata(row).year)?`<small>${esc(value.year)}</small>`:''}`;
 }
 function table(list,rows,title=themes[state.theme]){
  const referenceName=state.reference==='national'?'Brasil':'Operações',brand=brandName(list[0].brand);
  return `<p class="dc-scroll-hint" data-dc-columns="${list.length}">Deslize para comparar as outras cidades <span aria-hidden="true">→</span></p><div class="dc-table-scroll" tabindex="0" role="region" aria-label="Comparativo por indicador; deslize horizontalmente para ver todas as cidades"><table class="dc-matrix" style="--dc-city-count:${list.length}"><caption>${esc(title)} · cidades lado a lado e média de referência</caption><colgroup><col class="dc-label-col">${list.map(()=>'<col class="dc-value-col">').join('')}<col class="dc-reference-col"></colgroup><thead><tr><th scope="col">Indicador<span>Ano e fonte</span></th>${list.map(s=>`<th scope="col" data-dc-city="${s.city.id}">${cityLink(s.city)}</th>`).join('')}<th scope="col" class="dc-reference-col"><span>Média de referência</span><b>${referenceName}</b><small>${state.reference==='national'?'Por município com dado':esc(brand)+' · cidades operando'}</small></th></tr></thead><tbody>${rows.map(row=>{
   const m=row.text?row:metadata(row),reference=referenceData(row);
   return `<tr data-dc-metric="${esc(row.key)}" ${row.regional?'data-dc-regional="true"':''}><th scope="row">${esc(m.label)}${m.publicationStatus==='review'?' <span class="exp-review">Em revisão</span>':''}<small>${esc(row.text?m.year:m.unit+' · '+m.year)}${row.regional?' · região inteira':''}${m.source?` · <a href="${esc(m.source)}" target="_blank" rel="noopener" aria-label="Fonte de ${esc(m.label)}">Fonte ↗</a>`:''}</small>${m.note?`<details class="dc-definition"><summary>Definição</summary><p>${esc(m.note)}</p></details>`:''}</th>${row.values.map((value,i)=>`<td data-dc-value="${list[i].city.id}" data-value="${!row.text&&Number.isFinite(value?.value)?value.value:''}" data-delta="${!row.text?(state.reference==='national'?value?.diffNational?.value:value?.diffNetwork?.value)??'':''}">${cityCell(row,value,reference)}</td>`).join('')}<td class="dc-reference-col" data-dc-reference="${state.reference}" data-mean="${Number.isFinite(reference?.mean)?reference.mean:''}" data-n="${reference?.n??''}">${referenceCell(row,reference)}</td></tr>`;
  }).join('')}</tbody></table></div>`;
 }
 function controls(list){
  return `<div class="dc-controls"><div class="dc-viewbar"><nav class="dc-theme-nav" aria-label="Tema da comparação">${Object.entries(themes).map(([key,label])=>`<button type="button" data-dc-theme="${key}" aria-pressed="${state.theme===key}">${label}</button>`).join('')}</nav><button type="button" class="button" id="dc-choose-indicators" aria-haspopup="dialog">Escolher indicadores <b>${selectedIndicators(indicatorCatalog(list)).length}</b></button></div><div class="dc-filters"><label><span>Comparar com</span><select id="dc-reference-select" data-dc-setting="reference"><option value="national" ${state.reference==='national'?'selected':''}>Média Brasil</option><option value="network" ${state.reference==='network'?'selected':''}>Média das operações</option></select></label>${state.theme==='demand'?`<label><span>Escala regional</span><select data-dc-setting="regionLevel">${Object.entries(regionLabels).map(([key,label])=>`<option value="${key}" ${state.regionLevel===key?'selected':''}>${label}</option>`).join('')}</select></label>`:state.theme==='competition'?`<label><span>Vínculo CNAE</span><select data-dc-setting="nicheMode"><option value="primary" ${state.nicheMode==='primary'?'selected':''}>Atividade principal</option><option value="any" ${state.nicheMode==='any'?'selected':''}>Principal ou secundária</option></select></label>`:''}<p class="dc-reading">${state.theme==='demand'?'Totais regionais: cada região conta uma vez na referência.':state.theme==='competition'?'CNPJs ativos; categorias podem se sobrepor.':state.theme==='affinity'?'Sinais culturais e contextuais; não constituem uma nota de afinidade.':'Valores e diferenças usam o mesmo ano e cenário.'}<span>Diferenças indicam distância da média, sem classificar vantagem ou desvantagem.</span></p></div></div>`;
 }
 function criteria(list){
  const comp=competition(),brand=list[0].brand,total=GeoCompetition.keys.reduce((n,key)=>n+(comp?.weights?.[key]||0),0),used=GeoCompetition.keys.filter(k=>comp?.weights?.[k]>0).map(k=>GeoCompetition.labels(brand)[k]+': '+num(comp.weights[k]/total*100,1)+'%').join(' · ');
  return `<details class="dc-reference-notes"><summary>Referências, cenário e cobertura</summary><p>Índice legado ${esc(brandName(brand))} · ${esc(comp?.scenario||'Índice indisponível')}. ${esc(used)}. Mesmos pesos em todas as cidades e nas médias. O índice é exploratório e não prevê vendas.</p><p>Brasil: média dos municípios com dado válido no mesmo ano. Operações: ${num(list[0].operating.length)} cidades distintas de ${esc(brandName(brand))} confirmadas como operando. Não ponderamos por população ou número de lojas. Filtros do mapa e cidades selecionadas não alteram estas referências. Cada linha mostra sua própria amostra.</p><p>Percentuais são comparados em pontos percentuais; notas em pontos; demais valores em variação percentual. Quando a referência vale zero, mostramos diferença absoluta. Ausência permanece como “Sem dado”. PIB per capita médio e renda mediana são médias dos valores municipais, não valores agregados nacionais.</p><p>Para totais regionais, cada região entra uma vez. A referência operacional inclui regiões com ao menos uma cidade operando. Presença da marca não comprova rentabilidade.</p></details>`;
 }
 function extraContext(list){
  const rows=networks.brands.map(b=>({key:'presence:'+b.id,text:true,label:'Presença '+b.name,year:'Referência informada na base',values:list.map(s=>[...new Set(networks.at(s.city.id,b.id).map(u=>(networks.labels[u.status]||u.status)+(u.reference?' · '+u.reference:'')))].join('; ')||'Sem registro na base')}));
  if(state.theme==='demand')for(const key of [state.regionLevel,'hierarchy'])rows.push({key:'category:'+key,text:true,label:(key==='hierarchy'?'Hierarquia urbana':regionLabels[key])+' · cidades na mesma categoria',year:'2023 · proporções municipais',values:list.map(s=>{const r=s.categories.find(c=>c.key===key);return r?.value?r.value+' · Brasil: '+number(r.national.mean,'%')+' (n='+num(r.national.n)+') · operações: '+number(r.network.mean,'%')+' (n='+num(r.network.n)+')':'Sem dado';})});
  if(genericScore)rows.push({key:'customScore',text:true,label:'Índice personalizado de indicadores',year:'Modelo distinto do índice legado da marca',values:list.map(s=>number(genericScore(s.city.id),'pontos'))});
  return `<details class="dc-extra"><summary>Outras referências da comparação</summary><p>Presença municipal não informa quantidade de lojas nem performance. O índice personalizado usa seu próprio modelo e não substitui o índice legado da marca.</p>${table(list,rows,'Contexto adicional')}${genericWeights?`<p>Pesos personalizados: ${Object.entries(genericWeights()).map(([key,value])=>esc(data.indicators[key]?.label||key)+': '+value).join(' · ')}.</p>`:''}</details>`;
 }
 function layerStatus(list){
  const layer=state.theme==='overview'?'demand':state.theme;
  const items=list.map(s=>({city:s.city,assessment:s.assessment||assessment?.snapshot(s.city.id,{brand:s.brand,cohortBrand:s.brand})}));
  if(!items.some(item=>item.assessment))return '';
  const supported=methodology()?.getBrandProfile(list[0].brand);
  const note=state.theme==='overview'&&!supported?'O método de Demanda residente ainda não está definido para esta marca. O índice legado permanece identificado como referência exploratória.':state.theme==='overview'?'Demanda residente é uma leitura exploratória de escala e renda. Acessibilidade e Afinidade ainda não permitem uma nota estrutural completa.':'A camada reúne medidas com seus próprios universos e fontes. Nenhum dado ausente foi convertido em zero.';
  return `<details class="dc-reference-notes" data-dc-assessment="${layer}" ${['accessibility','performance'].includes(layer)?'open':''}><summary>${state.theme==='overview'?(supported?'Sobre a Demanda residente':'Método e referências da marca'):'Leitura e cobertura da camada'}</summary><p>${note}</p>${items.map(({city,assessment:a})=>{const current=a?.layers?.[layer];return current?`<p><b>${esc(city.name)}</b> · ${esc(current.reason||current.note||current.status||'Em revisão')}</p>`:'';}).join('')}</details>`;
 }
 function html(cities){
  if(!cities.length){lastList=[];return '';}
  const list=cities.map(getSnapshot);lastList=list;const rows=rowsFor(list),brand=brandName(list[0].brand);
  return `<section class="dc-workspace" data-dc-workspace>${controls(list)}${layerStatus(list)}${indicatorSaveWarning?'<p class="dc-reference-empty" role="status">Indicadores aplicados para esta sessão. O navegador não permitiu salvar o padrão.</p>':''}${state.reference==='network'&&!list[0].operating.length?`<p class="dc-reference-empty" role="status">Nenhuma cidade de ${esc(brand)} está confirmada como operando na base. A referência fica sem dado; os valores das cidades continuam disponíveis.</p>`:''}${rows.length?table(list,rows):'<p class="dc-reference-empty">Ainda não há indicadores calculados para esta camada. Sem dado não significa zero.</p>'}${criteria(list)}${state.theme==='overview'?'':extraContext(list)}</section>`;
 }
 function csv(cities){const parts=cities.map(c=>P.csv(getSnapshot(c)).replace(/^\uFEFF/,'').split('\r\n'));return '\uFEFF'+parts.flatMap((rows,i)=>i?rows.slice(1):rows).join('\r\n');}
 return {html,getSnapshot,csv,setView,setIndicators,getIndicatorCatalog:()=>indicatorCatalog(lastList).map(({row,...item})=>item),get indicators(){return selectedIndicators();},get state(){return {...state};}};
}};
