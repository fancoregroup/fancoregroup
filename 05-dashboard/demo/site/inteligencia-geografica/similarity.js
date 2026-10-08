'use strict';
(function(root,factory){const api=factory();if(typeof module==='object')module.exports=api;else root.GeoSimilarity=api;})(typeof globalThis!=='undefined'?globalThis:this,()=>{
  // Critérios explícitos de triagem, não um modelo treinado com resultado das unidades.
  const version='perfil-municipal-v1';
  const criteria=Object.freeze([
    {key:'population',label:'População',weight:30,mode:'ratio',scale:2,scaleLabel:'razão de 2 vezes'},
    {key:'income',label:'Renda por pessoa',weight:25,mode:'ratio',scale:2,scaleLabel:'razão de 2 vezes'},
    {key:'density',label:'Densidade',weight:15,mode:'log1p',scale:3,scaleLabel:'razão de 3 vezes em (densidade + 1)'},
    {key:'youngAdultsShare',label:'População de 20 a 39 anos',weight:15,mode:'points',scale:10,scaleLabel:'10 pontos percentuais'},
    {key:'agroShare',label:'Agropecuária no VAB',weight:15,mode:'points',scale:20,scaleLabel:'20 pontos percentuais'},
  ].map(Object.freeze));
  const value=(city,key)=>city?.metrics?.[key]?.value;
  const normalize=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  function validProfile(city){return criteria.every(c=>{
    const n=value(city,c.key),year=city?.metrics?.[c.key]?.year;
    return Number.isFinite(n)&&n>=0&&(c.mode!=='ratio'||n>0)&&(c.mode!=='points'||n<=100)&&year!==null&&year!==undefined&&String(year).trim()!=='';
  });}
  function gap(a,b,criterion){
    const d=criterion.mode==='points'?Math.abs(a-b)/criterion.scale:criterion.mode==='log1p'?Math.abs(Math.log1p(a)-Math.log1p(b))/Math.log(criterion.scale):Math.abs(Math.log(a)-Math.log(b))/Math.log(criterion.scale);
    return Math.min(1,Math.max(0,d));
  }
  function pair(a,b,details=true){
    if(!validProfile(a)||!validProfile(b)||criteria.some(c=>String(a.metrics[c.key].year)!==String(b.metrics[c.key].year)))return null;
    let sum=0;const parts=[];
    for(const c of criteria){const av=value(a,c.key),bv=value(b,c.key),delta=gap(av,bv,c);sum+=c.weight*delta*delta;if(details)parts.push({...c,value:av,referenceValue:bv,gap:delta,year:a.metrics[c.key].year});}
    const score=Math.max(0,Math.min(100,100*(1-Math.sqrt(sum/100))));
    return details?{score,criteria:parts}:score;
  }
  function createMatcher(cities,network){
    const operating=cities.filter(c=>network.get(c.id)?.status==='operando');
    const references=operating.filter(validProfile).sort((a,b)=>a.name.localeCompare(b.name,'pt-BR')||a.id.localeCompare(b.id));
    const cache=new Map();
    function rank(options={}){
      const referenceId=options.referenceId||'',refs=referenceId?references.filter(c=>c.id===referenceId):references;
      if(!cache.has(referenceId)){
        const records=cities.filter(c=>network.get(c.id)?.status!=='operando').map(city=>{
          const nearest=refs.map(reference=>({reference,score:pair(city,reference,false)})).filter(m=>m.score!==null).sort((a,b)=>b.score-a.score||a.reference.name.localeCompare(b.reference.name,'pt-BR')||a.reference.id.localeCompare(b.reference.id));
          if(!nearest.length)return {city,match:null};
          const best=nearest[0],detail=pair(city,best.reference);
          return {city,match:{city,reference:best.reference,...detail,alternatives:nearest.slice(1,3)}};
        });
        cache.set(referenceId,records);
      }
      const query=normalize(options.query),threshold=Number.isFinite(options.minScore)?Math.max(0,Math.min(100,options.minScore)):85;
      const eligible=cache.get(referenceId).filter(({city})=>{
        const status=network.get(city.id)?.status;
        const inScope=options.scope==='history'?['fechou','voltou'].includes(status):!network.has(city.id);
        return inScope&&(!options.uf||city.uf===options.uf)&&(!query||normalize(city.name+' '+city.uf+' '+city.id).includes(query));
      });
      const matches=eligible.filter(x=>x.match&&x.match.score>=threshold).map(x=>x.match).sort((a,b)=>b.score-a.score||a.city.name.localeCompare(b.city.name,'pt-BR')||a.city.id.localeCompare(b.city.id));
      return {matches,references:refs,operatingCount:operating.length,referenceMissing:operating.length-references.length,eligibleCount:eligible.length,missingCount:eligible.filter(x=>!x.match).length,threshold,options:{referenceId,uf:options.uf||'',query:options.query||'',scope:options.scope==='history'?'history':'new',minScore:threshold}};
    }
    return {references,rank};
  }
  function csv(result,indicators,network,brandName='Agrobar'){
    const safe=v=>{let s=String(v??'');if(/^[=+@\-]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
    const headers=['Posição','Código IBGE','Cidade candidata','UF','Situação na rede selecionada','Marca de referência','Referência da base operacional','Referência IBGE','Cidade operando','UF referência','Semelhança (0 a 100)','Método','Escopo','Referência escolhida','Corte mínimo',...criteria.flatMap(c=>[c.label+' candidata',c.label+' operando','Ano '+c.key,'Fonte '+c.key,'Peso '+c.key,'Escala '+c.key])];
    const rows=result.matches.map((m,i)=>[i+1,m.city.id,m.city.name,m.city.uf,network.get(m.city.id)?.status||'Sem registro na base',brandName,network.get(m.reference.id)?.reference||'2026-09-21',m.reference.id,m.reference.name,m.reference.uf,Number(m.score.toFixed(4)),version,result.options.scope,result.options.referenceId||'Operação mais parecida',result.threshold,...criteria.flatMap(c=>[value(m.city,c.key),value(m.reference,c.key),m.city.metrics[c.key].year,indicators[c.key]?.source,c.weight,c.scaleLabel])]);
    return '\uFEFF'+[headers,...rows].map(row=>row.map(safe).join(';')).join('\r\n');
  }
  return {version,criteria,validProfile,gap,pair,createMatcher,csv};
});
