'use strict';
(() => {
  const $ = s => document.querySelector(s);
  const status = {
    operando: {label:'Aberto e operando', short:'Em operação',color:'green',path:'m6 12 4 4 8-8'},
    fechou: {label:'Abriu e fechou',short:'Abriu e fechou',color:'gray',path:'m7 7 10 10M17 7 7 17'},
    implantacao: {label:'Vendido em implantação',short:'Em implantação',color:'red',path:'M12 5v7l4 3M5 5v5h5M5 10a8 8 0 1 1-1 5'},
    voltou: {label:'Vendeu e voltou',short:'Vendeu e voltou',color:'blue',path:'m9 5-5 5 5 5M4 10h10a5 5 0 0 1 0 10h-3'}
  };
  const esc = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const norm = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const icon = path => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
  const cssColor = s => getComputedStyle(document.documentElement).getPropertyValue('--status-'+status[s].color).trim();
  const stateColor = s => `--status:var(--status-${status[s].color})`;
  const params = new URLSearchParams(location.search);
  let data, map, land, neighbors, pinLayer, stateLabels, selected = params.get('city') || null;
  let activeStatus = params.get('status') in status ? params.get('status') : 'all';
  let visible=[], markers=new Map(), geometryPromise;
  let requestSerial=0;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const api = '/api/mapa-agrobar';

  function urlState(){
    const p = new URLSearchParams();
    if(activeStatus!=='all')p.set('status',activeStatus);
    if($('#state-filter').value!=='all')p.set('uf',$('#state-filter').value);
    if($('#search').value)p.set('q',$('#search').value);
    if(selected)p.set('city',selected);
    history.replaceState(null,'',location.pathname+(p.size?'?'+p.toString():''));
  }

  function popup(c){
    const s=status[c.status];
    return `<div class="popup-kicker">${c.country==='PY'?'Paraguai':esc(data.states.find(x=>x.uf===c.uf)?.name || c.uf)} · ${esc(c.uf)}</div><h3>${esc(c.city)}</h3><div class="popup-status" style="${stateColor(c.status)}"><span class="dot"></span>${s.label}</div>${c.note?`<div class="popup-note">Observação na fonte: <strong>${esc(c.note)}</strong></div>`:''}<p>Localização aproximada da cidade.</p><div class="popup-meta">Base de 21/09/2026 · Linha${c.sourceRows.length>1?'s':''} ${c.sourceRows.join(', ')} da planilha${c.sourceRows.length>1?'<br>Cidade repetida na fonte, exibida em um único pin.':''}</div><a class="popup-link" href="https://www.google.com/maps/search/?api=1&query=${c.lat},${c.lng}" target="_blank" rel="noopener">Abrir localização da cidade ↗</a>`;
  }

  function selectCity(c){
    map.stop();map.closePopup();selected=c.id;
    $$('.city-row').forEach(el=>el.classList.toggle('selected',el.dataset.id===c.id));
    map.setView([c.lat,c.lng],9,{animate:false});
    renderMarkers();
    markers.get(c.id)?.openPopup();
    urlState();
    if(innerWidth<700)$('#map-workspace').scrollIntoView({behavior:reduce?'auto':'smooth',block:'start'});
  }
  const $$ = s => [...document.querySelectorAll(s)];

  function renderMarkers(){
    if(!map||!pinLayer)return;
    pinLayer.clearLayers();markers.clear();
    const groups=[];
    for(const c of visible){
      const p=map.latLngToLayerPoint([c.lat,c.lng]);
      let g=map.getZoom()<8?groups.find(g=>Math.hypot(g.x-p.x,g.y-p.y)<36):null;
      if(g){g.cities.push(c);g.x=(g.x*(g.cities.length-1)+p.x)/g.cities.length;g.y=(g.y*(g.cities.length-1)+p.y)/g.cities.length;}
      else groups.push({x:p.x,y:p.y,cities:[c]});
    }
    for(const g of groups){
      if(g.cities.length===1){
        const c=g.cities[0],s=status[c.status];
        const marker=L.marker([c.lat,c.lng],{icon:L.divIcon({className:'pin-wrap',html:`<span class="pin" data-city-id="${c.id}" style="${stateColor(c.status)}">${icon(s.path)}</span>`,iconSize:[24,28],iconAnchor:[12,26],popupAnchor:[0,-26]}),title:`${c.city}, ${c.uf}: ${s.label}`,alt:`${c.city}, ${s.label}`,keyboard:true,riseOnHover:true,zIndexOffset:selected===c.id?100:0}).addTo(pinLayer);
        marker.bindTooltip(`${esc(c.city)} · ${c.uf}`,{direction:'top',offset:[0,-25]});
        marker.bindPopup(popup(c),{maxWidth:310,autoPanPadding:[24,75]});
        marker.on('click',()=>{selected=c.id;urlState();$$('.city-row').forEach(el=>el.classList.toggle('selected',el.dataset.id===c.id));});
        markers.set(c.id,marker);
      }else{
        let offset=0;
        const segments=Object.keys(status).flatMap(s=>{const count=g.cities.filter(c=>c.status===s).length;if(!count)return[];const start=offset;offset+=count/g.cities.length*100;return[`${cssColor(s)} ${start}% ${offset}%`];});
        const ll=map.layerPointToLatLng([g.x,g.y]);
        const marker=L.marker(ll,{icon:L.divIcon({className:'cluster-wrap',html:`<div class="cluster" data-count="${g.cities.length}" style="background:conic-gradient(${segments.join(',')})"><span>${g.cities.length}</span></div>`,iconSize:[38,38],iconAnchor:[19,19]}),title:`${g.cities.length} cidades próximas. Clique para aproximar.`,keyboard:true}).addTo(pinLayer);
        marker.bindTooltip(g.cities.slice(0,4).map(c=>esc(c.city)).join('<br>')+(g.cities.length>4?`<br>+ ${g.cities.length-4} cidades`:''),{direction:'top',offset:[0,-19]});
        marker.on('click',()=>map.fitBounds(L.latLngBounds(g.cities.map(c=>[c.lat,c.lng])),{padding:[70,90],maxZoom:9,animate:false}));
      }
    }
  }

  function renderList(){
    $('#result-count').textContent=`${visible.length} de ${data.cities.length} cidades`;
    $('#city-list').innerHTML=visible.length?visible.map(c=>`<div role="listitem"><button class="city-row ${selected===c.id?'selected':''}" data-id="${c.id}" style="${stateColor(c.status)}" aria-label="${esc(c.city)}, ${c.uf}, ${status[c.status].label}"><span class="dot"></span><span><span class="city-name">${esc(c.city)}</span><span class="city-meta">${status[c.status].short}${c.sourceRows.length>1?' · 2 linhas na fonte':''}</span></span><span class="city-uf">${c.uf}</span></button></div>`).join(''):'<div class="empty"><strong>Nenhuma cidade encontrada.</strong>Experimente outro nome ou limpe os filtros.</div>';
    $$('.city-row').forEach(el=>el.addEventListener('click',()=>selectCity(visible.find(c=>c.id===el.dataset.id))));
    $('#map-caption').textContent=activeStatus==='all'?`${visible.length} cidades no mapa`:status[activeStatus].label;
    $('#export').disabled=visible.length===0;
  }

  function filter(fit=false){
    const q=norm($('#search').value.trim()),uf=$('#state-filter').value;
    visible=data.cities.filter(c=>(activeStatus==='all'||c.status===activeStatus)&&(uf==='all'||c.uf===uf)&&norm(c.city+' '+c.uf+' '+(data.states.find(s=>s.uf===c.uf)?.name||'Paraguai')).includes(q));
    if(!visible.some(c=>c.id===selected))selected=null;
    $$('.status-card').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.status===activeStatus)));
    renderList();renderMarkers();urlState();
    if(fit&&visible.length)fitCities();
  }

  function fitCities(){if(!map||!visible.length)return;map.closePopup();map.fitBounds(L.latLngBounds(visible.map(c=>[c.lat,c.lng])),{padding:[70,80],maxZoom:8,animate:false});}
  function fitBrazil(){if(!map||!land)return;map.closePopup();map.fitBounds(land.getBounds(),{padding:[24,56],animate:false});}
  function recolor(){
    const v=name=>getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const codes=new Set(data?.cities.filter(c=>c.country==='BR').map(c=>c.id.slice(0,2)));
    land?.setStyle(f=>({fillColor:codes.has(String(f.properties.codarea))?v('--map-covered'):v('--map-land'),color:v('--map-border'),weight:.7,fillOpacity:1}));
    neighbors?.setStyle({fillColor:v('--neighbor'),color:v('--map-border'),weight:.5,fillOpacity:1});
    renderMarkers();
  }

  async function createMap(){
    if(map)return;
    map=L.map('map',{zoomControl:false,fadeAnimation:false,zoomAnimation:false,markerZoomAnimation:false,minZoom:2.5,maxZoom:11,zoomSnap:.25,scrollWheelZoom:true,attributionControl:true});
    L.control.zoom({position:'topright',zoomInTitle:'Aproximar',zoomOutTitle:'Afastar'}).addTo(map);
    map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
    map.attributionControl.addAttribution('<a href="https://www.ibge.gov.br" target="_blank" rel="noopener">IBGE</a> · <a href="https://www.naturalearthdata.com" target="_blank" rel="noopener">Natural Earth</a>');
    map.createPane('labels');map.getPane('labels').style.zIndex='450';map.getPane('labels').style.pointerEvents='none';
    pinLayer=L.layerGroup().addTo(map);stateLabels=L.layerGroup().addTo(map);
    map.on('zoomend',()=>{renderMarkers();stateLabels.eachLayer(l=>{if(l.getElement())l.getElement().style.opacity=map.getZoom()>7?'0':'.7';});});
    try{
      geometryPromise ||= Promise.all(['assets/brasil.geojson','assets/vizinhos.geojson'].map(u=>fetch(u).then(r=>{if(!r.ok)throw Error('Mapa indisponível');return r.json();})));
      const [br,near]=await geometryPromise;
      neighbors=L.geoJSON(near,{interactive:false}).addTo(map);
      land=L.geoJSON(br,{interactive:false}).addTo(map);
      data.states.forEach(s=>L.marker([s.lat,s.lng],{pane:'labels',icon:L.divIcon({className:'state-label',html:s.uf,iconSize:[24,16]}),interactive:false,keyboard:false}).addTo(stateLabels));
      L.marker([-23.5,-58],{pane:'labels',icon:L.divIcon({className:'state-label',html:'Paraguai',iconSize:[60,16]}),interactive:false,keyboard:false}).addTo(stateLabels);
      recolor();fitBrazil();
    }catch(e){$('#map-error').hidden=false;map.setView([-18,-49],4);}
    renderMarkers();
  }

  async function enter(payload){
    data=payload;$('#access').hidden=true;$('#main').hidden=false;$('#logout').hidden=false;
    const brazil=data.cities.filter(c=>c.country==='BR');
    $('#summary').textContent=`${brazil.length} cidades no Brasil · ${new Set(brazil.map(c=>c.uf)).size} estados · Cidade do Leste, Paraguai`;
    $('#status-grid').innerHTML=Object.entries(status).map(([key,s])=>`<button class="status-card" type="button" data-status="${key}" aria-pressed="false" style="${stateColor(key)}"><span class="status-top"><span class="dot"></span>${s.short}</span><span class="status-number">${data.cities.filter(c=>c.status===key).length}<span class="status-unit">cidades</span></span><small>${s.label}</small><span class="status-arrow" aria-hidden="true">↗</span></button>`).join('');
    $$('.status-card').forEach(el=>el.addEventListener('click',()=>{activeStatus=activeStatus===el.dataset.status?'all':el.dataset.status;filter(true);}));
    const opts=[...new Set(data.cities.map(c=>c.uf))].sort();
    $('#state-filter').innerHTML='<option value="all">Todos os estados e Paraguai</option>'+opts.map(uf=>`<option value="${uf}">${uf==='PY'?'Paraguai':data.states.find(s=>s.uf===uf).name+' · '+uf}</option>`).join('');
    $('#state-filter').value=opts.includes(params.get('uf'))?params.get('uf'):'all';
    $('#search').value=params.get('q')||'';
    $('#source-summary').textContent=`A imagem contém ${data.sourceRowCount} linhas e ${data.cities.length} cidades distintas. Novo Hamburgo e Caxias do Sul aparecem duas vezes, com o mesmo status. As repetições estão preservadas no detalhe, sem aumentar o número de cidades. Os números deste mapa não representam uma contagem de unidades.`;
    await createMap();
    filter();
    const initial=data.cities.find(c=>c.id===selected);if(initial&&visible.includes(initial))selectCity(initial);
    $('#password').value='';
  }

  $('#login-form').addEventListener('submit',async e=>{
    e.preventDefault();const serial=++requestSerial;$('#login').disabled=true;$('#auth-message').textContent='Abrindo o mapa…';
    try{const r=await fetch(api,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:$('#password').value})});const payload=await r.json();if(serial!==requestSerial)return;if(!r.ok)throw Error(payload.error||'Não foi possível entrar.');await enter(payload);$('#auth-message').textContent='';}
    catch(e){$('#auth-message').textContent=e.message||'Não foi possível conectar. Tente novamente.';}
    finally{$('#login').disabled=false;}
  });
  $('#show-password').onclick=()=>{const shown=$('#password').type==='password';$('#password').type=shown?'text':'password';$('#show-password').textContent=shown?'Ocultar':'Mostrar';$('#show-password').setAttribute('aria-label',shown?'Ocultar código':'Mostrar código');};
  $('#logout').onclick=async()=>{try{const r=await fetch(api,{method:'DELETE'});if(!r.ok)throw Error('Falha');location.replace(location.pathname);}catch(e){$('#logout').textContent='Tentar sair novamente';}};
  $('#search').addEventListener('input',()=>filter());
  $('#state-filter').addEventListener('change',()=>filter(true));
  $('#reset-filters').onclick=()=>{activeStatus='all';$('#state-filter').value='all';$('#search').value='';selected=null;filter();fitBrazil();};
  $('#fit').onclick=fitCities;$('#brazil').onclick=fitBrazil;
  $('#source-details').onclick=()=>$('#source-dialog').showModal();$('#close-source').onclick=()=>$('#source-dialog').close();
  $('#export').onclick=()=>{
    const quote=v=>'"'+String(v).replace(/"/g,'""')+'"';
    const rows=[['Cidade','UF / país','Status','Linhas na fonte','Observação','Referência'],...visible.map(c=>[c.city,c.uf,status[c.status].label,c.sourceRows.join(', '),c.note,'21/09/2026'])];
    const blob=new Blob(['\uFEFF'+rows.map(r=>r.map(quote).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8;'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='agrobar-cidades-2026-09-21.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  async function presentation(){const el=$('#map-workspace');if(document.fullscreenElement)await document.exitFullscreen();else if(el.classList.contains('presentation'))el.classList.remove('presentation');else{try{if(!el.requestFullscreen)throw Error('indisponível');await el.requestFullscreen();}catch(e){el.classList.add('presentation');}}$('#exit-fullscreen').hidden=!document.fullscreenElement&&!el.classList.contains('presentation');setTimeout(()=>{map.invalidateSize();fitCities();},80);}
  $('#fullscreen').onclick=presentation;$('#exit-fullscreen').onclick=presentation;
  document.addEventListener('fullscreenchange',()=>{$('#exit-fullscreen').hidden=!document.fullscreenElement;setTimeout(()=>map?.invalidateSize(),80);});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('#map-workspace').classList.contains('presentation'))presentation();});
  new MutationObserver(()=>recolor()).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
  fetch(api).then(async r=>{if(r.ok)await enter(await r.json());else if(r.status!==401)$('#auth-message').textContent='Acesso temporariamente indisponível. Tente novamente em instantes.';}).catch(()=>{$('#auth-message').textContent='Sem conexão. Tente novamente.';});
})();
