/* Métricas puras. As mesmas funções alimentam a interface e os testes. */
(function(root){
'use strict';
const common=['lead','mql','sql','scheduled','meeting','cofSent','cof','won'];
const webinar=['lead','watched','offer','application',...common.slice(1)];
const labels={lead:'Leads',watched:'Assistiram',offer:'Chegaram à oferta',application:'Aplicaram',mql:'Perfil aderente · MQL',sql:'Prontos para venda · SQL',scheduled:'Reuniões agendadas',meeting:'Reuniões realizadas',cofSent:'COFs enviadas',cof:'COFs recebidas',won:'Contratos assinados'};
const add=(s,n)=>{const d=new Date(s+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
const diff=(a,b)=>Math.round((new Date(a+'T12:00:00Z')-new Date(b+'T12:00:00Z'))/864e5);
const sum=(xs,key)=>xs.reduce((s,x)=>s+(Number(x[key])||0),0);
const divide=(a,b)=>b>0?a/b:null;
const range=(d,s,e)=>!!d&&d>=s&&d<=e;
const median=xs=>{const a=[...xs].sort((a,b)=>a-b);return a.length?(a[Math.floor((a.length-1)/2)]+a[Math.ceil((a.length-1)/2)])/2:null};
const week=s=>{const day=new Date(s+'T12:00:00Z').getUTCDay();return add(s,-((day+6)%7))};
const status=(l,end)=>l.events.won&&l.events.won<=end?'won':l.lostAt&&l.lostAt<=end?'lost':'open';
const reached=(l,s,end)=>!!l.events[s]&&l.events[s]<=end;
const stage=(l,end)=>[...(l.funnel==='webinar'?webinar:common)].reverse().find(s=>reached(l,s,end))||'lead';
function analyze(D,options={}){
  const o={brand:'estica',funnel:'all',traffic:'all',days:30,shift:0,...options};
  const end=add(D.meta.asOf,-o.shift*o.days),start=add(end,1-o.days);
  const matches=l=>(o.brand==='all'||l.brand===o.brand)&&(o.funnel==='all'||l.funnel===o.funnel)&&(o.traffic==='all'||l.traffic===o.traffic);
  const leads=D.leads.filter(l=>matches(l)&&l.events.lead<=end);
  const cohort=leads.filter(l=>range(l.events.lead,start,end));
  const campaigns=D.campaigns.filter(c=>(o.brand==='all'||c.brand===o.brand)&&(o.funnel==='all'||c.funnel===o.funnel)&&(o.traffic==='all'||(c.channel==='Orgânico'?'nonpaid':'paid')===o.traffic));
  const campaignIds=new Set(campaigns.map(c=>c.id));
  const media=D.media.filter(m=>campaignIds.has(m.campaign)&&range(m.date,start,end));
  const hasPaid=campaigns.some(c=>c.channel!=='Orgânico');
  const spend=hasPaid?sum(media,'spend'):null;
  const stages=o.funnel==='webinar'?webinar:common;
  const events=Object.fromEntries([...new Set([...common,...webinar])].map(s=>[s,leads.filter(l=>range(l.events[s],start,end)).length]));
  const counts=Object.fromEntries(stages.map(s=>[s,cohort.filter(l=>reached(l,s,end)).length]));
  const paidCohort=cohort.filter(l=>l.traffic==='paid');
  const wins=leads.filter(l=>range(l.events.won,start,end));
  const cohortWins=cohort.filter(l=>status(l,end)==='won');
  const paidCohortWins=paidCohort.filter(l=>status(l,end)==='won');
  const revenue=sum(wins,'contractValue'),cohortRevenue=sum(cohortWins,'contractValue');
  const funnel=stages.map((s,i)=>{
    const n=counts[s],previous=i?counts[stages[i-1]]:null;
    const moved=cohort.filter(l=>reached(l,s,end));
    const current=moved.filter(l=>status(l,end)==='open'&&stage(l,end)===s);
    const elapsed=i?moved.map(l=>diff(l.events[s],l.events[stages[i-1]])).filter(Number.isFinite):[];
    const paidCount=paidCohort.filter(l=>reached(l,s,end)).length;
    return {id:s,label:s==='lead'&&o.funnel==='webinar'?'Inscritos':labels[s],count:n,previous,conversion:i?divide(n,previous):null,target:i?D.revenueSettings.conversionTargets[s]:null,medianDays:median(elapsed),open:current,paidCount,cost:spend===null?null:divide(spend,paidCount)};
  });
  const bottlenecks=funnel.filter(f=>f.previous>=20&&f.conversion!==null&&f.target>f.conversion).map(f=>({...f,gap:f.target-f.conversion,additional:Math.max(0,Math.ceil(f.previous*f.target)-f.count)})).sort((a,b)=>b.gap-a.gap);
  const open=leads.filter(l=>status(l,end)==='open').map(l=>{
    const s=stage(l,end),age=diff(end,l.events[s]),sla=D.revenueSettings.stageSlaDays[s]||3;
    return {...l,currentStage:s,stageAge:age,sla,probability:D.revenueSettings.stageProbability[s]||0};
  });
  const monthStart=end.slice(0,7)+'-01';
  const monthEnd=new Date(Date.UTC(+end.slice(0,4),+end.slice(5,7),0,12)).toISOString().slice(0,10);
  const monthlyWins=leads.filter(l=>range(l.events.won,monthStart,end));
  const forecastDeals=open.filter(l=>l.expectedClose&&l.expectedClose>end&&l.expectedClose<=monthEnd);
  const weighted=forecastDeals.reduce((s,l)=>s+l.opportunityValue*l.probability,0);
  const monthlyRevenue=sum(monthlyWins,'contractValue');
  const allMonthlyGoal=D.brands.filter(b=>o.brand==='all'||b.id===o.brand).reduce((s,b)=>s+b.monthlyGoal,0);
  const lost=leads.filter(l=>range(l.lostAt,start,end));
  const reasons=[...new Set(lost.map(l=>l.reason))].map(reason=>({reason,count:lost.filter(l=>l.reason===reason).length})).sort((a,b)=>b.count-a.count);
  const cohorts=[];
  for(let w=week(start);w<=end;w=add(w,7)){
    const ws=w<start?start:w,we=add(w,6)>end?end:add(w,6);
    const items=cohort.filter(l=>range(l.events.lead,ws,we));
    const paid=items.filter(l=>l.traffic==='paid');
    const paidWins=paid.filter(l=>status(l,end)==='won');
    const weekSpend=hasPaid?sum(media.filter(m=>range(m.date,ws,we)),'spend'):null;
    const won=items.filter(l=>status(l,end)==='won');
    cohorts.push({id:w,start:ws,end:we,partial:ws!==w||we!==add(w,6),items,ageMin:diff(end,we),leads:items.length,mql:items.filter(l=>reached(l,'mql',end)).length,meeting:items.filter(l=>reached(l,'meeting',end)).length,cofSent:items.filter(l=>reached(l,'cofSent',end)).length,won:won.length,open:items.filter(l=>status(l,end)==='open').length,revenue:sum(won,'contractValue'),spend:weekSpend,roas:weekSpend===null?null:divide(sum(paidWins,'contractValue'),weekSpend),conversion:divide(won.length,items.length)});
  }
  const campaignRows=campaigns.map(c=>{
    const items=cohort.filter(l=>l.campaign===c.id),paid=c.channel!=='Orgânico',m=media.filter(m=>m.campaign===c.id),cost=paid?sum(m,'spend'):null;
    const mql=items.filter(l=>reached(l,'mql',end)).length,won=items.filter(l=>status(l,end)==='won');
    return {...c,items,spend:cost,leads:items.length,mql,won:won.length,revenue:sum(won,'contractValue'),cpl:paid?divide(cost,items.length):null,cpmql:paid?divide(cost,mql):null,roas:paid?divide(sum(won,'contractValue'),cost):null,clicks:sum(m,'clicks'),impressions:sum(m,'impressions')};
  });
  const alerts=[
    {id:'stage',name:'Tempo na etapa',description:'Oportunidades abertas acima do prazo de referência.',items:open.filter(l=>l.stageAge>l.sla),action:'Revisar o motivo da parada e registrar o próximo passo.'},
    {id:'task',name:'Próximo passo vencido',description:'Data da próxima ação anterior à referência.',items:open.filter(l=>l.nextActionAt&&l.nextActionAt<end),action:'Atualizar a agenda de follow-up com o responsável.'},
    {id:'closing',name:'Fechamento atrasado',description:'Previsão de assinatura vencida e contrato ainda aberto.',items:open.filter(l=>l.expectedClose&&l.expectedClose<end),action:'Revalidar a data de fechamento e o valor esperado.'},
    {id:'cof',name:'COF sem confirmação',description:'COF enviada há mais de três dias sem recebimento registrado.',items:open.filter(l=>l.currentStage==='cofSent'&&l.stageAge>3),action:'Confirmar o recebimento e atualizar o histórico comercial.'}
  ];
  const pipeline=stages.filter(s=>s!=='won').map(s=>({id:s,label:labels[s],items:open.filter(l=>l.currentStage===s),count:open.filter(l=>l.currentStage===s).length}));
  // Em "todos os funis", os estados exclusivos de webinário entram em Pré-qualificação.
  if(o.funnel!=='webinar'){
    const pre=open.filter(l=>['watched','offer','application'].includes(l.currentStage));
    pipeline[0].items.push(...pre);pipeline[0].count+=pre.length;pipeline[0].label='Entrada / pré-qualificação';
  }
  return {options:o,start,end,leads,cohort,paidCohort,media,campaignRows,events,counts,funnel,bottlenecks,spend,wins,revenue,cohortRevenue,cohortWins,units:sum(wins,'units'),cpl:spend===null?null:divide(spend,paidCohort.length),costPerWon:spend===null?null:divide(spend,paidCohortWins.length),roas:spend===null?null:divide(sum(paidCohortWins,'contractValue'),spend),cycle:median(wins.map(l=>diff(l.events.won,l.events.lead))),open,pipeline,pipelineValue:sum(open,'opportunityValue'),lost,reasons,cohorts:cohorts.reverse(),alerts,forecast:{monthStart,monthEnd,deals:forecastDeals,weighted,monthlyRevenue,total:monthlyRevenue+weighted,monthlyUnits:sum(monthlyWins,'units'),goal:allMonthlyGoal,goalApplicable:o.funnel==='all'&&o.traffic==='all'},impressions:sum(media,'impressions'),clicks:sum(media,'clicks')};
}
const api={analyze,common,webinar,labels,add,diff,divide,status,stage,median,week};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.Revenue=api;
})(typeof window!=='undefined'?window:globalThis);
