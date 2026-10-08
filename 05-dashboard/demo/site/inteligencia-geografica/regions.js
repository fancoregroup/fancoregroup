'use strict';
(function(root,factory){const api=factory();if(typeof module==='object')module.exports=api;else root.GeoRegions=api;})(typeof globalThis!=='undefined'?globalThis:this,()=>{
 const levels={macro:'Grande região',intermediate:'Região intermediária',immediate:'Região imediata'};
 function groups(rows,level){
  const result=new Map();
  for(const r of rows){const id=r[level+'Id'];if(!id)continue;if(!result.has(id))result.set(id,{id,name:r[level],level,uf:level==='macro'?'':r.uf,cities:[]});result.get(id).cities.push(r);}
  return [...result.values()].map(g=>{
   const ranked=[...g.cities].sort((a,b)=>(b.gdp??-1)-(a.gdp??-1)||a.id.localeCompare(b.id));
   const valid=ranked.filter(r=>Number.isFinite(r.gdp));
   const total=valid.reduce((s,r)=>s+r.gdp,0);
   return {...g,gdp:valid.length?total:null,coverage:valid.length,ranked,
    topShare:total?ranked.slice(0,3).reduce((s,r)=>s+(r.gdp??0),0)/total*100:null,
    poles:level==='macro'?[]:g.cities.filter(r=>r[level+'Role']==='Polo')};
  }).sort((a,b)=>(b.gdp??-1)-(a.gdp??-1)||a.id.localeCompare(b.id));
 }
 const share=(r,g)=>Number.isFinite(r?.gdp)&&g?.gdp>0?r.gdp/g.gdp*100:null;
 const csvCell=v=>'"'+String(v??'').replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"';
 function csv(rows,group){
  return '\uFEFF'+[['IBGE','Município','UF','Grande região','Região intermediária','Papel intermediária','Região imediata','Papel imediata','Hierarquia da planilha IBGE','PIB R$ 2023','PIB per capita R$ 2023','Recorte regional','Participação no PIB do recorte % 2023'],...rows.map(r=>[r.id,r.name,r.uf,r.macro,r.intermediate,r.intermediateRole,r.immediate,r.immediateRole,r.hierarchy,r.gdp,r.gdpPerCapita,group?.name,share(r,group)])].map(r=>r.map(csvCell).join(';')).join('\r\n');
 }
 return {levels,groups,share,csv};
});
