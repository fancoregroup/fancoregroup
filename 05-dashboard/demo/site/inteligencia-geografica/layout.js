'use strict';
/* Layout comum às três análises. Preserva os controles e os cálculos existentes. */
(()=>{
 const $=s=>document.querySelector(s),main=$('#main');
 const exportButton=$('#export');$('.tabs').append(exportButton);
 const focus=document.createElement('button');focus.className='button map-focus';focus.type='button';focus.textContent='Ampliar mapa';focus.setAttribute('aria-pressed','false');$('.tabs').append(focus);
 const heading=$('.heading');heading.classList.add('sr-only');
 const freshness=$('#freshness');$('footer').prepend(freshness);
 const configs=[
  {panel:'explore',workspace:'.workspace',aside:'.ranking',summary:'#summary',primary:['search','uf'],title:'Explorar mercados'},
  {panel:'similar',workspace:'.similar-workspace',aside:'.similar-ranking',summary:'#similar-summary',primary:['similar-brand','similar-reference','similar-search'],title:'Cidades semelhantes'}
 ];
 function resizeMaps(){requestAnimationFrame(()=>{
  for(const workspace of document.querySelectorAll('.map-workspace')){
   if(!workspace.getClientRects().length)continue;
   const top=workspace.getBoundingClientRect().top+scrollY;
   workspace.style.setProperty('--geo-map-height',Math.max(innerWidth<=760?390:460,innerHeight-top-12)+'px');
  }
  window.FancoreGeo?.map?.invalidateSize();window.FancoreGeo?.similarity?.map?.invalidateSize();
 });}
 const toolbarObserver=new ResizeObserver(resizeMaps);
 for(const conf of configs){
  const panel=$('#'+conf.panel+'-panel'),filters=panel.querySelector('.filters'),workspace=panel.querySelector(conf.workspace),aside=panel.querySelector(conf.aside),summary=panel.querySelector(conf.summary);
  panel.classList.add('map-panel');workspace.classList.add('map-workspace');aside.classList.add('map-sidebar');aside.prepend(summary);
  const info=panel.querySelector('.similar-intro,.cnpj-intro');if(info)info.classList.add('sr-only');
  filters.classList.add('map-toolbar');filters.setAttribute('aria-label',conf.title);
  toolbarObserver.observe(filters);
  const reset=filters.querySelector('button'),labels=[...filters.querySelectorAll('label')];
  const extras=document.createElement('div');extras.className='advanced-filters';extras.id=conf.panel+'-advanced';extras.hidden=true;
  const top=document.createElement('div');top.className='advanced-heading';top.innerHTML='<strong>Refinar o recorte</strong>';
  const close=document.createElement('button');close.type='button';close.className='button';close.textContent='Fechar';top.append(close);extras.append(top);
  for(const label of labels){const field=label.querySelector('input,select');if(!conf.primary.includes(field.id))extras.append(label);}
  for(const id of conf.primary){const field=$('#'+id);if(field)filters.append(field.closest('label'));}
  const more=document.createElement('button');more.type='button';more.className='button filters-toggle';more.setAttribute('aria-expanded','false');more.setAttribute('aria-controls',extras.id);more.textContent='Filtros';
  filters.append(more);if(reset)filters.append(reset);filters.append(extras);
  function setOpen(open){extras.hidden=!open;more.setAttribute('aria-expanded',String(open));if(open){close.focus();}else if(extras.contains(document.activeElement)){more.focus();}}
  more.onclick=()=>setOpen(extras.hidden);close.onclick=()=>setOpen(false);
  extras.addEventListener('keydown',event=>{if(event.key==='Escape'){event.stopPropagation();setOpen(false);}});
  document.addEventListener('click',event=>{if(!extras.hidden&&!extras.contains(event.target)&&!more.contains(event.target))setOpen(false);});
  function updateCount(){const n=[...extras.querySelectorAll('input,select')].filter(el=>el.tagName==='SELECT'?el.selectedIndex>0:el.value.trim()!=='').length;more.textContent=n?'Filtros · '+n:'Filtros';more.classList.toggle('has-filters',n>0);}
  extras.addEventListener('input',updateCount);filters.addEventListener('change',updateCount);reset?.addEventListener('click',()=>setTimeout(updateCount,0));
  const toggle=document.createElement('button');toggle.className='button sidebar-toggle';toggle.type='button';toggle.textContent='Ocultar lista';toggle.setAttribute('aria-expanded','true');toggle.setAttribute('aria-label','Ocultar lista de '+conf.title.toLowerCase());
  toggle.onclick=()=>{const collapsed=workspace.classList.toggle('sidebar-collapsed');toggle.textContent=collapsed?'Mostrar lista':'Ocultar lista';toggle.setAttribute('aria-expanded',String(!collapsed));toggle.setAttribute('aria-label',toggle.textContent+' de '+conf.title.toLowerCase());resizeMaps();};
  filters.insertBefore(toggle,extras);
 }
 focus.onclick=()=>{const on=main.classList.toggle('map-expanded');focus.textContent=on?'Voltar à análise':'Ampliar mapa';focus.setAttribute('aria-pressed',String(on));resizeMaps();};
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&main.classList.contains('map-expanded'))focus.click();});
 const observer=new MutationObserver(()=>{const hasMap=configs.some(c=>!$('#'+c.panel+'-panel').hidden);focus.hidden=!hasMap;main.classList.toggle('has-map',hasMap);resizeMaps();});
 for(const panel of document.querySelectorAll('.tab-panel'))observer.observe(panel,{attributes:true,attributeFilter:['hidden']});
 observer.observe(main,{attributes:true,attributeFilter:['hidden']});window.addEventListener('resize',resizeMaps);
 window.GeoLayout={resizeMaps};
})();
