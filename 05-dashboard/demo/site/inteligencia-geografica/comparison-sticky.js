'use strict';
/* A tabela conserva seu cabeçalho acessível. Esta faixa apenas repete os nomes
   quando a rolagem da página leva o cabeçalho para trás da barra superior. */
window.GeoComparisonSticky=(()=>{
 let mounted=false;
 function mount(){
  const host=document.getElementById('comparison');
  if(mounted||!host)return;
  mounted=true;
  const bar=document.querySelector('.topbar'),overlay=document.createElement('div');
  overlay.className='dc-sticky-header';overlay.hidden=true;
  overlay.setAttribute('aria-hidden','true');overlay.setAttribute('inert','');
  const track=document.createElement('div');track.className='dc-sticky-track';
  overlay.append(track);document.body.append(overlay);
  let scroll=null,table=null,head=null,label=null,frame=0,dirty=true,cells=[];
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(update);};
  const resize=new ResizeObserver(()=>{dirty=true;schedule();});
  if(bar)resize.observe(bar);
  function bind(){
   const next=host.querySelector('.dc-workspace > .dc-table-scroll');
   const nextTable=next?.querySelector('table'),nextHead=nextTable?.tHead;
   if(next===scroll&&nextTable===table&&nextHead===head)return;
   if(scroll){scroll.removeEventListener('scroll',schedule);resize.unobserve(scroll);}
   if(table)resize.unobserve(table);
   if(head)resize.unobserve(head);
   scroll=next;table=nextTable;head=nextHead;dirty=true;
   if(scroll){scroll.addEventListener('scroll',schedule,{passive:true});resize.observe(scroll);}
   if(table)resize.observe(table);
   if(head)resize.observe(head);
  }
  function textCopy(source){
   // Keep text and typographic elements only: no links, callbacks, IDs or focus targets.
   const copy=document.createElement('span');
   for(const node of source.childNodes){
    if(node.nodeType===Node.TEXT_NODE){copy.append(document.createTextNode(node.textContent));continue;}
    if(node.nodeType!==Node.ELEMENT_NODE)continue;
    if(node.matches('.dc-city-link > span'))continue; // "Abrir ficha" belongs to the real header.
    const child=textCopy(node);
    if(node.matches('.dc-city-link'))child.className='dc-sticky-city';
    else if(node.tagName==='SMALL')child.className='dc-sticky-small';
    else if(node.tagName==='B'||node.tagName==='STRONG')child.className='dc-sticky-strong';
    else child.className='dc-sticky-caption';
    copy.append(child);
   }
   return copy;
  }
  function rebuild(){
   track.replaceChildren();label?.remove();label=null;cells=[];
   for(const [index,source] of Array.from(head.rows[0]?.cells||[]).entries()){
    const cell=document.createElement('div');cell.className='dc-sticky-cell';
    if(source.hasAttribute('data-dc-city'))cell.dataset.stickyCity=source.dataset.dcCity;
    if(source.classList.contains('dc-reference-col'))cell.classList.add('dc-sticky-reference');
    cell.append(textCopy(source));track.append(cell);cells.push({source,cell,index});
   }
   if(cells.length){label=cells[0].cell.cloneNode(true);label.classList.add('dc-sticky-label');overlay.append(label);}
   dirty=false;
  }
  function update(){
   frame=0;bind();
   if(!scroll||!head?.rows.length||!scroll.getClientRects().length){overlay.hidden=true;return;}
   const box=scroll.getBoundingClientRect(),tableBox=table.getBoundingClientRect();
   const top=Math.max(0,bar?.getBoundingClientRect().bottom||0);
   const bottom=Math.min(box.bottom-scroll.clientTop,tableBox.bottom);
   const height=head.getBoundingClientRect().height;
   const left=box.left+scroll.clientLeft,width=scroll.clientWidth;
   if(!height||!width||box.top+scroll.clientTop>=top||bottom<=top||left>=innerWidth||left+width<=0){overlay.hidden=true;return;}
   if(dirty)rebuild();
   const headerTop=Math.min(top,bottom-height);
   Object.assign(overlay.style,{left:left+'px',top:headerTop+'px',width:width+'px',height:height+'px'});
   // Once the bottom of the table reaches the bar, the repeated header exits with it.
   // Clip any part that moves behind the bar, including layouts with a translucent bar.
   overlay.style.clipPath='inset('+Math.max(0,top-headerTop)+'px 0 0)';
   track.style.width=tableBox.width+'px';track.style.transform='translateX('+-scroll.scrollLeft+'px)';
   for(const {source,cell,index} of cells){
    const rect=source.getBoundingClientRect(),style=getComputedStyle(source);
    const dimensions={width:rect.width+'px',height:height+'px',padding:style.padding,font:style.font,textAlign:style.textAlign};
    Object.assign(cell.style,dimensions);
    if(index===0&&label)Object.assign(label.style,dimensions);
    const original=source.querySelector('.dc-city-link');
    if(original){const title=cell.querySelector('.dc-sticky-city');if(title)title.style.font=getComputedStyle(original).font;}
   }
   overlay.hidden=false;
  }
  new MutationObserver(()=>{dirty=true;schedule();}).observe(host,{childList:true,subtree:true,characterData:true});
  window.addEventListener('scroll',schedule,{passive:true});
  window.addEventListener('resize',()=>{dirty=true;schedule();},{passive:true});
  window.visualViewport?.addEventListener('resize',schedule,{passive:true});
  document.addEventListener('geo:view',schedule);
  document.fonts?.ready.then(()=>{dirty=true;schedule();});
  schedule();
  return {refresh:schedule};
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
 return {mount};
})();
