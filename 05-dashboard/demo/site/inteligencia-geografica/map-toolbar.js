'use strict';
/* Reuse existing map controls in one row, including maps created lazily. */
(()=>{
 const specs=[
  {id:'ic-map',host:'.ic-chart-card',source:'.ic-chart-toolbar'},
  {id:'rg-map',host:'.rg-map-card',source:'.rg-map-toolbar'},
  {id:'similar-map',host:'.similar-map-wrap',source:'.similar-map-top'},
  {id:'map',host:'.map-wrap',source:'.map-controls'}
 ];
 const records=new Map();let scheduled=false,observer;
 function make(map,host,spec){
  const bar=document.createElement('div');bar.className='geo-map-toolbar';bar.dataset.map=spec.id;bar.setAttribute('role','group');bar.setAttribute('aria-label','Ferramentas do mapa');
  const row=document.createElement('div');row.className='geo-map-toolbar-scroll';row.tabIndex=0;row.setAttribute('aria-label','Controles do mapa. Role horizontalmente para ver mais opções.');bar.append(row);host.prepend(bar);host.classList.add('has-map-toolbar');
  if(window.L){L.DomEvent.disableClickPropagation(bar);L.DomEvent.disableScrollPropagation(bar);}
  row.addEventListener('keydown',event=>{if(event.target===row&&['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();row.scrollBy({left:event.key==='ArrowRight'?180:-180,behavior:'auto'});}if(event.key==='Escape'){const panel=host.querySelector('.map-layer-control'),heading=panel?.__geoToolbarHeading;if(panel&&!panel.querySelector('#map-layers-body')?.hidden){event.stopPropagation();heading?.click();heading?.focus();}}});
  row.addEventListener('focusin',event=>{const target=event.target;if(target===row)return;const r=target.getBoundingClientRect(),frame=row.getBoundingClientRect();if(r.left<frame.left+8)row.scrollLeft-=frame.left+8-r.left;else if(r.right>frame.right-8)row.scrollLeft+=r.right-frame.right+8;});
  const resize=new ResizeObserver(()=>{bar.classList.toggle('has-horizontal-scroll',row.scrollWidth>row.clientWidth+1);});resize.observe(row);
  const record={map,host,spec,bar,row,nodes:[],pins:null,zoom:null,resize};records.set(spec.id,record);return record;
 }
 function reconcile(spec){
  const map=document.getElementById(spec.id),host=map?.closest(spec.host);if(!map||!host||!map.classList.contains('leaflet-container'))return;
  let item=records.get(spec.id);if(!item||item.host!==host){item?.resize.disconnect();item?.bar.remove();item=make(map,host,spec);}
  const {bar,row}=item,source=host.querySelector(spec.source);
  if(source&&source!==bar){if(source.matches('button,a,label')){if(!item.nodes.includes(source))item.nodes.push(source);}else{for(const node of [...source.children])if(node.matches('button,a,label,select,[role="group"]')&&!item.nodes.includes(node))item.nodes.push(node);if(!source.hidden)source.hidden=true;source.classList.add('geo-toolbar-source');}}
  const pins=map.querySelector('.brand-pins-toolbar');if(pins)item.pins=pins;
  const zoom=map.querySelector('.leaflet-control-zoom');if(zoom)item.zoom=zoom;
  const panel=host.querySelector('.map-layer-control');let heading;
  if(panel){heading=panel.__geoToolbarHeading||panel.querySelector('.layers-heading');if(heading){panel.__geoToolbarHeading=heading;panel.classList.add('geo-toolbar-layer-panel');heading.classList.add('geo-toolbar-layers-button');heading.setAttribute('aria-haspopup','true');}}
  const nodes=item.nodes.filter(node=>node.isConnected),variables=nodes.filter(node=>node.matches('label,select')),actions=nodes.filter(node=>!variables.includes(node));
  const ordered=[...variables,item.pins?.isConnected?item.pins:null,...actions,heading,item.zoom?.isConnected?item.zoom:null].filter(Boolean);
  for(const [index,node] of ordered.entries()){if(row.children[index]!==node)row.insertBefore(node,row.children[index]||null);}
  if(item.pins?.isConnected)item.pins.classList.add('geo-toolbar-brand-group');
  if(item.zoom?.isConnected)item.zoom.classList.add('geo-toolbar-zoom');
  bar.classList.toggle('has-horizontal-scroll',row.scrollWidth>row.clientWidth+1);
 }
 function refresh(){scheduled=false;for(const spec of specs)reconcile(spec);}
 function schedule(){if(scheduled)return;scheduled=true;requestAnimationFrame(refresh);}
 function start(){observer=new MutationObserver(schedule);observer.observe(document.body,{childList:true,subtree:true});schedule();document.addEventListener('click',event=>{for(const spec of specs){const item=records.get(spec.id),panel=item?.host.querySelector('.map-layer-control'),heading=panel?.__geoToolbarHeading;if(panel&&!panel.querySelector('#map-layers-body')?.hidden&&!panel.contains(event.target)&&!heading?.contains(event.target))heading?.click();}});}
 window.GeoMapToolbar={refresh:schedule};if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
