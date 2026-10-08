'use strict';
window.GeoRegionsUI={async load(data){
 const response=await fetch('dados/regioes-pib.json');if(!response.ok)throw Error('Base regional indisponível.');
 const source=await response.json();if(source.version!=='regioes-pib-2023-v1')throw Error('Versão regional desconhecida.');
 const byId=new Map(source.cities.map(c=>[c.id,c]));
 data.indicators.gdpPerCapita={label:'PIB per capita',unit:'R$',table:'PIB dos Municípios',source:source.source.url,years:['2023'],coverage:source.cities.length,note:'Produção por habitante, a preços correntes de 2023. Valor oficial da planilha; não é renda domiciliar. Não usa população 2026.'};
 for(const c of data.cities){const r=byId.get(c.id);c.economyRegion=r||null;c.metrics.gdpPerCapita={value:r?.gdpPerCapita??null,year:r?2023:null};}
 return source;
},mount({source,data,num,esc,css,showTab,selectCity,syncExport,openCompetition,openConsumption}){
 const E=GeoRegions,$=s=>document.querySelector(s),panel=$('#regions-panel'),cities=new Map(data.cities.map(c=>[c.id,c]));
 const rows=source.cities.map(r=>({...r,lat:cities.get(r.id)?.lat,lng:cities.get(r.id)?.lng})),byId=new Map(rows.map(r=>[r.id,r]));
 const grouped=Object.fromEntries(Object.keys(E.levels).map(k=>[k,E.groups(rows,k)]));
 let level='intermediate',activeId=null,activeCity=null,filteredGroups=[],current=null,visible=[],limit=40,map,points,base,boundaries,brandPins,sequence=0,listFocusId=null,listContext='';
 const cache=new Map(),money=v=>Number.isFinite(v)?'R$ '+num(v,2):'Sem dado',short=v=>Number.isFinite(v)?'R$ '+new Intl.NumberFormat('pt-BR',{notation:'compact',maximumFractionDigits:1}).format(v):'Sem dado';
 const norm=s=>String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 panel.innerHTML=`<div class="rg-heading"><span class="eyebrow">PIB 2023 · Regionalização IBGE</span><h2>Regiões e polos econômicos</h2><p>Veja quais cidades fazem parte da mesma região, seus polos e onde se concentra a produção econômica.</p></div>
 <div class="rg-controls"><label>Escala regional<select id="rg-level">${Object.entries(E.levels).map(([k,v])=>`<option value="${k}" ${k===level?'selected':''}>${v}</option>`).join('')}</select></label><label>Estado<select id="rg-uf"><option value="">Brasil inteiro</option>${[...new Set(rows.map(r=>r.uf))].sort().map(u=>`<option>${u}</option>`).join('')}</select></label><label>Buscar região<input id="rg-query" type="search" placeholder="Ex.: Londrina"></label><label>Localizar a região de uma cidade<input id="rg-city" list="rg-cities" placeholder="Nome / UF ou código IBGE"><datalist id="rg-cities">${data.cities.map(c=>`<option value="${esc(c.name)} / ${c.uf}">${c.id}</option>`).join('')}</datalist></label><button class="button" id="rg-locate">Localizar cidade</button><button class="button" id="rg-reset">Limpar</button></div>
 <p class="fine" id="rg-definition"></p><p id="rg-message" role="status"></p><section id="rg-city-context" aria-live="polite"></section>
 <div class="rg-workspace"><aside class="rg-ranking"><h3>Regiões por PIB total</h3><p class="fine" id="rg-count"></p><div id="rg-list"></div></aside><div class="rg-main"><div id="rg-summary" class="rg-summary"></div><div class="rg-map-card"><div class="rg-map-toolbar"><span>Pontos: tamanho pelo PIB · laranja: polos IBGE</span><button id="rg-consumption" class="button" ${typeof openConsumption==='function'?'':'disabled title="Base de eixos indisponível. Recarregue para tentar novamente."'}>Eixos de consumo</button><button id="rg-fit" class="button">Enquadrar região</button></div><div id="rg-map" aria-label="Municípios e polos da região selecionada"></div><p class="fine" id="rg-map-status"></p></div><section id="rg-detail" aria-live="polite"></section></div></div>
 <details class="rg-method"><summary>Como interpretar regiões, polos e PIB</summary><p>As cinco grandes regiões são Norte, Nordeste, Sudeste, Sul e Centro-Oeste. Para estudar relações entre cidades, as regiões geográficas intermediárias articulam centros de serviços mais complexos; as imediatas agrupam cidades ligadas às necessidades cotidianas. A divisão de 2017 respeita os limites estaduais.</p><p>“Polo IBGE” reproduz a indicação de polo da região na planilha. “Maior PIB” é o município com a maior produção em 2023; os dois podem ser diferentes. A hierarquia urbana também é a classificação fornecida na planilha, sem atualização inferida.</p><p>A participação é o PIB municipal dividido pela soma do PIB de todos os municípios da região. A concentração das três maiores usa esse mesmo total. Ordenar, buscar municípios ou filtrar polos na tabela não altera o denominador. Não somamos nem tiramos média simples do PIB per capita.</p><p>PIB per capita é produção econômica por habitante, não renda das famílias. Valores nominais de 2023 importados diretamente da coluna AN; PIB total da coluna AM convertido de mil reais para reais. População de 2026 não entra nesses cálculos. Boa Esperança do Norte (MT) não está na base de 2023 e continua sem valor e vínculo nesta fotografia.</p><p>Estar na mesma região indica pertencimento regional oficial. Não mede correlação estatística, fluxo de clientes, tempo de viagem ou canibalização entre unidades. Para relações de influência comercial detalhadas, o próximo dado é a pesquisa REGIC, com seus vínculos entre centros.</p><p><a href="${esc(source.source.url)}" target="_blank" rel="noopener">Planilha oficial do IBGE</a> · <a href="https://www.ibge.gov.br/geociencias/cartas-e-mapas/redes-geograficas/15778-regioes-geograficas.html" target="_blank" rel="noopener">Divisões regionais do IBGE</a> · <a href="dados/regioes-pib.csv" download>Base completa em CSV</a></p></details>`;
 function message(text){$('#rg-message').textContent=text;}
 function render(){
  const uf=$('#rg-uf').value,q=norm($('#rg-query').value),signature=JSON.stringify({level,uf,q,activeId});if(signature!==listContext){listFocusId=null;listContext=signature;}
  filteredGroups=grouped[level].filter(g=>(!uf||g.cities.some(r=>r.uf===uf))&&(!q||norm(g.name+' '+g.uf).includes(q)));
  if(!filteredGroups.some(g=>g.id===activeId))activeId=filteredGroups[0]?.id??null;
  current=filteredGroups.find(g=>g.id===activeId)||null;limit=40;
  $('#rg-definition').textContent=level==='macro'?'Cinco grandes regiões. O filtro de estado localiza a grande região e preserva seu total integral.':level==='intermediate'?'133 regiões intermediárias: recorte amplo para entender a articulação entre centros e suas cidades.':'510 regiões imediatas: recorte mais próximo das relações cotidianas entre municípios.';
  $('#rg-count').textContent=num(filteredGroups.length)+' regiões · total integral de cada região';
  $('#rg-list').innerHTML=filteredGroups.map(g=>`<button class="rg-region ${g.id===activeId?'active':''}" data-rg-region="${g.id}" aria-pressed="${g.id===activeId}"><span><strong>${esc(g.name)}${g.uf?' / '+g.uf:''}</strong><small>${num(g.cities.length)} cidades</small></span><b>${short(g.gdp)}</b></button>`).join('')||'<p>Nenhuma região encontrada. Limpe a busca.</p>';
  $('#rg-summary').innerHTML=current?[[E.levels[level],current.name,current.uf||'Brasil'],['PIB total · 2023',short(current.gdp),num(current.coverage)+' municípios com PIB'],['Concentração nas 3 maiores',num(current.topShare,1)+'%','participação no PIB regional']].map(([a,b,c])=>`<article><span>${esc(a)}</span><strong>${esc(b)}</strong><small>${esc(c)}</small></article>`).join(''):'';
  $('#rg-detail').innerHTML=current?`<div class="rg-detail-heading"><h3>${esc(current.name)}: cidades e polos</h3><button class="button" id="rg-competition">Analisar competitividade desta região</button></div><p>${level==='macro'?'Polos são identificados nos níveis intermediário e imediato.':`Polos IBGE: ${current.poles.map(r=>`<button class="text-button" data-rg-city="${r.id}">${esc(r.name)}</button>`).join(', ')||'Sem indicação na planilha'}.`} Maior PIB: <button class="text-button" data-rg-city="${current.ranked[0].id}">${esc(current.ranked[0].name)}</button> (${num(E.share(current.ranked[0],current),1)}% do total regional).</p><div class="rg-controls rg-table-controls"><label>Ordenar cidades<select id="rg-sort"><option value="gdp">PIB total · 2023</option><option value="gdpPerCapita">PIB per capita · 2023</option><option value="name">Nome</option></select></label><label>Buscar dentro da região<input type="search" id="rg-member" placeholder="Nome ou código IBGE"></label><label>Exibir<select id="rg-role"><option value="">Todas as cidades</option><option value="pole" ${level==='macro'?'disabled':''}>Somente polos IBGE</option></select></label></div><p class="fine" id="rg-table-count"></p><div class="table-wrap"><table class="rg-table"><thead><tr><th>Cidade / UF</th><th>Papel regional</th><th>PIB · R$ · 2023</th><th>Participação regional</th><th>PIB per capita · R$ · 2023</th><th>Região imediata</th></tr></thead><tbody id="rg-rows"></tbody></table></div><button class="button" id="rg-more">Mostrar mais cidades</button>`:'<p class="rg-empty">Nenhuma região neste recorte.</p>';
  if(current){for(const id of ['rg-sort','rg-member','rg-role'])$('#'+id).addEventListener('input',()=>{clearListFocus();limit=40;renderTable();});$('#rg-more').onclick=()=>{limit+=40;renderTable();};$('#rg-competition').onclick=()=>openCompetition(level,current.id);}
  renderTable();renderMap();syncExport();
 }
 function renderTable(){
  if(!current){visible=[];return;}
  const query=norm($('#rg-member').value),sort=$('#rg-sort').value;
  visible=current.cities.filter(r=>(!query||norm(r.name+' '+r.id).includes(query))&&($('#rg-role').value!=='pole'||r[level+'Role']==='Polo')).sort((a,b)=>sort==='name'?a.name.localeCompare(b.name,'pt-BR'):(b[sort]??-1)-(a[sort]??-1)||a.id.localeCompare(b.id));
  $('#rg-table-count').textContent=num(visible.length)+' de '+num(current.cities.length)+' cidades · participação sempre sobre a região completa';
  $('#rg-rows').innerHTML=visible.slice(0,limit).map(r=>`<tr class="${r.id===activeCity?'rg-selected':''}"><td><button class="text-button" data-rg-city="${r.id}" data-map-focused="${r.id===listFocusId}" aria-pressed="${r.id===listFocusId}" aria-label="${esc(r.name)} / ${r.uf}. ${r.id===listFocusId?'Clique novamente para abrir a ficha':'Mostrar no mapa'}">${esc(r.name)} / ${r.uf}</button><small>${esc(r.hierarchy)}</small>${r.id===listFocusId?'<small class="map-focus-hint">Clique novamente para abrir a ficha</small>':''}</td><td>${level==='macro'?'Consultar nível regional':r[level+'Role']==='Polo'?'<b class="rg-pole">Polo IBGE</b>':'Entorno'}</td><td>${money(r.gdp)}</td><td><div class="rg-share"><i style="width:${E.share(r,current)}%"></i></div>${num(E.share(r,current),2)}%</td><td>${money(r.gdpPerCapita)}</td><td>${esc(r.immediate)}</td></tr>`).join('')||'<tr><td colspan="6">Nenhuma cidade. Revise os filtros da tabela.</td></tr>';
  $('#rg-more').hidden=visible.length<=limit;syncExport();
 }
 function cityContext(id){
  activeCity=id;const r=byId.get(id),c=cities.get(id);if(!r){$('#rg-city-context').innerHTML=`<article class="rg-context"><h3><button class="cp-city-link" data-profile-city="${id}">${esc(c?.name||id)}</button></h3><p>Sem PIB e vínculo regional na planilha de 2023. Ausência não significa PIB zero.</p></article>`;return;}
  const g=grouped[level].find(g=>g.id===r[level+'Id']);
  $('#rg-city-context').innerHTML=`<article class="rg-context"><div><span class="eyebrow">Cidade selecionada</span><h3><button class="cp-city-link" data-profile-city="${r.id}">${esc(r.name)} / ${r.uf}</button></h3><p>${esc(r.macro)} → ${r.uf} → Intermediária de ${esc(r.intermediate)} → Imediata de ${esc(r.immediate)}</p><p>${esc(r.hierarchy)} · ${r.intermediateRole==='Polo'?'Polo da intermediária':'Entorno da intermediária'} · ${r.immediateRole==='Polo'?'Polo da imediata':'Entorno da imediata'}</p><p>PIB per capita: <b>${money(r.gdpPerCapita)}</b> · PIB total: ${short(r.gdp)} · ${num(E.share(r,g),2)}% do PIB da ${esc(E.levels[level].toLowerCase())} · 2023</p></div><div class="rg-context-actions"><button class="button primary" data-rg-profile="${r.id}">Abrir perfil completo</button><button class="button" data-rg-scale="intermediate">Ver região intermediária</button><button class="button" data-rg-scale="immediate">Ver região imediata</button></div></article>`;
 }
 function clearListFocus(){if(!listFocusId)return;listFocusId=null;points?.eachLayer(marker=>{const tooltip=marker.getTooltip?.();if(tooltip?.options.permanent){tooltip.options.permanent=false;marker.closeTooltip();}});renderTable();}
 function focusFromList(id,button){
  if(listFocusId===id){selectCity(id);return;}
  listFocusId=id;cityContext(id);renderTable();renderMap(false);const row=byId.get(id);
  const target=button?.isConnected?button:$('#rg-rows [data-rg-city="'+id+'"]');target?.focus({preventScroll:true});
  message(row.name+' destacada no mapa. Clique novamente no nome para abrir a ficha.');
  document.dispatchEvent(new CustomEvent('geo:list-focus',{detail:{id,view:'regions'}}));
 }
 function locate(id,chosenLevel=level){clearListFocus();
  const r=byId.get(id);level=chosenLevel;$('#rg-level').value=level;
  if(r){$('#rg-uf').value=r.uf;$('#rg-query').value='';activeId=r[level+'Id'];$('#rg-city').value=r.name+' / '+r.uf;}
  render();cityContext(id);renderTable();renderMap();
 }
 async function renderMap(fitView=true){
  if(!map)return;const ticket=++sequence;points.clearLayers();if(boundaries){map.removeLayer(boundaries);boundaries=null;}
  $('#rg-map-status').textContent='';brandPins?.setIds(current?.cities.map(c=>c.id)||[]);if(!current)return;
  for(const r of [...current.ranked].reverse()){
   if(!Number.isFinite(r.lat)||!Number.isFinite(r.lng))continue;
   const pole=r[level+'Role']==='Polo';
   L.circleMarker([r.lat,r.lng],{radius:3+9*Math.sqrt(r.gdp/current.ranked[0].gdp),color:r.id===activeCity?css('text'):pole?css('orange'):css('muted'),fillColor:pole?css('orange'):css('muted'),weight:r.id===activeCity?3:1,fillOpacity:pole?.95:.55}).addTo(points).bindTooltip(`${esc(r.name)} / ${r.uf}<br>${short(r.gdp)} · ${pole?'Polo IBGE':'Município da região'}`,{permanent:r.id===listFocusId,direction:'top',offset:[0,-10]}).on('click',()=>{clearListFocus();cityContext(r.id);renderTable();renderMap();selectCity(r.id);});
  }
  if(fitView)fit();
  if(level==='macro'){$('#rg-map-status').textContent='Pontos municipais da grande região. Escolha uma região intermediária ou imediata para ver limites municipais e polos.';return;}
  try{
   const ufId=current.cities[0].id.slice(0,2);if(!cache.has(ufId))cache.set(ufId,fetch('malhas/'+ufId+'.json').then(r=>{if(!r.ok)throw Error();return r.json();}));
   const geo=await cache.get(ufId);if(ticket!==sequence)return;const ids=new Set(current.cities.map(r=>r.id));
   const features=geo.features.filter(f=>ids.has(String(f.properties.codarea)));
   boundaries=L.geoJSON({type:'FeatureCollection',features},{style:{color:css('orange'),weight:1,fillColor:css('orange'),fillOpacity:.08},onEachFeature:(f,l)=>l.on('click',()=>{const id=String(f.properties.codarea);clearListFocus();cityContext(id);renderTable();renderMap();selectCity(id);})}).addTo(map);boundaries.bringToBack();base?.bringToBack();
   $('#rg-map-status').textContent=`${features.length} limites municipais exibidos de ${current.cities.length} cidades. Contornos representam municípios, não trajetos nem áreas de influência.`;
  }catch(_){if(ticket===sequence)$('#rg-map-status').textContent='Limites indisponíveis. Pontos municipais, vínculos e tabela continuam disponíveis.';}
 }
 function fit(){if(!map||!current||panel.hidden)return;const coords=current.cities.filter(r=>Number.isFinite(r.lat)&&Number.isFinite(r.lng)).map(r=>[r.lat,r.lng]);if(coords.length)map.fitBounds(coords,{padding:[28,28],maxZoom:10,animate:false});}
 async function activate(){
  if(!map){map=L.map('rg-map',{preferCanvas:true,zoomAnimation:false,minZoom:3,maxZoom:12}).setView([-14,-52],4);brandPins=window.GeoBrandPins?.attach(map);points=L.layerGroup().addTo(map);map.attributionControl.setPrefix(false);map.attributionControl.addAttribution('IBGE · PIB 2023 e regiões geográficas');try{const r=await fetch('../mapa-agrobar/assets/brasil.geojson');if(!r.ok)throw Error();base=L.geoJSON(await r.json(),{interactive:false,style:{color:css('boundary'),weight:.7,fillColor:css('land'),fillOpacity:.8}}).addTo(map);base.bringToBack();}catch(_){}renderMap(!listFocusId);}
  setTimeout(()=>{const keep=listFocusId?{center:map.getCenter(),zoom:map.getZoom()}:null;map.invalidateSize({pan:false});if(keep)map.setView(keep.center,keep.zoom,{animate:false,reset:true});else fit();},0);
 }
 function download(){if(!visible.length)return;const url=URL.createObjectURL(new Blob([E.csv(visible,current)],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='fancore-regioes-pib-2023.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 $('#rg-level').onchange=()=>{clearListFocus();level=$('#rg-level').value;activeId=byId.get(activeCity)?.[level+'Id']??null;render();if(activeCity)cityContext(activeCity);};
 for(const id of ['rg-uf','rg-query'])$('#'+id).addEventListener('input',()=>{activeCity=null;$('#rg-city-context').innerHTML='';render();});
 const findCity=()=>{const q=norm($('#rg-city').value.trim()),matches=data.cities.filter(c=>norm(c.name+' / '+c.uf)===q||c.id===q||norm(c.name)===q);if(matches.length!==1){message(matches.length?'Há cidades com esse nome em mais de um estado. Escolha nome / UF.':'Escolha uma cidade da lista ou digite o código IBGE.');return;}message('');locate(matches[0].id);};
 $('#rg-locate').onclick=findCity;$('#rg-city').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();findCity();}};
 $('#rg-fit').onclick=fit;
 $('#rg-consumption').onclick=()=>{const action=openConsumption||window.FancoreGeo?.consumptionAxes?.open;if(action)action(activeCity||current?.poles[0]?.id||current?.ranked[0]?.id);else message('Eixos de consumo indisponíveis. Recarregue para tentar novamente.');};
 $('#rg-reset').onclick=()=>{clearListFocus();level='intermediate';activeId=activeCity=null;$('#rg-level').value=level;for(const id of ['rg-uf','rg-query','rg-city'])$('#'+id).value='';$('#rg-city-context').innerHTML='';message('');render();};
 panel.addEventListener('click',e=>{const region=e.target.closest('[data-rg-region]'),city=e.target.closest('[data-rg-city]'),profile=e.target.closest('[data-rg-profile]'),scale=e.target.closest('[data-rg-scale]');if(region){clearListFocus();activeId=region.dataset.rgRegion;activeCity=null;$('#rg-city-context').innerHTML='';render();}if(city)focusFromList(city.dataset.rgCity,city);if(profile)selectCity(profile.dataset.rgProfile);if(scale)locate(activeCity,scale.dataset.rgScale);});
 new MutationObserver(()=>{base?.setStyle({color:css('boundary'),fillColor:css('land')});if(!panel.hidden)renderMap();}).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
 render();
 return {activate,download,clearListFocus,get map(){return map;},locate:(id,l)=>{locate(id,l);showTab('regions');},get visible(){return visible;},get current(){return current;},get groups(){return grouped;},get source(){return source;}};
}};
