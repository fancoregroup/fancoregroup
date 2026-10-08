'use strict';
window.GeoBrandPins={instance:null,create({networks,data,esc,num,onCity}){
 if(this.instance)return this.instance;
 const storage='fancore-geo-brand-pins-v1',legacy='fancore-geo-layers-v1',listeners=new Set(),attachments=new Map();
 const order=['agrobar','folks','estica'],brands=[...networks.brands].sort((a,b)=>order.indexOf(a.id)-order.indexOf(b.id)),cityMap=new Map(data.cities.map(c=>[c.id,c]));
 const normalize=ids=>[...new Set((Array.isArray(ids)?ids:[]).map(String))].filter(id=>brands.some(b=>b.id===id));
 let selected=brands.map(b=>b.id);
 try{const current=JSON.parse(localStorage.getItem(storage));if(Array.isArray(current?.brands))selected=normalize(current.brands);else{const old=JSON.parse(localStorage.getItem(legacy));if(Array.isArray(old?.brands))selected=normalize(old.brands);}}catch(_){}
 const save=()=>{try{localStorage.setItem(storage,JSON.stringify({brands:selected}));}catch(_){}};save();
 const pin=brand=>`<svg class="brand-pin" data-pin-brand="${brand}" viewBox="0 0 28 36" aria-hidden="true"><path d="M14 34S2 22 2 14a12 12 0 0 1 24 0c0 8-12 20-12 20Z" fill="var(--brand-${brand})" stroke="#fff" stroke-width="2" stroke-linejoin="round"/><circle cx="14" cy="14" r="4" fill="#fff"/></svg>`;
 function setBrands(ids){const next=normalize(ids);if(next.join(',')===selected.join(','))return [...selected];selected=next;save();for(const entry of attachments.values())entry.render();const state={brands:[...selected]};for(const fn of listeners)fn(state);document.dispatchEvent(new CustomEvent('geo:brands',{detail:state}));return [...selected];}
 function recordsForCity(id){return networks.at(id).filter(r=>selected.includes(r.brand));}
 function attach(map,options={}){
  if(attachments.has(map)){const item=attachments.get(map);if(Object.hasOwn(options,'ids'))item.handle.setIds(options.ids);return item.handle;}
  let ids=options.ids==null?null:new Set(options.ids.map(String)),unitCount=0,counts={},destroyed=false;
  const container=map.getContainer(),host=options.host||container,layer=L.layerGroup().addTo(map),pane='globalHoldingUnits';
  if(!map.getPane(pane))map.createPane(pane);map.getPane(pane).style.zIndex='620';
  const toolbar=document.createElement('div');toolbar.className='brand-pins-toolbar';toolbar.setAttribute('role','group');toolbar.setAttribute('aria-label','Presenças da holding no mapa, todos os status');
  toolbar.innerHTML=brands.map(b=>`<button type="button" data-map-brand="${b.id}" aria-pressed="false"><span class="brand-pins-key">${pin(b.id)}</span><span>${esc(b.name)}</span><small data-map-brand-count="${b.id}"></small></button>`).join('');
  host.append(toolbar);container.classList.add('has-brand-pins');if(host!==container)host.classList.add('brand-pins-host');
  L.DomEvent.disableClickPropagation(toolbar);L.DomEvent.disableScrollPropagation(toolbar);
  toolbar.onclick=e=>{const button=e.target.closest('[data-map-brand]');if(button){const brand=button.dataset.mapBrand;setBrands(selected.includes(brand)?selected.filter(id=>id!==brand):[...selected,brand]);}};
  const statusLabel=r=>networks.labels[r.status]||'Situação não informada';
  function popup(city,units){return `<div class="geo-popup brand-pins-popup"><h3><button type="button" class="cp-city-link" data-brand-pin-open="${city.id}">${esc(city.name)} / ${esc(city.uf)}</button></h3>${units.map(unit=>`<p><b>${esc(unit.brandName)}</b> · ${esc([...new Set(unit.records.map(statusLabel))].join(' · '))}</p>`).join('')}<small>Presenças informadas por município. Situação original preservada; não representa quantidade de lojas nem endereço exato.</small><button type="button" class="button primary" data-brand-pin-open="${city.id}">Analisar cidade</button></div>`;}
  function openPopup(event){const element=event.popup.getElement();if(!element)return;element.querySelectorAll('[data-brand-pin-open]').forEach(button=>{button.onclick=e=>{e.stopPropagation();(options.onCity||onCity)?.(button.dataset.brandPinOpen);};});}
  function render(){
   if(destroyed)return;layer.clearLayers();counts=Object.fromEntries(brands.map(b=>[b.id,0]));unitCount=0;
   const known=new Map();
   for(const record of networks.records){const city=cityMap.get(record.id);if(!city||!Number.isFinite(city.lat)||!Number.isFinite(city.lng)||(ids&&!ids.has(city.id)))continue;if(!known.has(city.id))known.set(city.id,{city,brands:new Map()});const item=known.get(city.id);if(!item.brands.has(record.brand))item.brands.set(record.brand,{brand:record.brand,brandName:record.brandName||brands.find(b=>b.id===record.brand)?.name||record.brand,records:[]});item.brands.get(record.brand).records.push(record);}
   const points=[];
   for(const item of known.values()){for(const brand of item.brands.keys())if(Object.hasOwn(counts,brand))counts[brand]++;const units=brands.filter(b=>selected.includes(b.id)&&item.brands.has(b.id)).map(b=>item.brands.get(b.id));if(units.length){unitCount++;points.push({city:item.city,units});}}
   const groups=[];
   for(const item of points){const point=map.latLngToLayerPoint([item.city.lat,item.city.lng]);let group=map.getZoom()<7?groups.find(g=>Math.hypot(g.point.x-point.x,g.point.y-point.y)<44):null;if(!group){group={point,items:[]};groups.push(group);}group.items.push(item);}
   for(const group of groups){if(group.items.length>1){
     const points=group.items.map(i=>[i.city.lat,i.city.lng]),center=L.latLngBounds(points).getCenter(),included=brands.filter(b=>group.items.some(i=>i.units.some(u=>u.brand===b.id)));
     const icon=L.divIcon({className:'holding-cluster global-holding-cluster',html:`<strong>${group.items.length}</strong><span class="cluster-brands" aria-hidden="true">${included.map(b=>`<i style="background:var(--brand-${b.id})"></i>`).join('')}</span>`,iconSize:[38,40],iconAnchor:[19,20]});
     L.marker(center,{icon,pane,title:group.items.length+' municípios com presenças informadas'}).bindTooltip(`${group.items.length} municípios · ${included.map(b=>esc(b.name)).join(', ')}<br>Clique para aproximar`).on('click',()=>map.fitBounds(points,{paddingTopLeft:[35,85],paddingBottomRight:[35,35],maxZoom:9,animate:false})).addTo(layer);
    }else{const {city,units}=group.items[0];units.forEach((unit,index)=>{
     const offset=(index-(units.length-1)/2)*28,description=esc(unit.brandName)+' · '+esc(city.name)+' / '+esc(city.uf),statuses=[...new Set(unit.records.map(statusLabel))].join(' · ');
     const icon=L.divIcon({className:'holding-marker global-holding-marker',html:pin(unit.brand),iconSize:[28,36],iconAnchor:[14-offset,34],popupAnchor:[offset,-32],tooltipAnchor:[offset,-28]});
     L.marker([city.lat,city.lng],{icon,pane,riseOnHover:true,title:unit.brandName+' · '+city.name+' / '+city.uf+' · '+statuses}).bindTooltip(description+'<br>'+esc(statuses)).bindPopup(()=>popup(city,units),{maxWidth:310,autoPanPaddingTopLeft:[15,85],autoPanPaddingBottomRight:[15,15]}).addTo(layer);
    });}
   }
   for(const button of toolbar.querySelectorAll('[data-map-brand]')){const brand=button.dataset.mapBrand,visible=selected.includes(brand);button.setAttribute('aria-pressed',String(visible));button.setAttribute('aria-label',(visible?'Ocultar':'Mostrar')+' '+brands.find(b=>b.id===brand).name+' no mapa');button.title=num(counts[brand]||0)+' municípios com presença informada, todos os status';button.querySelector('[data-map-brand-count]').textContent=num(counts[brand]||0);}
  }
  function destroy(){if(destroyed)return;destroyed=true;map.off('zoomend',render);map.off('popupopen',openPopup);map.off('unload',destroy);toolbar.remove();container.classList.remove('has-brand-pins');if(map.hasLayer(layer))map.removeLayer(layer);attachments.delete(map);}
  const handle={destroy,setIds(next){ids=next==null?null:new Set(next.map(String));render();},layer,get unitCount(){return unitCount;},get counts(){return {...counts};},get toolbar(){return toolbar;}};
  attachments.set(map,{render,handle});map.on('zoomend',render);map.on('popupopen',openPopup);map.on('unload',destroy);render();return handle;
 }
 const api={attach,setBrands,recordsForCity,subscribe(fn){listeners.add(fn);return ()=>listeners.delete(fn);},get state(){return {brands:[...selected]};}};this.instance=api;return api;
},attach(map,options){return this.instance?.attach(map,options);}};
