'use strict';
window.GeoSimilarityUI={mount(context){
  const {data,networks,format,num,esc,css,showTab,selectCity,comparePair,syncExport}=context;
  const S=GeoSimilarity,$=s=>document.querySelector(s);let network=context.network,matcher=S.createMatcher(data.cities,network);
  const brandName=()=>networks.brands.find(b=>b.id===$('#similar-brand').value)?.name||'holding';
  $('#similar-brand').insertAdjacentHTML('beforeend',networks.brands.map(b=>`<option value="${b.id}">${esc(b.name)}</option>`).join(''));
  function setBrand(){network=networks.mapFor($('#similar-brand').value);matcher=S.createMatcher(data.cities,network);$('#similar-reference').innerHTML=`<option value="">Qualquer cidade operando (${matcher.references.length})</option>`+matcher.references.map(c=>`<option value="${c.id}">${esc(c.name)} / ${c.uf}</option>`).join('');}
  const statusLabels={fechou:'Abriu e fechou',voltou:'Vendeu e voltou'};
  let result,limit=30,selectedId,map,layer,baseLayer,listFocusId=null,listContext='';
  const options=()=>({referenceId:$('#similar-reference').value,scope:$('#similar-scope').value,uf:$('#similar-uf').value,query:$('#similar-search').value,minScore:Number($('#similar-min').value)});
  $('#similar-reference').innerHTML=`<option value="">Qualquer cidade operando (${matcher.references.length})</option>`+matcher.references.map(c=>`<option value="${c.id}">${esc(c.name)} / ${c.uf}</option>`).join('');
  $('#similar-uf').insertAdjacentHTML('beforeend',[...new Set(data.cities.map(c=>c.uf))].sort().map(uf=>`<option>${uf}</option>`).join(''));
  $('#similar-method-table').innerHTML=`<table><thead><tr><th>Critério</th><th>Peso</th><th>Escala da diferença máxima</th></tr></thead><tbody>${S.criteria.map(c=>`<tr><td>${c.label}</td><td>${c.weight}%</td><td>${c.scaleLabel}</td></tr>`).join('')}</tbody></table>`;
  function difference(part){
    const delta=part.value-part.referenceValue;
    if(Math.abs(delta)<.000001)return 'mesmo valor';
    if(part.mode==='points')return `${num(Math.abs(delta),1)} p.p. ${delta>0?'acima':'abaixo'}`;
    if(part.referenceValue===0)return `${num(Math.abs(delta),1)} ${delta>0?'acima':'abaixo'}`;
    return `${num(Math.abs(delta/part.referenceValue*100),1)}% ${delta>0?'acima':'abaixo'}`;
  }
  function render(){
    const signature=JSON.stringify({brand:$('#similar-brand').value,...options()});if(signature!==listContext){listFocusId=null;listContext=signature;}
    result=matcher.rank(options());
    if(!result.matches.some(m=>m.city.id===selectedId))selectedId=result.matches[0]?.city.id;
    $('#similar-summary').innerHTML=`<div><strong>${num(result.matches.length)}</strong> <span>cidades com perfil semelhante</span></div><p class="fine">${num(result.references.length)} praças operando como referência · ${num(result.eligibleCount)} candidatas no recorte${result.missingCount?` · ${num(result.missingCount)} sem dados comparáveis`:''}${result.referenceMissing?` · ${result.referenceMissing} operações sem perfil completo`:''}</p>`;
    $('#similar-notice').textContent=result.options.scope==='history'?'Revisão de cidades que fecharam ou que venderam e voltaram. O histórico precisa entrar na decisão. Operações atuais e cidades em implantação ficam fora das candidatas.':`Candidatas sem registro na base da ${brandName()}. Ausência não comprova disponibilidade comercial. Só unidades informadas como operando são referências.${[...network.values()].some(r=>r.status==='informada')?' Há unidades com situação operacional a confirmar.':''}`;
    renderList();renderDetail();if(map)renderMap(true);syncExport();
  }
  function renderList(){
    $('#similar-shown').textContent=`${Math.min(limit,result.matches.length)} de ${num(result.matches.length)}`;
    $('#similar-list').innerHTML=result.matches.slice(0,limit).map((m,i)=>`<button class="similar-row" data-similar-city="${m.city.id}" aria-pressed="${listFocusId===m.city.id}" data-map-focused="${listFocusId===m.city.id}" aria-label="${esc(m.city.name)} / ${m.city.uf}. ${listFocusId===m.city.id?'Clique novamente para abrir a ficha':'Mostrar no mapa'}"><span class="rank">${i+1}</span><span><strong>${esc(m.city.name)} <small style="display:inline">${m.city.uf}</small></strong><small${listFocusId===m.city.id?' class="map-focus-hint"':''}>${listFocusId===m.city.id?'Clique novamente para abrir a ficha':'Ver no mapa e comparar o perfil'}</small>${network.has(m.city.id)?`<small><i class="dot" style="background:${css(network.get(m.city.id).status)}"></i>${statusLabels[network.get(m.city.id).status]}</small>`:''}</span><span class="similar-score">${num(m.score,1)}<small>de 100</small></span></button><div class="similar-reference-link">Parecida com <button data-profile-city="${m.reference.id}">${esc(m.reference.name)} / ${m.reference.uf}</button></div>`).join('')||`<div class="similar-empty">${!result.references.length?'Nenhuma unidade confirmada como operando com perfil completo disponível.':'Nenhuma cidade atingiu este corte no recorte. Amplie o estado, reduza o corte ou escolha outra referência.'}</div>`;
    $('#similar-more').hidden=limit>=result.matches.length;
  }
  function renderDetail(){
    const m=result.matches.find(x=>x.city.id===selectedId),el=$('#similar-detail');el.hidden=!m;if(!m){el.innerHTML='';return;}
    const closest=[...m.criteria].sort((a,b)=>a.gap-b.gap),largest=closest[closest.length-1];
    el.innerHTML=`<div class="similar-detail-head"><div><span class="eyebrow">${statusLabels[network.get(m.city.id)?.status]||'Cidade candidata'}</span><h2><button class="cp-city-link" data-profile-city="${m.city.id}">${esc(m.city.name)} / ${m.city.uf}</button></h2><p>Perfil mais parecido com <button class="cp-city-link" data-profile-city="${m.reference.id}">${esc(m.reference.name)} / ${m.reference.uf}</button>, com operação da ${esc(brandName())}.</p></div><div class="similar-total"><strong>${num(m.score,1)}</strong><span>/ 100<br>semelhança</span></div></div><div class="similar-profile">${m.criteria.map(c=>{const max=c.mode==='points'?100:Math.max(c.value,c.referenceValue,1);return `<article class="similar-dimension"><h3>${esc(c.label)}</h3><div class="similar-value"><span>${format(c.key,c.value)}</span><small>Candidata</small></div><div class="similar-track"><i style="--width:${c.value/max*100}%"></i></div><div class="similar-value"><span>${format(c.key,c.referenceValue)}</span><small>Operando</small></div><div class="similar-track reference"><i style="--width:${c.referenceValue/max*100}%"></i></div><a href="${data.indicators[c.key].source}" target="_blank" rel="noopener">IBGE ${c.year} · peso ${c.weight}%</a></article>`;}).join('')}</div><p class="similar-reason"><strong>O que aproxima:</strong> ${closest.slice(0,2).map(c=>`${c.label.toLowerCase()} (${difference(c)})`).join(' e ')}. <strong>Maior diferença proporcional ao critério:</strong> ${largest.label.toLowerCase()} (${difference(largest)}).</p>${m.alternatives.length?`<p class="similar-alternatives">Outras operações parecidas: ${m.alternatives.map(a=>`<button class="cp-city-link" data-profile-city="${a.reference.id}">${esc(a.reference.name)} / ${a.reference.uf}</button> (${num(a.score,1)} de 100)`).join(' · ')}.</p>`:''}<div class="similar-actions"><button class="button primary" id="similar-compare-pair">Comparar este par</button><button class="button" id="similar-open-city">Abrir ficha completa</button></div><p class="fine" style="margin-top:16px">As barras comparam os valores de cada critério. Semelhança de perfil não é previsão de desempenho ou receita.</p>`;
    $('#similar-compare-pair').onclick=()=>comparePair(m.city.id,m.reference.id);
    $('#similar-open-city').onclick=()=>selectCity(m.city.id);
  }
  async function initMap(){
    if(map){map.invalidateSize({pan:false});return;}
    map=L.map('similar-map',{preferCanvas:true,zoomControl:false,minZoom:3,maxZoom:14,zoomSnap:.25,zoomAnimation:false}).setView([-14,-52],4);
    window.GeoBrandPins?.attach(map);
    map.attributionControl.setPrefix(false);map.attributionControl.addAttribution('Limites: IBGE · Pontos municipais aproximados');L.control.zoom({position:'topright'}).addTo(map);layer=L.layerGroup().addTo(map);map.on('resize',()=>renderMap(!listFocusId));
    map.fitBounds([[-34,-74],[6,-34]],{padding:[35,70],animate:false});renderMap(true);
    try{const response=await fetch('../mapa-agrobar/assets/brasil.geojson');if(!response.ok)throw Error();baseLayer=L.geoJSON(await response.json(),{interactive:false,style:{color:css('boundary'),weight:.7,fillColor:css('land'),fillOpacity:.85}}).addTo(map);baseLayer.bringToBack();}catch(_){$('#similar-map-info').textContent='Contorno indisponível. A busca e os pontos continuam disponíveis.';}
  }
  function renderMap(fit=false){
    if(!map)return;layer.clearLayers();const visible=result.matches.slice(0,limit),points=[];const current=result.matches.find(m=>m.city.id===selectedId);
    for(const m of visible){const city=m.city;if(!Number.isFinite(city.lat)||!Number.isFinite(city.lng))continue;points.push([city.lat,city.lng]);L.circleMarker([city.lat,city.lng],{radius:city.id===selectedId?9:5,color:css('surface'),weight:2,fillColor:css('orange'),fillOpacity:city.id===selectedId?1:.75}).bindTooltip(`${esc(city.name)} / ${city.uf}<br>${num(m.score,1)} de 100 · ${esc(m.reference.name)}`,{permanent:city.id===listFocusId,direction:'top',offset:[0,-10]}).on('click',()=>select(city.id)).addTo(layer);}
    if(current){const ref=current.reference;points.push([ref.lat,ref.lng]);L.circleMarker([ref.lat,ref.lng],{radius:8,color:css('surface'),weight:2,fillColor:css('operando'),fillOpacity:1}).bindTooltip(`${esc(ref.name)} / ${ref.uf}<br>Operação de referência do par selecionado`).on('click',()=>selectCity(ref.id)).addTo(layer);}
    $('#similar-map-info').textContent=`${visible.length} candidatas exibidas · A proximidade geográfica não entra no cálculo.`;
    baseLayer?.setStyle({color:css('boundary'),fillColor:css('land')});
    if(fit){if(points.length)map.fitBounds(points,{paddingTopLeft:[35,55],paddingBottomRight:[35,95],maxZoom:8,animate:false});else map.fitBounds([[-34,-74],[6,-34]],{padding:[30,70],animate:false});}
  }
  function clearListFocus(){if(!listFocusId)return;listFocusId=null;layer?.eachLayer(marker=>{const tooltip=marker.getTooltip?.();if(tooltip?.options.permanent){tooltip.options.permanent=false;marker.closeTooltip();}});renderList();}
  function focusFromList(id){
    if(listFocusId===id){selectCity(id);return;}
    listFocusId=selectedId=id;renderList();renderDetail();renderMap(false);
    $('#similar-list [data-similar-city="'+id+'"]')?.focus({preventScroll:true});
    document.dispatchEvent(new CustomEvent('geo:list-focus',{detail:{id,view:'similar'}}));
  }
  function select(id){clearListFocus();selectedId=id;renderList();renderDetail();renderMap(false);selectCity(id);}
  function download(){
    if(!result.matches.length)return;
    const url=URL.createObjectURL(new Blob([S.csv(result,data.indicators,network,brandName())],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='fancore-geo-cidades-semelhantes.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  $('#similar-brand').onchange=()=>{setBrand();limit=30;render();};
  for(const id of ['similar-reference','similar-uf','similar-scope','similar-min'])$('#'+id).onchange=()=>{limit=30;render();};
  let timer;$('#similar-search').oninput=()=>{clearListFocus();clearTimeout(timer);timer=setTimeout(()=>{limit=30;render();},150);};
  $('#similar-reset').onclick=()=>{clearListFocus();clearTimeout(timer);for(const id of ['similar-reference','similar-uf','similar-search'])$('#'+id).value='';$('#similar-scope').value='new';$('#similar-min').value='85';limit=30;render();};
  $('#similar-more').onclick=()=>{limit+=30;renderList();renderMap(true);};$('#similar-fit').onclick=()=>renderMap(true);
  $('#similar-list').onclick=event=>{const b=event.target.closest('[data-similar-city]');if(b)focusFromList(b.dataset.similarCity);};
  new MutationObserver(()=>renderMap(false)).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
  render();
  function inspectCity(id,brand){$('#similar-brand').value=brand||'';setBrand();const ref=matcher.references.some(c=>c.id===id);$('#similar-reference').value=ref?id:'';$('#similar-search').value=ref?'':id;$('#similar-uf').value='';$('#similar-scope').value=['fechou','voltou'].includes(network.get(id)?.status)?'history':'new';$('#similar-min').value=ref?'85':'0';limit=30;render();showTab('similar');}
  return {inspectCity,clearListFocus,activate(){initMap();syncExport();},download,get result(){return result;},get map(){return map;},useReference(id,brand){if(brand){$('#similar-brand').value=brand;setBrand();}if(!matcher.references.some(c=>c.id===id))return;$('#similar-reference').value=id;$('#similar-uf').value='';$('#similar-search').value='';$('#similar-scope').value='new';$('#similar-min').value='85';limit=30;render();showTab('similar');}};
}};
