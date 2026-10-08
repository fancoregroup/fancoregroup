'use strict';
(function(root,factory){const api=factory();if(typeof module==='object')module.exports=api;else root.GeoNetworks=api;})(typeof globalThis!=='undefined'?globalThis:this,()=>{
 const labels={operando:'Aberto e operando',fechou:'Abriu e fechou',implantacao:'Vendido em implantação',voltou:'Vendeu e voltou',informada:'Unidade informada · status a confirmar'};
 function create(payload){
  const brands=[{id:'agrobar',name:'Agrobar',symbol:'A',cities:payload.cities.filter(c=>c.country==='BR').map(c=>({...c,reference:payload.reference,source:payload.source}))},...(payload.holdingNetworks||[])];
  const records=brands.flatMap(b=>b.cities.map(c=>({...c,brand:b.id,brandName:b.name,symbol:b.symbol})));
  const byCity=new Map();for(const r of records){if(!byCity.has(r.id))byCity.set(r.id,[]);byCity.get(r.id).push(r);}
  const at=(id,brand='')=>(byCity.get(id)||[]).filter(r=>!brand||r.brand===brand);
  function mapFor(brand=''){
   const priority=['operando','implantacao','informada','voltou','fechou'],result=new Map();
   for(const [id] of byCity){const rows=at(id,brand);if(rows.length)result.set(id,{...rows.slice().sort((a,b)=>priority.indexOf(a.status)-priority.indexOf(b.status))[0],brands:rows.map(r=>r.brand)});}
   return result;
  }
  function matches(id,brand,status){const rows=at(id,brand);return status==='sem-registro'?!rows.length:status?rows.some(r=>r.status===status):!brand||!!rows.length;}
  return {brands,records,byCity,at,mapFor,matches,labels};
 }
 return {create,labels};
});
