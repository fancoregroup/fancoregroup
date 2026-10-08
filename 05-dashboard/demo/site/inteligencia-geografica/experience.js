'use strict';
/* Uma jornada: explorar, entender a cidade e comparar a seleção. */
window.GeoExperience={mount(){
 const $=s=>document.querySelector(s),main=$('#main'),geo=window.FancoreGeo,oldNav=$('.tabs');
 if(main.classList.contains('experience'))return;
 main.classList.add('experience');document.body.classList.add('geo-ready');
 const icon=path=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
 const modes={competition:'Visão de Mercado',explore:'Mercado',regions:'Regiões',similar:'Cidades semelhantes'};
 let active='competition',lastExplore='competition',drawerOrigin=null,settingTerritory=false;
 const navigation=Object.fromEntries([...oldNav.querySelectorAll('[data-tab]')].map(b=>[b.dataset.tab,b]));
 const primary=document.createElement('nav');primary.className='decision-primary';primary.setAttribute('aria-label','Jornada de expansão');
 const discover=document.createElement('button');discover.id='decision-discover';discover.textContent='Explorar';discover.onclick=()=>geo.showTab(lastExplore);
 navigation.compare.firstChild.textContent='Comparar ';primary.append(discover,navigation.compare);$('.topbar').insertBefore(primary,$('.top-actions'));
 $('.product').innerHTML='Geo <small>Inteligência de expansão</small>';
 const more=document.createElement('details');more.id='decision-more';more.innerHTML='<summary aria-label="Mais opções">'+icon('<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>')+'</summary><div class="decision-more-menu"></div>';
 const menu=more.lastElementChild;navigation.performance.textContent='Resultados das unidades';navigation.leads.textContent='Origem dos leads';navigation.similar.textContent='Encontrar cidades semelhantes';navigation.sources.textContent='Dados e método';menu.append(navigation.performance,navigation.leads,navigation.similar,navigation.sources,$('#export'),$('.map-focus'),...$('.top-actions').children);$('.top-actions').append(more);
 menu.addEventListener('click',e=>{if(e.target.closest('button,a'))more.open=false;});document.addEventListener('click',e=>{if(more.open&&!more.contains(e.target))more.open=false;});more.addEventListener('keydown',e=>{if(e.key==='Escape'){more.open=false;more.querySelector('summary').focus();}});
 const bar=document.createElement('section');bar.id='decision-workbar';bar.className='decision-workbar';bar.setAttribute('aria-label','Perspectiva e contexto da exploração');
 bar.innerHTML='<nav class="decision-lenses" aria-label="Perspectivas do mapa"></nav><div class="decision-context"><label class="decision-brand-label"><span>Marca</span><select id="decision-brand" aria-label="Marca da análise"><option value="agrobar">Agrobar</option><option value="estica">Estica</option></select></label><label><span>Território</span><select id="decision-territory" aria-label="Estado do estudo"><option value="">Brasil</option></select></label><button class="button" id="decision-filter-open" aria-haspopup="dialog">'+icon('<path d="M4 7h16M4 17h16M8 4v6m8 4v6"/>')+'<span>Filtros</span><b id="decision-filter-count" hidden></b></button><button class="button" id="decision-list-toggle" aria-expanded="true">'+icon('<path d="M4 5h16v14H4zM10 5v14"/>')+'<span>Lista</span></button></div>';
 for(const k of ['competition','regions']){const b=navigation[k];b.textContent=modes[k];bar.querySelector('nav').append(b);}
 main.insertBefore(bar,oldNav);oldNav.remove();
 const comparisonTitle=document.createElement('h1');comparisonTitle.className='decision-comparison-title';comparisonTitle.textContent='Comparar cidades';comparisonTitle.hidden=true;bar.prepend(comparisonTitle);moveClear();function moveClear(){const clear=$('#clear-compare');if(clear)bar.querySelector('.decision-context').append(clear);if($('#compare-panel > .section-heading'))$('#compare-panel > .section-heading').hidden=true;}
 const similarLabel=document.createElement('span');similarLabel.className='decision-similar-label';similarLabel.textContent='Perfis semelhantes';bar.querySelector('nav').append(similarLabel);
 for(const uf of [...new Set(geo.data.cities.map(c=>c.uf))].sort())$('#decision-territory').add(new Option(uf,uf));
 const workspaceByMode={competition:$('.ic-workspace'),explore:$('#explore-panel .map-workspace'),regions:$('.rg-workspace'),similar:$('.similar-workspace')};
 const drawer=document.createElement('dialog');drawer.id='decision-filters';drawer.setAttribute('aria-labelledby','decision-filter-title');drawer.innerHTML='<header><div><span class="eyebrow">Seu estudo de expansão</span><h2 id="decision-filter-title">Refinar oportunidades</h2></div><button class="button" id="decision-filter-close" aria-label="Fechar filtros">×</button></header><div class="decision-filter-content"></div><footer><p id="decision-filter-feedback" role="status"></p><button class="button primary" id="decision-filter-done">Ver resultados</button></footer>';document.body.append(drawer);
 const filterSections={};for(const mode of Object.keys(modes)){const section=document.createElement('section');section.dataset.filterMode=mode;section.hidden=true;drawer.querySelector('.decision-filter-content').append(section);filterSections[mode]=section;}
 const move=(node,target)=>{if(node&&target)target.append(node);};
 const field=(id,target)=>move($('#'+id)?.closest('label'),target);
 function disclosure(node,title,className='decision-disclosure'){
  if(!node)return null;const d=document.createElement('details');d.className=className;const s=document.createElement('summary');s.textContent=title;node.before(d);d.append(s,node);return d;
 }
 // Existing fields are moved, preserving their validation and event handlers.
 const compFilters=filterSections.competition;
 for(const id of ['ic-preset','ic-query','ic-uf'])field(id,compFilters);
 const compAdvanced=$('#competition-panel > .ic-settings');if(compAdvanced){compAdvanced.open=true;compAdvanced.querySelector('summary').textContent='População, renda e concorrência';move(compAdvanced,compFilters);}
 move(disclosure($('.ic-scenario-bar'),'Cenários e recortes salvos'),compFilters);move($('#ic-clear'),compFilters);
 if($('.ic-header'))$('.ic-header').hidden=true;if($('.ic-toolbar'))$('.ic-toolbar').hidden=true;
 if($('.ic-ranking')){move(disclosure($('#ic-summary'),'Resumo do recorte'),$('.ic-ranking'));$('.ic-ranking-head h3').textContent='Cidades para estudar';$('.ic-ranking > .fine').textContent='Clique para destacar no mapa. Use + para comparar.';}
 move(disclosure($('#ic-detail'),'Entender a nota da cidade selecionada'),$('#competition-panel'));
 if($('#ic-comparison'))move(disclosure($('#ic-comparison'),'Composição da nota e relatório'),$('#compare-panel'));
 // Market filters and the variable shown on the map.
 const marketFilters=filterSections.explore;
 for(const id of ['search','uf','region','brand','status','min-pop','max-pop'])field(id,marketFilters);
 $('#search').placeholder='Nome, código IBGE ou CEP';
 move($('#reset'),marketFilters);move($('#open-weights'),compFilters);$('#open-weights').textContent='Ajustar índice personalizado de indicadores';$('#metric option[value="score"]').textContent='Índice personalizado de indicadores';
 const metric=$('#metric').closest('label');metric.firstChild.textContent='Indicador';metric.classList.add('decision-map-variable');$('.map-controls').append(metric);
 $('#metric').addEventListener('change',()=>{if(!$('#metric').value.startsWith('niche:')&&!geo.layers.state.indicator)$('.layer-indicator').click();});
 move(disclosure($('#summary'),'Resumo do recorte'),$('.ranking'));
 $('#explore-panel > .filters').hidden=true;
 // Regional navigation keeps the official geographic levels and full totals.
 const regionFilters=filterSections.regions;
 for(const id of ['rg-uf','rg-query','rg-city'])field(id,regionFilters);move($('#rg-locate'),regionFilters);move($('#rg-reset'),regionFilters);move($('#rg-definition'),regionFilters);
 if($('#rg-level')){const level=$('#rg-level').closest('label');level.classList.add('decision-map-variable');$('.rg-map-toolbar').prepend(level);$('.rg-controls').hidden=true;}
 move($('#rg-summary'),$('.rg-map-card'));move(disclosure($('#rg-map-status'),'Cobertura dos limites municipais'),$('#regions-panel'));
 disclosure($('#rg-city-context'),'Vínculo regional da cidade selecionada');move(disclosure($('#rg-detail'),'Cidades, polos e participação na economia regional'),$('#regions-panel'));
 $('#rg-locate')?.addEventListener('click',()=>{if(geo.regions?.current&&drawer.open)drawer.close();syncContext();});
 // Similarity is a contextual study, accessed from a city or the secondary menu.
 for(const id of ['similar-brand','similar-reference','similar-uf','similar-scope','similar-min','similar-search'])field(id,filterSections.similar);
 move($('#similar-reset'),filterSections.similar);$('#similar-panel > .filters').hidden=true;
 move(disclosure($('#similar-summary'),'Referências e cobertura'),$('.similar-ranking'));
 disclosure($('#similar-detail'),'Diferenças do par selecionado');
 const resize=()=>{window.GeoLayout.resizeMaps();window.dispatchEvent(new Event('resize'));};
 function setList(open){const workspace=workspaceByMode[active];if(!workspace)return;workspace.classList.toggle('decision-list-closed',!open);if(active==='explore'||active==='similar')workspace.classList.toggle('sidebar-collapsed',!open);$('#decision-list-toggle').setAttribute('aria-expanded',String(open));$('#decision-list-toggle').classList.toggle('selected',open);resize();}
 for(const workspace of Object.values(workspaceByMode)){const aside=workspace?.querySelector('aside');if(aside){const close=document.createElement('button');close.className='button decision-list-dismiss';close.textContent='×';close.setAttribute('aria-label','Recolher lista');close.onclick=()=>{setList(false);$('#decision-list-toggle').focus();};aside.prepend(close);}}
 const compactScreen=matchMedia('(max-width:760px)');compactScreen.addEventListener('change',e=>{if(e.matches){for(const workspace of Object.values(workspaceByMode))workspace?.classList.add('decision-list-closed');setList(false);}});
 $('#decision-list-toggle').onclick=()=>setList(workspaceByMode[active]?.classList.contains('decision-list-closed'));
 for(const [mode,workspace] of Object.entries(workspaceByMode)){if(workspace){workspace.classList.add('decision-workspace');if(mode!=='competition'||innerWidth<=760)workspace.classList.add('decision-list-closed');if(['explore','similar'].includes(mode)&&workspace.classList.contains('decision-list-closed'))workspace.classList.add('sidebar-collapsed');}}
 function closeFilters(){drawer.close();}
 $('#decision-filter-open').onclick=()=>{drawerOrigin=document.activeElement;for(const [key,section] of Object.entries(filterSections))section.hidden=key!==active;$('#decision-filter-title').textContent=active==='regions'?'Explorar o território':active==='similar'?'Encontrar perfis próximos':'Refinar oportunidades';updateFilterFeedback();drawer.showModal();$('#decision-filter-close').focus();};
 $('#decision-filter-close').onclick=closeFilters;$('#decision-filter-done').onclick=closeFilters;drawer.addEventListener('close',()=>{drawerOrigin?.focus({preventScroll:true});resize();});
 function updateFilterFeedback(){const count=active==='competition'?geo.competition?.filtered.length:active==='regions'?geo.regions?.visible.length:active==='similar'?geo.similarity?.result.matches.length:geo.filtered.length;$('#decision-filter-feedback').textContent=Number.isFinite(count)?count.toLocaleString('pt-BR')+' cidades no recorte':'';const section=filterSections[active];const n=section?[...section.querySelectorAll('input,select')].filter(el=>{if(el.closest('.ic-scenario-bar')||el.id==='ic-preset'||el.id==='similar-brand')return false;if(el.type==='checkbox')return el.checked;if(el.tagName==='SELECT')return el.selectedIndex>0;return el.value.trim()!=='';}).length:0;$('#decision-filter-count').hidden=!n;$('#decision-filter-count').textContent=n;}
 function activeField(){return ({competition:'ic-uf',explore:'uf',regions:'rg-uf',similar:'similar-uf'})[active];}
 function setTerritory(uf){if(settingTerritory)return;settingTerritory=true;for(const id of ['ic-uf','uf','rg-uf','similar-uf']){const el=$('#'+id);if(el&&el.value!==uf){el.value=uf;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}}$('#decision-territory').value=uf;settingTerritory=false;updateFilterFeedback();}
 $('#decision-territory').onchange=()=>setTerritory($('#decision-territory').value);
 for(const id of ['ic-uf','uf','rg-uf','similar-uf'])$('#'+id)?.addEventListener('change',()=>setTerritory($('#'+id).value));
 $('#decision-brand').onchange=()=>{geo.competition?.setBrand($('#decision-brand').value);const ref=$('#similar-brand');if(ref.value!==$('#decision-brand').value){ref.value=$('#decision-brand').value;ref.dispatchEvent(new Event('change',{bubbles:true}));}syncContext();};
 function syncContext(){if(geo.competition)$('#decision-brand').value=geo.competition.brand;$('#decision-brand').disabled=!geo.competition;const uf=$('#'+activeField());if(uf&&$('#decision-territory').value!==uf.value)setTerritory(uf.value);updateFilterFeedback();}
 function syncView(){active=geo.activeTab||[...document.querySelectorAll('.tab-panel')].find(p=>!p.hidden)?.id.replace('-panel','')||'competition';const exploration=!!modes[active];if(exploration)lastExplore=active;if(active==='explore'&&!geo.competition){navigation.competition.classList.add('active');navigation.competition.setAttribute('aria-current','page');}main.dataset.view=active;document.body.dataset.geoView=active;bar.hidden=!exploration&&active!=='compare';bar.classList.toggle('decision-comparing',active==='compare');comparisonTitle.hidden=active!=='compare';$('#clear-compare').hidden=active!=='compare';discover.classList.toggle('active',exploration);discover.setAttribute('aria-current',exploration?'page':'false');similarLabel.hidden=active!=='similar';const ws=workspaceByMode[active];$('#decision-list-toggle').hidden=!ws;$('#decision-list-toggle').setAttribute('aria-expanded',String(!!ws&&!ws.classList.contains('decision-list-closed')));$('#decision-list-toggle').classList.toggle('selected',!!ws&&!ws.classList.contains('decision-list-closed'));if(drawer.open)drawer.close();more.open=false;syncContext();resize();}
 const viewObserver=new MutationObserver(syncView);for(const panel of document.querySelectorAll('.tab-panel'))viewObserver.observe(panel,{attributes:true,attributeFilter:['hidden']});
 document.addEventListener('geo:competition',syncContext);drawer.addEventListener('input',()=>setTimeout(updateFilterFeedback,180));drawer.addEventListener('change',()=>setTimeout(updateFilterFeedback,180));
 for(const id of ['ic-count','results','rg-count','similar-shown'])if($('#'+id))new MutationObserver(syncContext).observe($('#'+id),{childList:true});
 // The same city finder serves every perspective, without changing the recorte.
 // Global city search: exact IBGE and accent-insensitive names, keyboard navigation.
 const trigger=document.createElement('button');trigger.id='ux-find-city';trigger.className='button ux-find-city';trigger.setAttribute('aria-label','Encontrar cidade');trigger.innerHTML=icon('<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>')+'<span>Encontrar cidade</span><kbd>⌘ K</kbd>';$('.topbar').insertBefore(trigger,$('.top-actions'));
 const picker=document.createElement('dialog');picker.id='ux-city-finder';picker.setAttribute('aria-labelledby','ux-finder-title');picker.innerHTML='<div class="ux-finder-head"><h2 id="ux-finder-title">Encontrar cidade</h2><button class="button" id="ux-finder-close" aria-label="Fechar busca">×</button></div><label for="ux-city-query">Nome, estado ou código IBGE</label><input id="ux-city-query" type="search" placeholder="Ex.: Londrina, PR ou 4113700" autocomplete="off" role="combobox" aria-controls="ux-city-results" aria-expanded="true" aria-autocomplete="list"><p id="ux-city-count" role="status"></p><div id="ux-city-results" role="listbox" aria-label="Cidades encontradas"></div><p class="ux-finder-hint">↑ ↓ para escolher · Enter abre a ficha · Esc fecha</p>';document.body.append(picker);
 const norm=s=>String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim(),cities=geo.data.cities.map(c=>({...c,search:norm(c.name+' '+c.uf+' '+c.id)}));let matches=[],selected=0,searchOrigin;
 function renderMatches(){const q=norm($('#ux-city-query').value.trim()),tokens=q.split(/\s+/);matches=q?cities.filter(c=>tokens.every(t=>c.search.includes(t))).sort((a,b)=>(Number(b.search.startsWith(q))-Number(a.search.startsWith(q)))||a.name.localeCompare(b.name,'pt-BR')).slice(0,8):[];selected=0;
  $('#ux-city-count').textContent=q?(matches.length?'Selecione uma cidade para abrir a ficha.':'Nenhuma cidade encontrada. Tente o nome ou o código IBGE.'):'Busque entre '+cities.length.toLocaleString('pt-BR')+' municípios.';
  $('#ux-city-results').replaceChildren(...matches.map((c,i)=>{const b=document.createElement('button');b.id='ux-match-'+i;b.type='button';b.setAttribute('role','option');b.setAttribute('aria-selected',String(i===selected));b.innerHTML='<span></span><small></small><b aria-hidden="true">↗</b>';b.querySelector('span').textContent=c.name+' / '+c.uf;b.querySelector('small').textContent=c.region+' · IBGE '+c.id;b.onclick=()=>choose(i);return b;}));syncSelection();
 }
 function syncSelection(){matches.forEach((_,i)=>$('#ux-match-'+i).setAttribute('aria-selected',String(i===selected)));const input=$('#ux-city-query');if(matches.length)input.setAttribute('aria-activedescendant','ux-match-'+selected);else input.removeAttribute('aria-activedescendant');}
 function choose(i){const c=matches[i];if(!c)return;picker.close();requestAnimationFrame(()=>{searchOrigin?.focus({preventScroll:true});geo.selectCity(c.id);});}
 function openFinder(){if(document.querySelector('dialog[open]'))return;searchOrigin=document.activeElement;$('#ux-city-query').value='';renderMatches();picker.showModal();$('#ux-city-query').focus();}
 trigger.onclick=openFinder;$('#ux-finder-close').onclick=()=>picker.close();picker.addEventListener('close',()=>searchOrigin?.focus({preventScroll:true}));$('#ux-city-query').oninput=renderMatches;
 $('#ux-city-query').onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();picker.close();return;}if(['ArrowDown','ArrowUp'].includes(e.key)&&matches.length){e.preventDefault();selected=(selected+(e.key==='ArrowDown'?1:-1)+matches.length)%matches.length;syncSelection();$('#ux-match-'+selected).scrollIntoView({block:'nearest'});}if(e.key==='Enter'){e.preventDefault();choose(selected);}};
 document.addEventListener('keydown',e=>{if(((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k')||(e.key==='/'&&!e.target.closest('input,textarea,select,[contenteditable]'))){e.preventDefault();openFinder();}});
 syncView();
 // Prevent page scrolling from competing with an open modal on touch devices.
 for(const modal of [drawer,picker])modal.addEventListener('click',e=>{if(e.target===modal){const r=modal.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)modal.close();}});
 window.GeoExperience.openFilters=()=>$('#decision-filter-open').click();
}};
