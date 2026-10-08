"""Gera somente dados sintéticos, determinísticos, para a demonstração Fancore."""
import datetime as dt
import json
import random
from pathlib import Path

r = random.Random(18092026)
end = dt.date(2026, 9, 21)
start = end - dt.timedelta(days=179)
brands = [
    dict(id='estica', name='Estica', category='Bem-estar', initials='Es', daily=12, base=18, monthlyGoal=20, network=24),
    dict(id='agrobar', name='Agrobar', category='Entretenimento', initials='Ag', daily=8, base=48, monthlyGoal=12, network=48),
    dict(id='six', name='Six Labs', category='Tecnologia', initials='Sx', daily=16, base=32, monthlyGoal=25, network=32),
    dict(id='folks', name='Folks Pub', category='Entretenimento', initials='Fo', daily=4, base=10, monthlyGoal=5, network=10),
]
campaigns, leads, media = [], [], []
first = ['Marina','Rafael','Camila','Bruno','Beatriz','Gustavo','Renata','André','Patrícia','Felipe','Carolina','Thiago','Fernanda','Diego','Juliana','Rodrigo']
last = ['Almeida','Nogueira','Barbosa','Ribeiro','Mendes','Castro','Lopes','Moreira','Teixeira','Campos','Azevedo','Duarte','Vieira','Pereira','Martins']
cities = [('Londrina','PR'),('Maringá','PR'),('Curitiba','PR'),('Campinas','SP'),('Ribeirão Preto','SP'),('São Paulo','SP'),('Goiânia','GO'),('Uberlândia','MG'),('Florianópolis','SC'),('Cuiabá','MT'),('Joinville','SC'),('Belo Horizonte','MG')]
stages = ['lead','mql','sql','scheduled','meeting','cof','won']
for b in brands:
    for j,(channel,title) in enumerate([('Meta Ads','Conheça a franquia'),('Meta Ads','Histórias da rede'),('Google Ads','Busca por franquia'),('Orgânico','Conteúdo e indicação')]):
        campaigns.append(dict(id=f'{b["id"]}-{j}',brand=b['id'],channel=channel,name=f'{title} · {b["name"]}',format=['Vídeo','Depoimento','Pesquisa','Conteúdo'][j]))
    for day in range(180):
        date = start + dt.timedelta(days=day)
        n = max(1,round(b['daily']*(0.75+day/440)*r.uniform(.65,1.4)))
        for j in range(3):
            spend = round(b['daily']*[30,21,18][j]*r.uniform(.72,1.25),2)
            impressions = round(spend/r.uniform(12,25)*1000)
            clicks = round(impressions*r.uniform(.011,.028))
            media.append(dict(date=str(date),campaign=f'{b["id"]}-{j}',brand=b['id'],spend=spend,impressions=impressions,clicks=clicks))
        for _ in range(n):
            cid = r.choices(range(4),weights=[43,23,20,14])[0]
            events = {'lead':str(date)}
            moment = date
            for stage,prob,window in [('mql',.49,3),('sql',.65,4),('scheduled',.86,5),('meeting',.81,6),('cof',.65,5),('won',.20,12)]:
                if r.random()>prob: break
                moment += dt.timedelta(days=r.randint(1,window))
                if moment>end:break
                events[stage]=str(moment)
            city,uf=r.choice(cities)
            lost = 'won' not in events and (end-moment).days>12 and r.random()<.43
            leads.append(dict(id=f'DEMO-{len(leads)+1:05}',name=f'{r.choice(first)} {r.choice(last)}',brand=b['id'],campaign=f'{b["id"]}-{cid}',city=city,uf=uf,owner=r.choice(['Consultor A','Consultor B','Consultor C']),events=events,lost=lost,reason=r.choice(['Capital disponível','Praça indisponível','Momento de investimento','Sem retorno']) if lost else '',units=r.choices([1,2,3],[90,8,2])[0] if 'won' in events else 0,capital=r.choice([350000,500000,800000,1200000,1800000]),source=r.choice(['Instagram do Lucas','YouTube do Pedro','Instagram do JP','Indicação']) if cid==3 else campaigns[-4+cid]['channel']))
profiles=[dict(id='fancore',name='Fancore',role='A holding em movimento',type='brand',brand='all',initials='Fc',followers=18400),dict(id='lucas',name='Lucas Marcato',role='O método na prática',type='partner',brand='all',initials='LM',followers=52600),dict(id='pedro',name='Pedro Elero',role='Visão e cultura',type='partner',brand='all',initials='PE',followers=34900),dict(id='jp',name='JP Albuquerque',role='Negócio e estilo de vida',type='partner',brand='all',initials='JP',followers=25800)]
profiles += [dict(id=b['id'],name=b['name'],role=b['category'],type='brand',brand=b['id'],initials=b['initials'],followers=r.randint(16000,65000)) for b in brands]
for profile in profiles:
    profile['growth30'] = r.randint(300,1800)
titles=['O que faz uma unidade crescer','Por dentro de uma nova operação','A decisão antes de abrir uma franquia','Como construímos negócios para escalar','Quem está fazendo acontecer na ponta','Um aprendizado que mudou a operação','Da primeira conversa à nova unidade','O bastidor que quase ninguém vê','Por que o método importa','O próximo capítulo da nossa rede']
posts=[]
for p in profiles:
    for day in range(180):
        if r.random()>.28:continue
        date=start+dt.timedelta(days=day)
        network=r.choice(['Instagram','Instagram','YouTube','TikTok'])
        views=round(r.uniform(1200,45000)*(1.7 if r.random()<.13 else 1))
        likes=round(views*r.uniform(.02,.065)); comments=round(likes*r.uniform(.018,.07)); shares=round(likes*r.uniform(.04,.21)); saves=round(likes*r.uniform(.035,.17))
        posts.append(dict(id=f'post-{len(posts)}',profile=p['id'],brand=p['brand'],date=str(date),network=network,title=r.choice(titles),format='Vídeo longo' if network=='YouTube' else r.choice(['Reel','Reel','Carrossel']) if network=='Instagram' else 'Vídeo curto',views=views,reach=round(views*.76),likes=likes,comments=comments,shares=shares,saves=saves,clicks=round(views*r.uniform(.001,.008)),retention=r.randint(26,62),editoria=r.choice(['Bastidores','Prova da rede','Método','Oportunidade'])))
units=[]
for b in brands:
    for i in range(b['network']):
        city,uf=cities[i%len(cities)]
        connected=(i%7!=0)
        units.append(dict(id=f'unit-{b["id"]}-{i}',brand=b['id'],name=f'{city} · Unidade {i+1:02}',city=city,uf=uf,connected=connected,followers=r.randint(1500,24000),growth=r.randint(25,540),posts=r.randint(5,22) if connected else 0,views=r.randint(7000,150000) if connected else 0,comments=r.randint(35,850) if connected else 0,lastPost=str(end-dt.timedelta(days=r.randint(0,6))) if connected else None,engagement=round(r.uniform(2.1,7.9),1) if connected else None))
# Eventos de envio separados do recebimento, sem alterar contratos sintéticos anteriores.
for index, lead in enumerate(leads):
    e = lead['events']
    if 'cof' in e:
        e['cofSent'] = str(max(dt.date.fromisoformat(e['meeting']), dt.date.fromisoformat(e['cof']) - dt.timedelta(days=1)))
    elif 'meeting' in e and index % 3 == 0:
        sent = dt.date.fromisoformat(e['meeting']) + dt.timedelta(days=2)
        if sent <= end:
            e['cofSent'] = str(sent)
stages.insert(stages.index('cof'), 'cofSent')
# Conteúdos próprios das unidades, separados dos perfis institucionais.
clock = dt.datetime(2026, 9, 21, 10, tzinfo=dt.timezone(dt.timedelta(hours=-3)))
rp = random.Random(21092026)
unit_posts = []
local_titles = {
    'estica': ['Uma pausa que muda o seu dia', 'Mobilidade no meio da rotina', 'Conheça quem cuida de você'],
    'agrobar': ['A cidade se encontra aqui', 'O bastidor da nossa noite', 'Uma mesa. Muitas histórias.'],
    'six': ['Tecnologia na rotina real', 'Um dia com a equipe local', 'Ideias que saem do papel'],
    'folks': ['O palco é nosso ponto de encontro', 'A sua próxima noite começa aqui', 'O som que reúne a cidade']
}
for u in units:
    u['handle'] = 'demo.' + u['id'].replace('unit-', '').replace('-', '.')
    if not u['connected']:
        continue
    for n in range(rp.randint(1, 3)):
        age = rp.randint(15, 48 * 60)
        timestamp = clock - dt.timedelta(minutes=age)
        likes = rp.randint(60, 2800)
        unit_posts.append(dict(id=f'unit-post-{len(unit_posts)}', unit=u['id'], brand=u['brand'],
            network='Instagram', publishedAt=timestamp.isoformat(), collectedAt=clock.isoformat(),
            title=rp.choice(local_titles[u['brand']]), format=rp.choice(['Reel','Carrossel']),
            likes=likes, comments=rp.randint(5, 180), views=None, shares=None, saves=None,
            permalink=None, thumbnail=None, demo=True))
trend_examples = {
    'brasil': [('Cultura','Festivais de música','Como a cidade se encontra'),('Tecnologia','IA no dia a dia','Ferramentas e novos hábitos'),('Esporte','Futebol brasileiro','A conversa das torcidas'),('Consumo','Experiências de fim de semana','O desejo de sair da rotina'),('Negócios','Empreendedorismo local','Novos negócios, novas conversas')],
    'mundo': [('Tecnologia','Agentes de inteligência artificial','O próximo jeito de trabalhar'),('Ciência','Exploração espacial','Descobertas que movem o mundo'),('Cultura','Novos lançamentos no streaming','Histórias que ganham audiência'),('Comportamento','Economia da longevidade','Mais tempo, novas escolhas'),('Consumo','Viagens e experiências','Os destinos da conversa')]
}
trending = []
for scope, examples in trend_examples.items():
    for i, (category, title, context) in enumerate(examples):
        trending.append(dict(id=f'{scope}-{i}',scope=scope,category=category,title=title,context=context,
            growth=[320,240,180,140,110][i],series=[12+i*2,20,16+i*3,34,42+i*2,48,72+i*3,100],
            source='Cenário fictício', collectedAt=clock.isoformat(),demo=True))
# Camada de receita. Valores e caminhos servem somente à demonstração.
rr = random.Random(2109202604)
route_names = {'direct': 'Aplicação direta', 'webinar': 'Webinário', 'relationship': 'Orgânico e indicação'}
fees = {'estica': 65000, 'agrobar': 80000, 'six': 40000, 'folks': 95000}
for b in brands:
    b['demoFee'] = fees[b['id']]
    b['routes'] = [dict(id=k, name=route_names[k], status=(
        'Em uso, informado por Lucas' if b['id']=='six' and k=='webinar' else
        'Planejado na estratégia; ativação a confirmar' if k=='webinar' else 'Operação a validar'),
        note=('Inscrição, audiência, oferta e aplicação antes da qualificação.' if k=='webinar' else
              'Captação direta e avaliação comercial.' if k=='direct' else 'Conteúdo e relacionamento alimentam o comercial.'))
        for k in (['webinar','relationship'] if b['id']=='six' else ['direct','relationship'] if b['id']=='folks' else ['webinar','direct','relationship'])]
for c in campaigns:
    j = int(c['id'].split('-')[-1])
    c['funnel'] = 'relationship' if j==3 else 'webinar' if c['brand']=='six' or (j==0 and c['brand']!='folks') else 'direct'
    c['name'] = route_names[c['funnel']] + ' · ' + ['Oportunidade','Histórias da rede','Busca por franquia','Conteúdo e indicação'][j]
for l in leads:
    c = next(c for c in campaigns if c['id']==l['campaign'])
    l['funnel'] = c['funnel']
    l['traffic'] = 'nonpaid' if c['channel']=='Orgânico' else 'paid'
    e = l['events']
    if l['funnel']=='webinar':
        # Datas iguais são eventos distintos no mesmo dia. Não infere etapas pelo status.
        qualified = 'mql' in e
        if qualified or rr.random()<.38:
            e['watched'] = e['lead']
            if qualified or rr.random()<.60:
                e['offer'] = e['lead']
                if qualified or rr.random()<.52:
                    e['application'] = e['lead']
    last_event = max(e.values())
    l['lostAt'] = str(min(end, dt.date.fromisoformat(last_event)+dt.timedelta(days=rr.randint(4,12)))) if l['lost'] else None
    l['contractValue'] = fees[l['brand']] * l['units'] if 'won' in e else None
    l['opportunityValue'] = fees[l['brand']] * (l['units'] or 1)
    l['expectedClose'] = str(end+dt.timedelta(days=rr.randint(-5,35))) if not l['lost'] and 'won' not in e else None
    l['nextAction'] = 'Confirmar o próximo passo com o candidato' if 'meeting' in e else 'Retomar contato e validar interesse'
    l['nextActionAt'] = str(end+dt.timedelta(days=rr.randint(-9,4))) if not l['lost'] and 'won' not in e else None
    l['demo'] = True
for row in media:
    row['funnel'] = next(c['funnel'] for c in campaigns if c['id']==row['campaign'])
data=dict(meta=dict(demo=True,version=4,asOf=str(end),generatedAt='21/09/2026, 10h',
    referenceAt=clock.isoformat(),goal=1000,deadline='2028-12-31',
    notice='Todos os números, conteúdos e registros são fictícios.'),
    brands=brands,campaigns=campaigns,leads=leads,media=media,profiles=profiles,posts=posts,
    units=units,unitPosts=unit_posts,trending=trending,stages=stages,
    revenueSettings=dict(currency='BRL',valueBasis='Taxas de franquia contratadas, fictícias',
        stageProbability=dict(lead=.01,watched=.02,offer=.03,application=.05,mql=.08,sql=.15,scheduled=.22,meeting=.35,cofSent=.45,cof=.60),
        stageSlaDays=dict(lead=2,watched=2,offer=2,application=2,mql=2,sql=3,scheduled=7,meeting=3,cofSent=3,cof=5),
        conversionTargets=dict(watched=.65,offer=.75,application=.65,mql=.60,sql=.70,scheduled=.90,meeting=.85,cofSent=.80,cof=.90,won=.25),
        statuses=dict(crm='simulated',ads='simulated',webinar='simulated',finance='unavailable')))
path=Path(__file__).parent/'site'/'data.json'
path.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':')))
print(json.dumps({'leads':len(leads),'vendas':sum('won' in l['events'] for l in leads),'posts':len(posts),
    'unidades':len(units),'postsUnidades':len(unit_posts),'bytes':path.stat().st_size}))
