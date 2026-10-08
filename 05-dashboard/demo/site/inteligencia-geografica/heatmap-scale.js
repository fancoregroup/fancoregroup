'use strict';
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 else root.GeoHeatScale=api;
})(typeof globalThis!=='undefined'?globalThis:this,()=>{
 /**
  * Quantis de ordem: o corte j ocupa ceil(n * j / k) na lista ordenada.
  * Valores empatados permanecem juntos; cortes repetidos ou no máximo somem.
  * Se todos os cortes caem no máximo, um corte no mínimo separa os dois
  * extremos observados (desde que tenham sido pedidas ao menos duas classes).
  * O chamador fornece o recorte completo do nível, nunca só a janela do mapa.
  * min/max de cada faixa são valores observados. Seus intervalos de classificação
  * usam lowerExclusive/upperInclusive; null significa extremidade sem limite.
  */
 function create(values,maxClasses=5){
  const sorted=Array.from(values||[]).filter(Number.isFinite).sort((a,b)=>a-b);
  const count=sorted.length,min=count?sorted[0]:null,max=count?sorted[count-1]:null;
  if(!count)return {bands:[],cuts:[],min,max,count,method:'empty',classify:()=>null};
  const wanted=Number.isFinite(maxClasses)&&maxClasses>=1?Math.floor(maxClasses):5;
  const classes=Math.min(wanted,count),thresholds=[];
  for(let j=1;j<classes;j++){
   const cut=sorted[Math.ceil(count*j/classes)-1];
   if(cut<max&&cut!==thresholds[thresholds.length-1])thresholds.push(cut);
  }
  if(classes>1&&min<max&&!thresholds.length)thresholds.push(min);
  function classify(value){
   if(!Number.isFinite(value))return null;
   let left=0,right=thresholds.length;
   while(left<right){const middle=(left+right)>>1;if(value<=thresholds[middle])right=middle;else left=middle+1;}
   return left;
  }
  const bands=Array.from({length:thresholds.length+1},(_,index)=>({
   index,min:null,max:null,count:0,
   lowerExclusive:index?thresholds[index-1]:null,
   upperInclusive:index<thresholds.length?thresholds[index]:null
  }));
  for(const value of sorted){const band=bands[classify(value)];if(!band.count)band.min=value;band.max=value;band.count++;}
  return {bands,cuts:[...thresholds],min,max,count,method:min===max?'constant':'quantile',classify};
 }
 return {create};
});
