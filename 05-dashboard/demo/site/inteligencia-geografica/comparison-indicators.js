'use strict';
/* Editable draft only. The comparison model owns persistence and metric definitions. */
window.GeoComparisonIndicators={create({getCatalog,getSelected,getPresets,onApply}){
 const dialog=document.createElement('dialog');dialog.id='comparison-indicators';dialog.setAttribute('aria-labelledby','ci-title');dialog.setAttribute('aria-describedby','ci-description');
 dialog.innerHTML=`<header class="ci-header"><div><span class="ci-eyebrow">Personalize sua análise</span><h2 id="ci-title">Escolher indicadores</h2><p id="ci-description">Escolha as informações e a ordem da sua comparação.</p></div><button type="button" class="ci-icon-button" id="ci-close" aria-label="Fechar sem aplicar">×</button></header>
  <section class="ci-presets" aria-label="Seleções prontas"><span>Começar com</span><div id="ci-presets"></div><button type="button" class="ci-text-button" id="ci-restore">Restaurar essenciais</button></section>
  <div class="ci-body"><section class="ci-catalog-panel" aria-label="Indicadores disponíveis"><div class="ci-search"><label for="ci-query">Buscar indicador</label><input id="ci-query" type="search" placeholder="Ex.: renda, idade ou região" autocomplete="off"><label for="ci-category">Categoria</label><select id="ci-category"><option value="">Todas as categorias</option></select></div><p id="ci-results-count" role="status"></p><div id="ci-catalog"></div></section>
  <details class="ci-selection-panel" id="ci-selection"><summary><span>Sua comparação <b id="ci-selected-count"></b></span><span class="ci-selection-hint">Ordenar e remover</span></summary><div class="ci-selection-intro"><p>Os indicadores aparecem nesta ordem.</p><button type="button" class="ci-text-button" id="ci-clear">Limpar seleção</button></div><ol id="ci-selected"></ol><p class="ci-selection-empty" id="ci-empty" hidden>Nenhum indicador selecionado. Escolha pelo menos um para aplicar.</p></details></div>
  <footer class="ci-footer"><div><p id="ci-save-note">Salvo neste navegador após aplicar.</p><p id="ci-feedback" role="status"></p></div><div class="ci-footer-actions"><button type="button" class="button" id="ci-cancel">Cancelar</button><button type="button" class="button ci-apply" id="ci-apply">Aplicar e salvar padrão</button></div></footer><p class="sr-only" id="ci-live" role="status" aria-live="polite"></p>`;
 document.body.append(dialog);
 const $=selector=>dialog.querySelector(selector);
 const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
 const norm=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
 const words=value=>norm(value).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
 const number=value=>new Intl.NumberFormat('pt-BR').format(value);
 let catalog=[],byKey=new Map(),presets=[],draft=[],origin=null,busy=false,previousOverflow='';
 const unique=keys=>[...new Set((Array.isArray(keys)?keys:[]).filter(key=>byKey.has(key)))];
 function renderCatalog(){
  const tokens=words($('#ci-query').value),category=$('#ci-category').value;
  const visible=catalog.filter(row=>{if(category&&row.group!==category)return false;const searchable=words([row.label,row.group,row.keywords,row.unit,row.year].filter(Boolean).join(' '));return tokens.every(token=>searchable.some(word=>word.startsWith(token)));});
  $('#ci-results-count').textContent=visible.length?number(visible.length)+' '+(visible.length===1?'indicador disponível':'indicadores disponíveis'):'Nenhum indicador encontrado. Tente outro termo ou categoria.';
  const groups=[...new Set(visible.map(row=>row.group))];
  $('#ci-catalog').innerHTML=groups.map((group,index)=>`<section class="ci-group" aria-labelledby="ci-group-${index}"><h3 id="ci-group-${index}">${esc(group)}</h3>${visible.filter(row=>row.group===group).map(row=>`<label class="ci-indicator"><input type="checkbox" data-ci-key="${esc(row.key)}" ${draft.includes(row.key)?'checked':''}><span><strong>${esc(row.label)}</strong><small>${[row.unit,row.year].filter(value=>value!==null&&value!==undefined&&value!=='').map(esc).join(' · ')}</small>${row.note?`<span class="ci-indicator-note">${esc(row.note)}</span>`:''}</span></label>`).join('')}</section>`).join('');
 }
 function renderSelection(){
  $('#ci-selected-count').textContent=number(draft.length);
  $('#ci-selected').innerHTML=draft.map((key,index)=>{const row=byKey.get(key);return `<li data-ci-selected="${esc(key)}" tabindex="-1"><span class="ci-order" aria-hidden="true">${index+1}</span><span class="ci-selected-label"><strong>${esc(row.label)}</strong><small>${esc(row.group)}</small></span><div class="ci-order-actions"><button type="button" data-ci-move="-1" data-ci-target="${esc(key)}" class="ci-icon-button" aria-label="Mover ${esc(row.label)} para cima" ${index===0?'disabled':''}>↑</button><button type="button" data-ci-move="1" data-ci-target="${esc(key)}" class="ci-icon-button" aria-label="Mover ${esc(row.label)} para baixo" ${index===draft.length-1?'disabled':''}>↓</button><button type="button" data-ci-remove="${esc(key)}" class="ci-icon-button ci-remove" aria-label="Remover ${esc(row.label)}">×</button></div></li>`;}).join('');
  $('#ci-empty').hidden=draft.length>0;$('#ci-clear').disabled=!draft.length;$('#ci-apply').disabled=!draft.length||busy;
  $('#ci-feedback').textContent=draft.length?'':'Selecione pelo menos um indicador para continuar.';
  const activePreset=presets.find(p=>{const keys=unique(p.keys);return keys.length===draft.length&&keys.every((key,index)=>key===draft[index]);});
  for(const button of $('#ci-presets').querySelectorAll('button'))button.setAttribute('aria-pressed',String(button.dataset.ciPreset===activePreset?.id));
 }
 function announce(message){$('#ci-live').textContent=message;}
 function focusSelected(key,action){const row=[...$('#ci-selected').children].find(el=>el.dataset.ciSelected===key);if(!row)return;const control=action?row.querySelector('[data-ci-move="'+action+'"]'):row.querySelector('[data-ci-remove]');(control&&!control.disabled?control:row).focus({preventScroll:true});row.scrollIntoView({block:'nearest'});}
 function usePreset(preset){if(!preset||busy)return;draft=unique(preset.keys);renderCatalog();renderSelection();announce(preset.label+': '+number(draft.length)+' indicadores selecionados.');}
 function close(){if(!busy)dialog.close();}
 function open(){
  if(dialog.open||busy)return;
  catalog=(getCatalog()||[]).filter(row=>row&&typeof row.key==='string'&&row.key).map(row=>({...row,group:String(row.group||'Outros indicadores')}));
  byKey=new Map();catalog=catalog.filter(row=>{if(byKey.has(row.key))return false;byKey.set(row.key,row);return true;});
  presets=(getPresets()||[]).filter(preset=>preset&&Array.isArray(preset.keys)).map((preset,index)=>({...preset,id:String(preset.id??index)}));
  draft=unique(getSelected());origin=document.activeElement;previousOverflow=document.body.style.overflow;document.body.style.overflow='hidden';
  $('#ci-query').value='';$('#ci-category').innerHTML='<option value="">Todas as categorias</option>'+[...new Set(catalog.map(row=>row.group))].map(group=>'<option value="'+esc(group)+'">'+esc(group)+'</option>').join('');
  $('#ci-presets').innerHTML=presets.map(preset=>`<button type="button" class="ci-preset" data-ci-preset="${esc(preset.id)}" aria-pressed="false">${esc(preset.label)}</button>`).join('');
  $('#ci-restore').hidden=!presets.length;$('#ci-selection').open=!matchMedia('(max-width:720px)').matches;$('#ci-live').textContent='';
  renderCatalog();renderSelection();dialog.showModal();$('#ci-query').focus();
 }
 $('#ci-query').addEventListener('input',renderCatalog);$('#ci-category').addEventListener('change',renderCatalog);
 $('#ci-query').addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}});
 $('#ci-catalog').addEventListener('change',event=>{const input=event.target.closest('[data-ci-key]');if(!input||busy)return;const key=input.dataset.ciKey;if(input.checked&&!draft.includes(key))draft.push(key);else if(!input.checked)draft=draft.filter(value=>value!==key);renderSelection();announce(number(draft.length)+' indicadores selecionados.');});
 $('#ci-selected').addEventListener('click',event=>{
  if(busy)return;const remove=event.target.closest('[data-ci-remove]'),move=event.target.closest('[data-ci-move]');
  if(remove){const key=remove.dataset.ciRemove,index=draft.indexOf(key),label=byKey.get(key)?.label;draft=draft.filter(value=>value!==key);renderCatalog();renderSelection();announce(label+' removido.');if(draft.length)focusSelected(draft[Math.min(index,draft.length-1)]);else $('#ci-query').focus();}
  if(move){const key=move.dataset.ciTarget,index=draft.indexOf(key),step=Number(move.dataset.ciMove),next=index+step;if(index<0||next<0||next>=draft.length)return;[draft[index],draft[next]]=[draft[next],draft[index]];renderSelection();focusSelected(key,String(step));announce(byKey.get(key).label+': posição '+(next+1)+' de '+draft.length+'.');}
 });
 $('#ci-presets').addEventListener('click',event=>{const button=event.target.closest('[data-ci-preset]');if(button)usePreset(presets.find(preset=>preset.id===button.dataset.ciPreset));});
 $('#ci-restore').onclick=()=>usePreset(presets.find(preset=>norm(preset.label)==='essenciais')||presets[0]);
 $('#ci-clear').onclick=()=>{if(busy)return;draft=[];renderCatalog();renderSelection();announce('Seleção limpa. Escolha pelo menos um indicador.');$('#ci-query').focus();};
 $('#ci-cancel').onclick=close;$('#ci-close').onclick=close;
 $('#ci-apply').onclick=async()=>{
  if(!draft.length||busy)return;busy=true;$('#ci-apply').disabled=true;$('#ci-apply').textContent='Salvando…';$('#ci-feedback').textContent='';
  try{const applied=await onApply([...draft]);if(applied===false)throw Error('Seleção não aplicada');busy=false;dialog.close();}
  catch(error){busy=false;$('#ci-feedback').textContent='Não foi possível salvar. Sua seleção continua disponível para tentar novamente.';$('#ci-apply').disabled=!draft.length;}
  finally{$('#ci-apply').textContent='Aplicar e salvar padrão';}
 };
 dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
 dialog.addEventListener('close',()=>{document.body.style.overflow=previousOverflow;requestAnimationFrame(()=>{if(dialog.open)return;const fallback=document.querySelector('#dc-choose-indicators'),target=origin?.isConnected?origin:fallback;target?.focus({preventScroll:true});});});
 dialog.addEventListener('click',event=>{if(event.target!==dialog||busy)return;const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)close();});
 return {open};
}};
