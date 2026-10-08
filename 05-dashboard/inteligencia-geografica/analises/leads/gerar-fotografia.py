"""Agrega a geografia declarada nos snapshots privados de RD e ONECRM.

Somente contagens por município/UF saem deste processo; registros individuais
e credenciais permanecem em ~/.local/share/fancore/campaign-reports/.
"""
from collections import Counter, defaultdict
from pathlib import Path
import csv
import json
import re
import unicodedata

ROOT = Path(__file__).resolve().parents[2]
RAW = Path.home() / '.local/share/fancore/campaign-reports'
UF = set('AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split())


def norm(value):
    value = unicodedata.normalize('NFKD', str(value or ''))
    value = ''.join(c for c in value if not unicodedata.combining(c))
    value = value.upper()
    return re.sub(r'\s+', ' ', re.sub(r'[^A-Z0-9 ]+', ' ', value)).strip()


def main():
    with (ROOT / 'exportacoes/municipios-brasil.csv').open(encoding='utf-8-sig') as f:
        cities = list(csv.DictReader(f, delimiter=';'))
    by_name = defaultdict(list)
    for city in cities:
        by_name[norm(city['name'])].append(city)
    # Grafias observadas na fonte, sem inferir cidade a partir de DDD ou campanha.
    aliases = {'RIBEIRAO PRETO': 'RIBEIRAO PRETO', 'SAO JOSE DO RIO PRETO': 'SAO JOSE DO RIO PRETO'}

    def locate(value, hint=''):
        s = norm(value)
        if not s:
            return None, None
        state = None
        parts = s.split()
        if parts and parts[-1] in UF:
            state = parts[-1]
            s = ' '.join(parts[:-1])
        elif s in UF:
            return None, s
        if hint in UF:
            if state and state != hint:
                return None, None
            state = hint
        candidates = by_name.get(aliases.get(s, s), [])
        if state:
            candidates = [c for c in candidates if c['uf'] == state]
        if len(candidates) == 1:
            return candidates[0]['id'], candidates[0]['uf']
        return None, state if state in UF else None

    rd = json.loads((RAW / 'rd-estica.json').read_text())
    one = json.loads((RAW / 'onecrm.json').read_text())
    if not rd['coverage']['complete'] or not one['coverage']['contacts']['complete'] or not all(x['complete'] for x in one['coverage']['channels'].values()):
        raise RuntimeError('Paginação do CRM incompleta')
    if len(rd['deals']) != rd['coverage']['total']:
        raise RuntimeError('RD não concilia')
    exclusive = {key for key, brands in one['membership'].items() if brands == ['agrobar']}
    counts = Counter()
    totals = Counter()
    unmapped = Counter()
    earliest = None
    latest = None

    def add(brand, date, city_id, state):
        nonlocal earliest, latest
        if not date:
            raise RuntimeError('Lead sem data de criação')
        date = date[:10]
        earliest = min(earliest or date, date)
        latest = max(latest or date, date)
        totals[brand] += 1
        if state:
            counts[(brand, city_id, state)] += 1
        else:
            unmapped[brand] += 1

    for deal in rd['deals']:
        fields = {x['custom_field']['label']: x.get('value') for x in deal['deal_custom_fields']}
        city = fields.get('Cidade') or fields.get('Qual sua Cidade/Estado?')
        hint_text = norm(fields.get('Qual sua Cidade/Estado?'))
        hint = hint_text if hint_text in UF else ''
        city_id, state = locate(city, hint)
        add('estica', deal['created_at'], city_id, state)
    for contact in one['contacts']:
        if contact['id'] not in exclusive:
            continue
        city_id, state = locate(contact.get('city'))
        add('agrobar', contact['createdAt'], city_id, state)

    result = {
        'version': 'crm-leads-geography-v1',
        'crm': 'RD Station CRM (Estica) e ONECRM (Agrobar)',
        'extractedAt': max(rd['fetchedAt'], one['fetchedAt']),
        'periodStart': earliest,
        'periodEnd': latest,
        'definition': 'Estica: negociações do RD, uma por ID de negociação. Agrobar: contatos exclusivos do canal Agrobar no ONECRM, um por ID; contatos também ligados a outra marca são excluídos. Todas as datas de criação disponíveis na fotografia, inclusive negócios perdidos e contatos arquivados. Cidade declarada, normalizada contra os municípios do IBGE; nomes ambíguos sem UF ficam fora do mapa.',
        'totals': {b: totals[b] for b in ('agrobar', 'estica')},
        'unmapped': {b: unmapped[b] for b in ('agrobar', 'estica')},
        'rows': [{'brand': b, 'cityId': cid, 'uf': state, 'count': count} for (b, cid, state), count in sorted(counts.items(), key=lambda item: tuple(x or '' for x in item[0]))],
    }
    for brand in result['totals']:
        if sum(r['count'] for r in result['rows'] if r['brand'] == brand) + result['unmapped'][brand] != result['totals'][brand]:
            raise RuntimeError('Totais não conciliados')
    dest = Path(__file__).with_name('crm-geografia-2026-10-03.json')
    dest.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')) + '\n')
    print(json.dumps({'totals': result['totals'], 'unmapped': result['unmapped'], 'rows': len(result['rows']), 'periodStart': earliest, 'periodEnd': latest}, ensure_ascii=False))


if __name__ == '__main__':
    main()
