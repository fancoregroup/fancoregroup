'use strict';
window.GeoLayers={mount(ctx){
 const {networks,cnpj,esc,num,css}=ctx,$=s=>document.querySelector(s),storage='fancore-geo-layers-v1';let map=ctx.map,unsubscribeBrands=null;
 let state={brands:networks.brands.map(b=>b.id),niches:[],indicator:false,mode:'primary'},cities=[],unitCount=0,nicheCounts={};
 try{const saved=JSON.parse(localStorage.getItem(storage));if(saved){state={brands:Array.isArray(saved.brands)?saved.brands.filter(id=>networks.brands.some(b=>b.id===id)):state.brands,niches:Array.isArray(saved.niches)?saved.niches.filter(id=>cnpj.niches.some(n=>n.id===id)&&cnpj.available(id)):[],indicator:saved.indicator===true,mode:saved.mode==='any'?'any':'primary'};}}catch(_){}
 if(location.hash==='#concorrencia-estica')state.niches=['academias'];if(location.hash==='#alimentacao-lazer')state.niches=['bars'];
 const brandPins=ctx.brandPins||window.GeoBrandPins?.instance;let holding=brandPins?.attach(map);if(brandPins)state.brands=brandPins.state.brands;
 const pin=brand=>`<svg class="brand-pin" data-pin-brand="${brand}" viewBox="0 0 28 36" aria-hidden="true"><path d="M14 34S2 22 2 14a12 12 0 0 1 24 0c0 8-12 20-12 20Z" fill="var(--brand-${brand})" stroke="#fff" stroke-width="2" stroke-linejoin="round"/><circle cx="14" cy="14" r="4" fill="#fff"/></svg>`;
 const legend=$('#map-legend'),legendStorage='fancore-geo-legend-v1';let legendOpen=false;
 try{legendOpen=localStorage.getItem(legendStorage)==='open';}catch(_){}
 legend.innerHTML='<button class="legend-toggle" aria-controls="map-legend-body"><span>Legenda</span><span class="legend-action"></span></button><div id="map-legend-body"></div>';
 const legendToggle=legend.querySelector('.legend-toggle'),legendBody=$('#map-legend-body');
 function syncLegend(){legendBody.hidden=!legendOpen;legendToggle.setAttribute('aria-expanded',String(legendOpen));legendToggle.setAttribute('aria-label',legendOpen?'Esconder legenda':'Mostrar legenda');legend.querySelector('.legend-action').textContent=legendOpen?'Esconder':'+';}
 legendToggle.onclick=()=>{legendOpen=!legendOpen;syncLegend();try{localStorage.setItem(legendStorage,legendOpen?'open':'closed');}catch(_){}};
 legend.addEventListener('keydown',e=>{if(e.key==='Escape'&&legendOpen){e.stopPropagation();legendToggle.click();legendToggle.focus();}});
 L.DomEvent.disableClickPropagation(legend);L.DomEvent.disableScrollPropagation(legend);syncLegend();
 let unitLayer=holding?.layer||L.layerGroup().addTo(map);const nicheLayer=L.layerGroup().addTo(map);
 map.createPane('holdingUnits');map.getPane('holdingUnits').style.zIndex='620';
 const host=document.createElement('aside');host.className='map-layer-control';host.setAttribute('aria-label','Camadas do mapa');
 const button=n=>`<button class="layer-button" data-layer-niche="${n.id}" aria-pressed="false" ${cnpj.available(n)?'':'disabled'}><i class="niche-key" style="--niche-color:var(--${n.tone})">${n.symbol}</i><span>${esc(n.label)}</span><b data-niche-count="${n.id}"></b></button>`;
 host.innerHTML=`<button class="layers-heading" aria-expanded="false" aria-controls="map-layers-body"><span>Camadas</span><span class="layers-arrow">−</span></button><div id="map-layers-body" hidden><div class="layer-section"><h3>Unidades da holding</h3>${networks.brands.map(b=>`<button class="layer-button" data-layer-brand="${b.id}" aria-pressed="true"><i class="brand-key">${pin(b.id)}</i><span>${esc(b.name)}</span><b data-brand-count="${b.id}"></b></button>`).join('')}</div><div class="layer-section"><h3>Nichos de mercado</h3>${cnpj.common.map(button).join('')}<details class="more-niches"><summary>Mais nichos</summary>${cnpj.niches.filter(n=>!cnpj.common.includes(n)).map(button).join('')}</details></div><label class="layer-mode">Atividade cadastrada<select id="layer-mode"><option value="primary">Somente principal</option><option value="any">Principal ou secundária</option></select></label><button class="layer-button layer-indicator" aria-pressed="false"><i class="niche-key">○</i><span>Indicador municipal</span></button><p class="layer-note">${cnpj.errors.length?'Uma base CNPJ está indisponível. Nichos afetados ficam desativados.':'CNPJs por cidade · set/2026'}<br>Pins municipais, sem endereço exato.</p><button class="text-button layer-sources">Fontes e downloads</button></div>`;
 if(holding)host.querySelector('.layer-section').hidden=true;
 document.querySelector('#explore-panel .map-wrap').append(host);L.DomEvent.disableClickPropagation(host);L.DomEvent.disableScrollPropagation(host);
 const heading=host.querySelector('.layers-heading'),body=host.querySelector('#map-layers-body');
 heading.onclick=()=>{body.hidden=!body.hidden;heading.setAttribute('aria-expanded',String(!body.hidden));heading.querySelector('.layers-arrow').textContent=body.hidden?'+':'−';};
 host.addEventListener('keydown',e=>{if(e.key==='Escape'&&!body.hidden){e.stopPropagation();heading.click();heading.focus();}});
 heading.querySelector('.layers-arrow').textContent=body.hidden?'+':'−';
 function save(){try{localStorage.setItem(storage,JSON.stringify(state));}catch(_){}}
 function controls(){for(const b of host.querySelectorAll('[data-layer-brand]'))b.setAttribute('aria-pressed',String(state.brands.includes(b.dataset.layerBrand)));for(const b of host.querySelectorAll('[data-layer-niche]'))b.setAttribute('aria-pressed',String(state.niches.includes(b.dataset.layerNiche)));host.querySelector('.layer-indicator').setAttribute('aria-pressed',String(state.indicator));$('#layer-mode').value=state.mode;}
 function notify(niche){save();controls();ctx.onChange(niche);}
 function enableNiche(id,on=true){if(!cnpj.available(id))return;state.niches=state.niches.filter(n=>n!==id);if(on)state.niches.push(id);notify(on?id:undefined);}
 host.onclick=e=>{const b=e.target.closest('[data-layer-brand]'),n=e.target.closest('[data-layer-niche]');if(b){const id=b.dataset.layerBrand;if(brandPins)brandPins.setBrands(state.brands.includes(id)?state.brands.filter(x=>x!==id):[...state.brands,id]);else{state.brands=state.brands.includes(id)?state.brands.filter(x=>x!==id):[...state.brands,id];notify();}}else if(n){const id=n.dataset.layerNiche;enableNiche(id,!state.niches.includes(id));}};
 host.querySelector('.layer-indicator').onclick=()=>{state.indicator=!state.indicator;notify();};$('#layer-mode').onchange=()=>{state.mode=$('#layer-mode').value;notify();};host.querySelector('.layer-sources').onclick=()=>ctx.showTab('sources');
 const visibleUnits=id=>brandPins?brandPins.recordsForCity(id):networks.at(id).filter(r=>state.brands.includes(r.brand)&&ctx.unitVisible(r));
 if(brandPins){unsubscribeBrands=brandPins.subscribe(next=>{state.brands=[...next.brands];notify();});map.once('unload',unsubscribeBrands);}
 function popup(city){const units=visibleUnits(city.id),ns=state.niches.map(id=>cnpj.niches.find(n=>n.id===id));return `<div class="geo-popup"><h3><button class="cp-city-link" data-profile-city="${city.id}">${esc(city.name)} / ${city.uf}</button></h3>${units.map(r=>`<p><b>${esc(r.brandName)}</b> · ${esc(networks.labels[r.status])}</p>`).join('')}${ns.length?`<div class="popup-niches">${ns.map(n=>`<p><span>${esc(n.label)}</span><b>${num(cnpj.count(city.id,n,state.mode))}</b></p>`).join('')}</div><small>CNPJs ativos · ${state.mode==='primary'?'principal':'principal ou secundária'} · set/2026. Grupos podem se sobrepor.</small>`:''}<small>Localização municipal aproximada.</small><button class="button primary" data-city="${city.id}">Analisar cidade</button></div>`;}
 function render(list){
  if(!map.getPane('marketNiches'))map.createPane('marketNiches');map.getPane('marketNiches').style.zIndex='520';
  cities=list;if(!holding)unitLayer.clearLayers();nicheLayer.clearLayers();unitCount=holding?.unitCount||0;nicheCounts={};
  const defs=cnpj.niches.filter(n=>state.niches.includes(n.id)),scale=Math.min(1,Math.max(.45,map.getZoom()/8));
  const max=Object.fromEntries(defs.map(n=>[n.id,Math.max(1,...cities.map(c=>cnpj.count(c.id,n,state.mode)||0))]));
  const brandCounts=holding?holding.counts:Object.fromEntries(networks.brands.map(b=>[b.id,0]));
  for(const n of cnpj.niches)nicheCounts[n.id]=cnpj.available(n)?cities.reduce((s,c)=>s+(cnpj.count(c.id,n,state.mode)||0),0):null;
  const unitPoints=[];
  for(const city of cities){
   if(!Number.isFinite(city.lat)||!Number.isFinite(city.lng))continue;
   const text=()=>popup(city),units=visibleUnits(city.id);
   // Outlined concentric circles retain simultaneous layers without summing overlapping groups.
   for(let i=defs.length-1;i>=0;i--){const n=defs[i],value=cnpj.count(city.id,n,state.mode);if(!value)continue;
    L.circleMarker([city.lat,city.lng],{pane:'marketNiches',radius:(2+Math.log1p(value)/Math.log1p(max[n.id])*5+i*2)*scale,color:css(n.tone),weight:defs.length>1?1.3:.7,fillColor:css(n.tone),fillOpacity:defs.length>1?.05:.45}).bindTooltip(`${esc(city.name)} / ${city.uf}<br>${defs.map(d=>`${esc(d.label)}: ${num(cnpj.count(city.id,d,state.mode))}`).join('<br>')}`).bindPopup(text,{maxWidth:300}).addTo(nicheLayer);
   }
   if(!holding&&units.length){unitCount++;for(const r of units)brandCounts[r.brand]++;unitPoints.push({city,units});}
  }
  const groups=[];
  for(const item of unitPoints){const p=map.latLngToLayerPoint([item.city.lat,item.city.lng]);let group=map.getZoom()<7?groups.find(g=>Math.hypot(g.point.x-p.x,g.point.y-p.y)<44):null;if(!group){group={point:p,items:[]};groups.push(group);}group.items.push(item);}
  for(const group of groups){
   if(group.items.length>1){
    const points=group.items.map(x=>[x.city.lat,x.city.lng]),center=L.latLngBounds(points).getCenter(),brands=networks.brands.filter(b=>group.items.some(x=>x.units.some(r=>r.brand===b.id)));
    const icon=L.divIcon({className:'holding-cluster',html:`<strong>${group.items.length}</strong><span class="cluster-brands" aria-hidden="true">${brands.map(b=>`<i style="background:var(--brand-${b.id})"></i>`).join('')}</span>`,iconSize:[38,40],iconAnchor:[19,20]});
    L.marker(center,{icon,pane:'holdingUnits',title:group.items.length+' cidades com unidades'}).bindTooltip(`${group.items.length} cidades · ${brands.map(b=>esc(b.name)).join(', ')}<br>Clique para aproximar`).on('click',()=>map.fitBounds(points,{paddingTopLeft:[45,60],paddingBottomRight:[innerWidth>760?240:40,100],maxZoom:9,animate:false})).addTo(unitLayer);
   }else{
    const {city,units}=group.items[0];
    units.forEach((r,i)=>{
     // Pixel offsets separate brands sharing the same municipal coordinate.
     const offset=(i-(units.length-1)/2)*28;
     const icon=L.divIcon({className:'holding-marker',html:pin(r.brand),iconSize:[28,36],iconAnchor:[14-offset,34],popupAnchor:[offset,-32],tooltipAnchor:[offset,-28]});
     L.marker([city.lat,city.lng],{icon,pane:'holdingUnits',riseOnHover:true,title:`${r.brandName} · ${city.name} / ${city.uf} · ${networks.labels[r.status]}`}).bindTooltip(`${esc(r.brandName)} · ${esc(city.name)} / ${city.uf}<br>${esc(networks.labels[r.status])}`).bindPopup(()=>popup(city),{maxWidth:310}).addTo(unitLayer);
    });
   }
  }
  for(const b of networks.brands)host.querySelector(`[data-brand-count="${b.id}"]`).textContent=num(brandCounts[b.id]);
  for(const n of cnpj.niches){const el=host.querySelector(`[data-niche-count="${n.id}"]`);if(el)el.textContent=cnpj.available(n)?num(nicheCounts[n.id]):'n/d';}
  legendBody.innerHTML=`<div class="brand-legend">${networks.brands.filter(b=>state.brands.includes(b.id)).map(b=>`<span>${pin(b.id)}${esc(b.name)}</span>`).join('')}</div><div class="layer-legend-title">${num(unitCount)} ${unitCount===1?'município com presença visível':'municípios com presenças visíveis'}</div><small>Cor do pin = marca. Todos os status; situação ao abrir.<br>Presenças independem dos filtros da análise.<br>Números agrupam cidades. Clique para aproximar.</small>${defs.length?`<div class="niche-legend">${defs.map(n=>`<span><i style="border-color:var(--${n.tone})"></i>${esc(n.label)}</span>`).join('')}</div><small>Círculo maior = mais CNPJs no nicho · escala logarítmica. Não some os grupos.</small>`:''}${state.indicator&&map.getContainer().id==='map'?'<small>Pontos municipais: '+esc(ctx.indicatorLabel())+' · escala logarítmica.</small>':''}`;
  controls();
 }
 function redraw(){render(cities);}
 function retarget(nextMap,nextHost){
  if(!nextMap||!nextHost)return false;
  nextHost.append(host,legend);
  if(nextMap===map){render(cities);return true;}
  map.off('zoomend',redraw);if(unsubscribeBrands)map.off('unload',unsubscribeBrands);
  if(map.hasLayer(nicheLayer))map.removeLayer(nicheLayer);
  if(!holding&&map.hasLayer(unitLayer))map.removeLayer(unitLayer);
  map=nextMap;holding=brandPins?.attach(map);unitLayer=holding?.layer||unitLayer;
  if(!holding){if(!map.getPane('holdingUnits'))map.createPane('holdingUnits');map.getPane('holdingUnits').style.zIndex='620';unitLayer.addTo(map);}
  if(!map.getPane('marketNiches'))map.createPane('marketNiches');map.getPane('marketNiches').style.zIndex='520';
  nicheLayer.addTo(map);map.on('zoomend',redraw);if(unsubscribeBrands)map.once('unload',unsubscribeBrands);
  render(cities);return true;
 }
 controls();return {render,retarget,enableNiche,visibleUnits,get state(){return {...state,brands:[...state.brands],niches:[...state.niches]};},get unitCount(){return holding?.unitCount??unitCount;},get nicheCounts(){return nicheCounts;},get unitLayer(){return unitLayer;},get nicheLayer(){return nicheLayer;}};
}};
