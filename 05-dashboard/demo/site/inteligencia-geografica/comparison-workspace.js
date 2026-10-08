'use strict';
/* Seleção compartilhada: da exploração ao comparativo, sem perder o contexto. */
window.GeoComparisonWorkspace={mount(){
 const geo=window.FancoreGeo,$=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const norm=s=>String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
 const cities=geo.data.cities.map(c=>({...c,search:norm(c.name+' '+c.uf+' '+c.id)})),byId=new Map(cities.map(c=>[c.id,c]));
 const composer=document.createElement('section');composer.id='compare-composer';composer.setAttribute('aria-labelledby','compare-composer-title');
 composer.innerHTML='<div class="cw-heading"><div><h2 id="compare-composer-title" tabindex="-1">Escolha as cidades</h2><p id="cw-guidance"></p></div><button class="button" id="cw-export">Exportar CSV ↓</button></div><div id="cw-slots" class="cw-slots"></div>';
 $('#comparison').before(composer);
 const tray=document.createElement('section');tray.id='compare-tray';tray.hidden=true;tray.setAttribute('aria-label','Cidades selecionadas para comparação');
 tray.innerHTML='<span id="cw-tray-count"></span><div id="cw-tray-cities"></div><button class="button" data-cw-add aria-label="Adicionar cidade à comparação">+</button><button class="button primary" id="cw-open">Comparar cidades <span aria-hidden="true">→</span></button>';
 $('#decision-workbar').after(tray);
 const status=document.createElement('p');status.id='cw-status';status.className='sr-only';status.setAttribute('role','status');document.body.append(status);
 const picker=document.createElement('dialog');picker.id='comparison-picker';picker.setAttribute('aria-labelledby','cw-picker-title');
 picker.innerHTML='<header><div><span class="eyebrow">Sua seleção de expansão</span><h2 id="cw-picker-title">Adicionar cidades</h2></div><button class="button" id="cw-picker-close" aria-label="Fechar seleção de cidades">×</button></header><div id="cw-search-step"><label for="cw-query">Buscar em todo o Brasil</label><input id="cw-query" type="search" autocomplete="off" placeholder="Nome, UF ou código IBGE" role="combobox" aria-controls="cw-results" aria-autocomplete="list" aria-expanded="true"><p id="cw-results-label" role="status"></p><div id="cw-results" role="listbox" aria-label="Cidades para comparar"></div></div><div id="cw-replace-step" hidden><p id="cw-replace-label"></p><div id="cw-replacements"></div><button class="text-button" id="cw-back">← Buscar outra cidade</button></div><footer><span id="cw-picker-count" role="status"></span><button class="button primary" id="cw-picker-done">Ver comparação</button></footer>';
 document.body.append(picker);
 let matches=[],active=0,origin=null,replaceId=null,pendingCity=null,lastSelection=geo.selection.join(',');
 const selectedCities=()=>geo.selection.map(id=>byId.get(id)).filter(Boolean);
 const name=c=>c.name+' / '+c.uf;
 function announce(message){status.textContent=message;}
 function update(){
  const list=selectedCities(),count=list.length,focused=document.activeElement,focusId=focused?.dataset.cwRemove;
  $('#compare-composer-title').textContent=count?'Cidades em análise':'Escolha as cidades';
  $('#cw-guidance').textContent=count===0?'Busque e adicione até quatro cidades para comparar lado a lado.':count===1?'Adicione outra cidade para comparar. As médias já estão disponíveis abaixo.':count+' de 4 cidades · Mesmos indicadores, anos e referências.';
  $('#cw-export').disabled=!count;$('#cw-slots').dataset.count=String(count);
  $('#cw-slots').innerHTML=list.map(c=>'<article class="cw-slot"><button class="cw-city" data-profile-city="'+c.id+'" title="Abrir ficha de '+esc(name(c))+'"><strong>'+esc(c.name)+'</strong><small>'+esc(c.uf)+' · Abrir ficha ↗</small></button><div class="cw-slot-actions"><button class="text-button" data-cw-replace="'+c.id+'" aria-label="Substituir '+esc(name(c))+'">Trocar</button><button class="cw-remove" data-cw-remove="'+c.id+'" aria-label="Remover '+esc(name(c))+' da comparação">×</button></div></article>').join('')+(count<4?'<button class="cw-add-slot" data-cw-add><b aria-hidden="true">+</b><span>Adicionar cidade<small>'+count+' de 4 selecionadas</small></span></button>':'');
  $('#cw-tray-count').textContent=count+' / 4';
  $('#cw-tray-cities').innerHTML=list.map(c=>'<span class="cw-chip"><span title="'+esc(name(c))+'">'+esc(name(c))+'</span><button data-cw-remove="'+c.id+'" aria-label="Remover '+esc(name(c))+' da comparação">×</button></span>').join('');
  $('#cw-open').innerHTML=(count===1?'Completar comparação':'Comparar cidades')+' <span aria-hidden="true">→</span>';
  tray.querySelector('[data-cw-add]').hidden=count>=4;
  syncView();
  if(focusId&&!focused.isConnected){const target=geo.activeTab==='compare'?(composer.querySelector('[data-cw-remove]')||composer.querySelector('[data-cw-add]')):tray.querySelector('[data-cw-remove]')||$('#decision-discover');target?.focus({preventScroll:true});}
  const signature=geo.selection.join(',');if(signature!==lastSelection){announce(count+' de 4 cidades selecionadas para comparação.');lastSelection=signature;}
  if(picker.open){if(pendingCity&&!geo.selection.includes(pendingCity.id)&&count===4)renderReplacement();else {pendingCity=null;renderMatches();}updatePickerCount();}
 }
 function syncView(){tray.hidden=!geo.selection.length||!['competition','explore','regions','similar'].includes(geo.activeTab);}
 function showComparison(){geo.showTab('compare');window.scrollTo({top:0,behavior:'auto'});requestAnimationFrame(()=>$('#compare-composer-title').focus({preventScroll:true}));}
 function include(id){
  if(!byId.has(id))return;
  if(!geo.selection.includes(id)&&geo.selection.length>=4){showComparison();openPicker({candidate:id});return;}
  if(!geo.selection.includes(id))geo.setSelection([...geo.selection,id]);showComparison();
 }
 function updatePickerCount(){const count=geo.selection.length;$('#cw-picker-count').textContent=count+' de 4 selecionadas';$('#cw-picker-done').disabled=!count;}
 function renderMatches(){
  $('#cw-search-step').hidden=false;$('#cw-replace-step').hidden=true;
  const q=norm($('#cw-query').value),tokens=q.split(/\s+/),selected=new Set(geo.selection);
  const operating=new Set(geo.networks.records.filter(r=>r.status==='operando').map(r=>r.id));
  matches=q?cities.filter(c=>tokens.every(t=>c.search.includes(t))).sort((a,b)=>Number(b.search.startsWith(q))-Number(a.search.startsWith(q))||a.name.localeCompare(b.name,'pt-BR')).slice(0,8):cities.filter(c=>operating.has(c.id)&&!selected.has(c.id)).sort((a,b)=>a.name.localeCompare(b.name,'pt-BR')).slice(0,6);
  active=0;
  $('#cw-results-label').textContent=q?(matches.length?'Enter adiciona a cidade selecionada.':'Nenhuma cidade encontrada. Tente outro nome ou código IBGE.'):(matches.length?'Cidades com unidades operando · ou busque qualquer município':'Busque entre '+cities.length.toLocaleString('pt-BR')+' municípios.');
  $('#cw-results').innerHTML=matches.map((c,i)=>'<button type="button" id="cw-result-'+i+'" role="option" aria-selected="'+(i===active)+'" aria-disabled="'+selected.has(c.id)+'" data-cw-result="'+i+'"><span><strong>'+esc(name(c))+'</strong><small>'+esc(c.region)+' · IBGE '+c.id+'</small></span><b>'+ (selected.has(c.id)?'Selecionada':replaceId?'Trocar':selected.size===4?'Substituir':'Adicionar +')+'</b></button>').join('');
  syncActive();
 }
 function syncActive(){matches.forEach((_,i)=>$('#cw-result-'+i)?.setAttribute('aria-selected',String(i===active)));const input=$('#cw-query');if(matches.length)input.setAttribute('aria-activedescendant','cw-result-'+active);else input.removeAttribute('aria-activedescendant');}
 function renderReplacement(){
  $('#cw-search-step').hidden=true;$('#cw-replace-step').hidden=false;
  $('#cw-replace-label').textContent='Sua seleção já tem quatro cidades. Qual delas deseja substituir por '+name(pendingCity)+'?';
  $('#cw-replacements').innerHTML=selectedCities().map(c=>'<button class="button" data-cw-swap="'+c.id+'"><span>'+esc(name(c))+'</span><span>Substituir →</span></button>').join('');
 }
 function addResult(i){
  const c=matches[i];if(!c)return;
  if(geo.selection.includes(c.id)){announce(name(c)+' já está selecionada.');return;}
  if(replaceId&&geo.selection.includes(replaceId)){const next=geo.selection.map(id=>id===replaceId?c.id:id);replaceId=null;$('#cw-query').value='';geo.setSelection(next);picker.close();return;}
  if(geo.selection.length>=4){pendingCity=c;renderReplacement();$('#cw-replacements button').focus();return;}
  $('#cw-query').value='';geo.setSelection([...geo.selection,c.id]);$('#cw-query').focus();
 }
 function openPicker({replace=null,candidate=null}={}){
  if(document.querySelector('dialog[open]'))return;
  origin=document.activeElement;replaceId=replace;pendingCity=candidate?byId.get(candidate):null;
  $('#cw-picker-title').textContent=replace?'Substituir cidade':candidate?'Ajustar seleção':'Adicionar cidades';
  $('#cw-query').value='';renderMatches();if(pendingCity)renderReplacement();updatePickerCount();picker.showModal();(pendingCity?$('#cw-replacements button'):$('#cw-query'))?.focus();
 }
 $('#cw-query').oninput=renderMatches;
 $('#cw-query').onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();picker.close();return;}if(['ArrowDown','ArrowUp'].includes(e.key)&&matches.length){e.preventDefault();active=(active+(e.key==='ArrowDown'?1:-1)+matches.length)%matches.length;syncActive();$('#cw-result-'+active).scrollIntoView({block:'nearest'});}else if(e.key==='Enter'){e.preventDefault();addResult(active);}};
 $('#cw-back').onclick=()=>{pendingCity=null;renderMatches();$('#cw-query').focus();};
 $('#cw-picker-close').onclick=()=>picker.close();
 picker.addEventListener('close',()=>{replaceId=null;pendingCity=null;const target=origin?.isConnected&&origin.tagName!=='BODY'&&origin.getClientRects().length?origin:$('#cw-slots [data-cw-add]')||$('#compare-composer-title');target?.focus({preventScroll:true});});
 picker.addEventListener('click',e=>{const result=e.target.closest('[data-cw-result]'),swap=e.target.closest('[data-cw-swap]');if(result)addResult(Number(result.dataset.cwResult));if(swap&&pendingCity){const id=pendingCity.id;pendingCity=null;geo.setSelection(geo.selection.map(c=>c===swap.dataset.cwSwap?id:c));picker.close();}if(e.target===picker){const r=picker.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)picker.close();}});
 $('#cw-picker-done').onclick=()=>{picker.close();setTimeout(showComparison,0);};
 $('#cw-open').onclick=()=>{showComparison();if(geo.selection.length===1)openPicker();};
 $('#cw-export').onclick=()=>$('#export').click();
 document.addEventListener('click',e=>{const add=e.target.closest('[data-cw-add]'),remove=e.target.closest('[data-cw-remove]'),replace=e.target.closest('[data-cw-replace]');if(add)openPicker();if(remove)geo.setSelection(geo.selection.filter(id=>id!==remove.dataset.cwRemove));if(replace)openPicker({replace:replace.dataset.cwReplace});});
 document.addEventListener('geo:selection',update);
 document.addEventListener('geo:view',syncView);
 document.addEventListener('geo:comparison-full',e=>{showComparison();openPicker({candidate:e.detail.id});});
 new ResizeObserver(()=>{
  const height=tray.hidden?0:tray.getBoundingClientRect().height+10;
  document.documentElement.style.setProperty('--comparison-tray-height',height+'px');
  requestAnimationFrame(()=>{for(const m of [geo.map,geo.competition?.map,geo.regions?.map,geo.similarity?.map])if(m&&m.getContainer().getClientRects().length){const center=m.getCenter(),zoom=m.getZoom();m.invalidateSize({pan:false});m.setView(center,zoom,{animate:false,reset:true});}});
 }).observe(tray);
 update();return {include,openPicker,showComparison};
}};
