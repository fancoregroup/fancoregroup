'use strict';
(function(root,factory){const api=factory();if(typeof module==='object')module.exports=api;else root.GeoPerformance=api;})(typeof globalThis!=='undefined'?globalThis:this,()=>{
 const metrics=[['population','População estimada'],['medianIncome','Renda mediana por pessoa'],['gdpPerCapita','PIB per capita'],['exp_ad18','Adultos 18+'],['agroGva','VAB agropecuário']];
 const value=(city,key)=>{const n=city?.metrics?.[key]?.value;return Number.isFinite(n)?n:null;};
 const median=values=>{const v=values.filter(Number.isFinite).sort((a,b)=>a-b),m=Math.floor(v.length/2);return v.length?(v.length%2?v[m]:(v[m-1]+v[m])/2):null;};
 const rank=values=>{const sorted=values.map((v,i)=>({v,i})).sort((a,b)=>a.v-b.v),result=[];for(let i=0;i<sorted.length;){let j=i+1;while(j<sorted.length&&sorted[j].v===sorted[i].v)j++;for(let k=i;k<j;k++)result[sorted[k].i]=(i+j+1)/2;i=j;}return result;};
 function spearman(pairs){if(pairs.length<5)return null;const a=rank(pairs.map(p=>p[0])),b=rank(pairs.map(p=>p[1])),ma=a.reduce((s,v)=>s+v,0)/a.length,mb=b.reduce((s,v)=>s+v,0)/b.length;let xy=0,xx=0,yy=0;for(let i=0;i<a.length;i++){const x=a[i]-ma,y=b[i]-mb;xy+=x*y;xx+=x*x;yy+=y*y;}return xx&&yy?xy/Math.sqrt(xx*yy):null;}
 function create(source,data){
  if(!source||source.metric!=='sales_displayed_brl'||!Array.isArray(source.rows))throw Error('Fonte de performance inválida');
  const cityById=new Map(data.cities.map(c=>[String(c.id),c]));
  const rows=source.rows.map(([rank,label,brand,cityId,cents])=>({rank,label,brand,cityId,city:cityById.get(String(cityId))||null,cents,amount:cents/100}));
  const byCity=new Map();for(const r of rows){if(!r.cityId)continue;const key=r.brand+':'+r.cityId;if(!byCity.has(key))byCity.set(key,[]);byCity.get(key).push(r);}
  const totals={};for(const r of rows)totals[r.brand]=(totals[r.brand]||0)+r.cents;
  const findings=(brand='agrobar')=>metrics.map(([key,label])=>{const pairs=rows.filter(r=>r.brand===brand&&r.cents>0&&r.city&&value(r.city,key)!==null).map(r=>[r.amount,value(r.city,key)]);return {key,label,n:pairs.length,rho:spearman(pairs),metricMedian:median(pairs.map(p=>p[1])),year:data.indicators[key]?.years?.join(', ')||null};});
  const at=(cityId,brand='')=>rows.filter(r=>r.cityId===String(cityId)&&(!brand||r.brand===brand));
  const groups=(brand='agrobar',scope='uf')=>{const map=new Map();for(const r of rows.filter(r=>r.brand===brand&&r.city)){const key=scope==='region'?r.city.region:r.city.uf;if(!map.has(key))map.set(key,{name:key,cents:0,rows:0,positive:0});const g=map.get(key);g.cents+=r.cents;g.rows++;if(r.cents>0)g.positive++;}return [...map.values()].sort((a,b)=>b.cents-a.cents);};
  return {source,rows,byCity,totals,at,groups,findings,metrics,median};
 }
 return {create,spearman,median,metrics};
});
