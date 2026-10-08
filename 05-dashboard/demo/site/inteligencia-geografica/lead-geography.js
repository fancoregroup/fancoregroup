'use strict';
(function(root,factory){const api=factory();if(typeof module==='object')module.exports=api;else root.GeoLeadGeography=api;})(typeof globalThis!=='undefined'?globalThis:this,()=>{
 function create(source,data){
  if(!source||!Array.isArray(source.rows)||!source.crm||!source.extractedAt)throw Error('Fotografia de leads sem origem ou cobertura');
  const cityById=new Map(data.cities.map(c=>[String(c.id),c])),stateByUf=new Map();
  for(const c of data.cities)if(!stateByUf.has(c.uf))stateByUf.set(c.uf,{uf:c.uf,ufId:String(c.ufId),region:c.region});
  const seen=new Set(),rows=source.rows.map(r=>{const city=r.cityId?cityById.get(String(r.cityId)):null,state=stateByUf.get(r.uf||city?.uf),key=[r.brand,r.cityId||'',r.uf||city?.uf||''].join(':');if(seen.has(key))throw Error('Recorte geográfico duplicado: '+key);seen.add(key);if(!['agrobar','estica'].includes(r.brand)||!Number.isSafeInteger(r.count)||r.count<0||!state||r.cityId&&!city)throw Error('Linha de leads inválida: '+key);return {...r,uf:state.uf,ufId:state.ufId,region:state.region,city:city||null};});
  const coverage={};for(const brand of ['agrobar','estica']){const located=rows.filter(r=>r.brand===brand).reduce((s,r)=>s+r.count,0),missing=source.unmapped?.[brand]||0,total=source.totals?.[brand];if(!Number.isSafeInteger(missing)||missing<0||total!==located+missing)throw Error('Cobertura de leads não concilia: '+brand);coverage[brand]={total,located,missing,rate:total?located/total:null};}
  const groups=(brand,scope)=>{const map=new Map();for(const r of rows.filter(r=>r.brand===brand&&r.count)){const key=scope==='region'?r.region:scope==='uf'?r.uf:r.cityId;if(!key)continue;if(!map.has(key))map.set(key,{key,name:scope==='city'?r.city?.name+' / '+r.uf:key,count:0,cityCount:0});const g=map.get(key);g.count+=r.count;if(r.city)g.cityCount++;}return [...map.values()].sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name,'pt-BR'));};
  const states=(brand)=>new Map(groups(brand,'uf').map(r=>[r.key,r.count]));
  return {source,rows,coverage,groups,states};
 }
 return {create};
});
