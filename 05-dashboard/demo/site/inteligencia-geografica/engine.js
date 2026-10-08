'use strict';
(function(root, factory) { const api=factory(); if(typeof module==='object') module.exports=api; else root.GeoEngine=api; })(typeof globalThis!=='undefined'?globalThis:this,()=>{
  const value=(city,key)=>city?.metrics?.[key]?.value??null;
  const norm=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  function distance(a,b) {
    if(![a?.lat,a?.lng,b?.lat,b?.lng].every(Number.isFinite))return null;
    const rad=n=>n*Math.PI/180,dlat=rad(b.lat-a.lat),dlng=rad(b.lng-a.lng);
    const h=Math.sin(dlat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dlng/2)**2;
    return 6371*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));
  }
  function percentileIndex(cities,keys) {
    const result={};
    for(const key of keys){
      const numbers=cities.map(c=>value(c,key)).filter(Number.isFinite).sort((a,b)=>a-b);
      result[key]=new Map();
      for(let i=0;i<numbers.length;){let j=i;while(j+1<numbers.length&&numbers[j+1]===numbers[i])j++;result[key].set(numbers[i],numbers.length===1?50:((i+j)/2)/(numbers.length-1)*100);i=j+1;}
    }
    return result;
  }
  function score(city,weights,index) {
    const used=Object.entries(weights).filter(([,w])=>Number.isFinite(w)&&w>0);
    if(!used.length||used.some(([k])=>!Number.isFinite(value(city,k))))return null;
    return used.reduce((s,[k,w])=>s+index[k].get(value(city,k))*w,0)/used.reduce((s,[,w])=>s+w,0);
  }
  function filter(cities,filters,network) {
    const query=norm(filters.query);
    return cities.filter(c=>{
      const p=value(c,'population'),status=network.get(c.id)?.status||'sem-registro';
      return (!query||norm(c.name+' '+c.uf+' '+c.state+' '+c.id).includes(query))&&(!filters.uf||c.uf===filters.uf)&&(!filters.region||c.region===filters.region)&&(!filters.status||status===filters.status)&&(!filters.minPopulation||(p!==null&&p>=filters.minPopulation))&&(!filters.maxPopulation||(p!==null&&p<=filters.maxPopulation));
    });
  }
  function sorted(cities,key,scores){return [...cities].sort((a,b)=>{const av=key==='score'?scores.get(a.id):value(a,key),bv=key==='score'?scores.get(b.id):value(b,key);if(av===null&&bv===null)return a.name.localeCompare(b.name,'pt-BR');if(av===null)return 1;if(bv===null)return -1;return bv-av||a.name.localeCompare(b.name,'pt-BR');});}
  function csv(cities,indicators,network,scores,weights){
    const keys=Object.keys(indicators),headers=['Código IBGE','Município','UF','Situação na holding (ver colunas por marca)',...keys.flatMap(k=>[`${indicators[k].label} (${indicators[k].unit})`,'Ano '+k,'Fonte '+k]),'Índice exploratório (0 a 100)','Pesos do índice'];
    const safe=v=>{let s=String(v??'');if(/^[=+@\-]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
    const lines=cities.map(c=>[c.id,c.name,c.uf,network.get(c.id)?.status||'Sem registro na base',...keys.flatMap(k=>[value(c,k),c.metrics[k]?.year,indicators[k].source]),scores.get(c.id)??'',JSON.stringify(weights)]);
    return '\uFEFF'+[headers,...lines].map(row=>row.map(safe).join(';')).join('\r\n');
  }
  return {value,norm,distance,percentileIndex,score,filter,sorted,csv};
});
