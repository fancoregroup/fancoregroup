'use strict';
window.GeoHeatmapUI={create({map,engine,esc,num,css,onCity,legend}){
 const cache=new Map(),pane='marketHeatmap';if(!map.getPane(pane))map.createPane(pane);map.getPane(pane).style.zIndex='450';
 let layer=null,enabled=false,metric='population',ids=null,ticket=0,level='macro',groups=[],stateBounds,scale=null,legendOpen=false;
 const thermal=['#3155a4','#69c8d9','#c5eee5','#fff0a6','#f6a03c','#e64b35','#8d1023'];
 const levels={macro:'Grandes regiões',intermediate:'Regiões intermediárias',immediate:'Regiões imediatas',city:'Municípios'};
 const levelForZoom=z=>z<5?'macro':z<6.5?'intermediate':z<8?'immediate':'city';
 const metadata=()=>engine.metrics.find(m=>m.id===metric)||{};
 const number=v=>Number.isFinite(v)?new Intl.NumberFormat('pt-BR',{notation:'compact',maximumFractionDigits:1}).format(v):'Sem dado';
 const format=v=>!Number.isFinite(v)?'Sem dado':(metadata().unit?.startsWith('R$')?'R$ ':'')+number(v)+(metadata().unit==='%'?'%':'');
 const full=v=>!Number.isFinite(v)?'Sem dado':(metadata().unit?.startsWith('R$')?'R$ ':'')+num(v,2)+(metadata().unit==='%'?'%':'');
 function fetchGeo(url){if(!cache.has(url))cache.set(url,fetch(url).then(r=>{if(!r.ok)throw Error('Limites indisponíveis');return r.json();}).catch(error=>{cache.delete(url);throw error;}));return cache.get(url);}
 const bandColor=index=>thermal[scale.bands.length===1?3:Math.round(index*(thermal.length-1)/(scale.bands.length-1))];
 const bandRange=band=>scale.method==='constant'?full(band.min):scale.bands.length===1?full(band.min)+' a '+full(band.max):band.index===0?'Até '+full(band.max):'Acima de '+full(band.lowerExclusive)+' até '+full(band.max);
 function clear(){ticket++;if(layer){map.removeLayer(layer);layer=null;}}
 function renderLegend(missing=0,status=''){
  if(!legend)return;const meta=metadata();legend.classList.add('market-heat-legend');
  const bands=scale.bands,plural=level==='city'?'municípios':'regiões';
  legendOpen=legend.querySelector('.market-heat-method')?.open??legendOpen;
  legend.innerHTML=`<div class="market-heat-heading"><strong>${esc(meta.label||metric)}</strong><span>${esc(levels[level])}</span></div>${bands.length?`<div class="market-heat-direction"><span>${scale.method==='constant'?'Valor único no recorte':'Menores valores'}</span>${scale.method!=='constant'?'<span>Maiores valores</span>':''}</div><div class="market-heat-scale"><span>${format(scale.min)}</span><div class="market-heat-strip" role="img" aria-label="Escala térmica em ${bands.length} faixas relativas, de ${full(scale.min)} a ${full(scale.max)}">${bands.map(b=>`<i data-heat-band="${b.index}" style="background:${bandColor(b.index)}" title="${esc(bandRange(b))}" aria-hidden="true"></i>`).join('')}</div>${scale.method!=='constant'?`<span>${format(scale.max)}</span>`:''}</div>`:'<small>Sem valores disponíveis neste recorte.</small>'}<small>${esc(meta.year||'')} · ${esc(meta.unit||'')} · ${esc(level==='city'?'Valor municipal':meta.aggregationLabel||'')}</small>${bands.length?`<details class="market-heat-method" ${legendOpen?'open':''}><summary>${bands.length===1?'1 faixa':bands.length+' faixas relativas'} · Ver intervalos</summary><div class="market-heat-intervals">${bands.map(b=>`<div><i style="background:${bandColor(b.index)}" aria-hidden="true"></i><span>${esc(bandRange(b))}</span><small>${num(b.count)} ${plural}</small></div>`).join('')}</div><p>${scale.method==='constant'?'Todos os valores disponíveis são iguais.':`Cores dividem as ${level==='city'?'cidades':'regiões'} do recorte em grupos de tamanho parecido, mantendo valores iguais juntos. Mostram a posição relativa, não uma diferença proporcional entre valores.`} A escala muda com o indicador, os filtros ou o nível territorial, e permanece igual ao arrastar o mapa.</p></details>`:''}${missing?`<small class="market-heat-missing"><i aria-hidden="true"></i>${num(missing)} ${plural} sem dado</small>`:''}<small class="market-heat-status">${esc(status||'Aproxime para detalhar regiões e municípios.')}</small>`;
  const details=legend.querySelector('.market-heat-method');if(details)details.ontoggle=()=>{if(details.isConnected)legendOpen=details.open;};
 }
 async function render(){
  if(!enabled||window.FancoreGeo?.activeTab!=='competition')return;const currentTicket=++ticket;level=levelForZoom(map.getZoom());groups=engine.groups(metric,level,ids);scale=GeoHeatScale.create(groups.map(g=>g.value),7);
  renderLegend(groups.length-scale.count,'Carregando limites…');
  if(layer){map.removeLayer(layer);layer=null;}
  try{
   let geo;if(level==='city'){
    const bounds=map.getBounds().pad(.15),allowed=new Set(groups.map(g=>g.id.slice(0,2)));
    if(!stateBounds){const states=await fetchGeo('../mapa-agrobar/assets/brasil.geojson');stateBounds=states.features.map(feature=>{const corners=[];function walk(coords){if(typeof coords[0]==='number')corners.push([coords[1],coords[0]]);else coords.forEach(walk);}walk(feature.geometry.coordinates);return {id:String(feature.properties.codarea),bounds:L.latLngBounds(corners)};});}
    const ufs=stateBounds.filter(s=>allowed.has(s.id)&&bounds.intersects(s.bounds)).map(s=>s.id);
    const files=await Promise.all(ufs.map(uf=>fetchGeo('malhas/'+uf+'.json')));geo={type:'FeatureCollection',features:files.flatMap(g=>g.features)};
   }else geo=await fetchGeo('dados/heatmap-'+level+'.json');
   if(currentTicket!==ticket||!enabled)return;
   const byId=new Map(groups.map(g=>[String(g.id),g]));
   const features=geo.features.filter(f=>byId.has(String(f.properties.id??f.properties.codarea)));
   const style=f=>{const g=byId.get(String(f.properties.id??f.properties.codarea)),index=scale.classify(g.value),present=index!==null;return {pane,color:present?'#111516':css('muted'),opacity:present?.6:1,weight:level==='macro'?1.25:.65,fillColor:present?bandColor(index):'#8f8f8f',fillOpacity:present?1:.3,dashArray:present?null:'4 3'};};
   layer=L.geoJSON({type:'FeatureCollection',features},{pane,style,onEachFeature:(feature,shape)=>{
    const g=byId.get(String(feature.properties.id??feature.properties.codarea));
    const band=scale.classify(g.value);
    shape.bindTooltip(`<strong>${esc(g.name)}${g.uf?' / '+esc(g.uf):''}</strong><br>${full(g.value)}<br>${esc(metadata().label||metric)} · ${esc(g.year||metadata().year||'')} · ${esc(g.unit||metadata().unit||'')}<br>${esc(g.aggregationLabel||metadata().aggregationLabel||'')}${band!==null?`<br>Faixa ${band+1} de ${scale.bands.length} · ${esc(bandRange(scale.bands[band]))}`:''}<br>${num(g.n)} de ${num(g.selected??g.total)} municípios do recorte com dado${g.selected<g.total?' · '+num(g.total)+' na região completa':''}<br>${level==='city'?'Clique para abrir a ficha':'Clique para aproximar'}`,{sticky:true});
    shape.on('mouseover',()=>shape.setStyle({weight:2.2,color:css('text'),opacity:1}));shape.on('mouseout',()=>layer?.resetStyle(shape));shape.on('click',()=>{
     if(level==='city'){onCity(g.id);return;}
     const next=level==='macro'?5:level==='intermediate'?6.5:8;
     map.fitBounds(shape.getBounds(),{paddingTopLeft:[36,170],paddingBottomRight:[36,100],maxZoom:next+.4,animate:false});if(map.getZoom()<next)map.setZoom(next,{animate:false});
    });
   }}).addTo(map);
   renderLegend(groups.length-scale.count,features.length?(level==='city'?'Clique em um município para abrir a ficha.':'Aproxime para detalhar regiões e municípios.'):'Nenhum limite disponível neste recorte.');
  }catch(_){if(currentTicket===ticket)renderLegend(groups.length-scale.count,'Não foi possível carregar os limites. Tente alterar o zoom.');}
 }
 map.on('zoomend moveend',render);
 return {set(nextMetric,nextIds=null){enabled=true;metric=nextMetric;ids=nextIds;render();},disable(){enabled=false;clear();legend?.classList.remove('market-heat-legend');},refresh:render,get level(){return level;},get groups(){return groups;},get scale(){return scale;},get metric(){return metric;},get layer(){return layer;}};
}};
