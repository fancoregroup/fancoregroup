#!/usr/bin/env python3
"""Consolida aquisições e evidências depois que os downloads/ETLs terminarem."""
import json
from coletar import ROOT, now, save, sha, load_manifest


def main():
    manifest = load_manifest()
    sources = {x['id']: x for x in manifest['sources']}
    for filename in ['manifesto-caged-microdados.json', 'manifesto-notas.json']:
        other = json.loads((ROOT / filename).read_text())
        sources.update({x['id']: x for x in other['sources']})
        known = {(x.get('id'), x.get('accessed_at'), x.get('url')) for x in manifest['attempts']}
        manifest['attempts'].extend(x for x in other['attempts'] if (x.get('id'), x.get('accessed_at'), x.get('url')) not in known)
    integrity = json.loads((ROOT / 'integridade.json').read_text())
    assert integrity['complete'], 'Verificação de integridade ainda incompleta'
    verified = {x['id']: x for x in integrity['files']}
    aggregates = json.loads((ROOT / 'derived/validacao-agregados.json').read_text())
    rais = json.loads((ROOT / 'derived/validacao-rais-microdados.json').read_text())
    assert rais['complete_brazil'], 'Agregação RAIS ainda incompleta'
    for identifier, source in sources.items():
        check = verified[identifier]
        source['integrity'] = check['method']
        source['integrity_verified_at'] = check['checked_at']
        source['crc_verified'] = check.get('crc_verified')
        source['processing_status'] = 'documentacao' if identifier in ('rais-2025-nota-tecnica', 'caged-layout-oficial', 'caged-leia-me') else 'raw_disponivel'
        if identifier.startswith('rais-2025-rais_vinc'):
            source['processing_status'] = 'agregado_exploratorio_em_revisao_tabela_municipal'
            source['coverage'] = 'Parte regional oficial RAIS2025; vínculos ativos, remunerações e denominadores municipais/setoriais extraídos integralmente.'
        elif identifier == 'caged-202608':
            source['processing_status'] = 'serie_municipal_concluida'
            source['coverage'] = 'Jan2020 a ago2026, 80 meses, 5.571 municípios e código999999 separado; séries com e sem ajustes, recorte24meses e salários Brasil.'
        elif identifier == 'rais-2025-tabelas':
            source['processing_status'] = 'agregado_municipal_setorial_concluido'
            source['coverage'] = '2023,2024,2025; 5.571 municípios e código999999 separado; cinco setores e total. Contexto remuneratório agregado não municipal preservado.'
        elif identifier == 'rais-2024-complementar':
            source['processing_status'] = 'raw_preservado_revisao_anterior'
            source['coverage'] = 'Tabelas anuais2023 e2024 preservadas. Derivado de vínculos usa a revisão2025 mais recente.'
        elif identifier.startswith(('cagedmov', 'cagedfor', 'cagedexc')):
            source['processing_status'] = 'raw_integro_agregacao_salarial_pendente'
            source['coverage'] = 'Microdados oficiais públicos não identificados;23meses anteriores e agosto2026, MOV/FOR/EXC completos. Salários municipais ainda não tratados.'
    manifest['sources'] = sorted(sources.values(), key=lambda x: x['id'])
    derived = aggregates['datasets'] + [rais]
    for proof_path in sorted((ROOT / 'derived').glob('rais_vinc_pub_*-municipio-setor.json')):
        derived.append(json.loads(proof_path.read_text()))
    manifest['derived'] = [{**x, 'bytes': (ROOT / x['path']).stat().st_size, 'sha256': sha(ROOT / x['path'])} for x in derived]
    manifest['reports'] = []
    for name in ['integridade.json', 'derived/validacao-agregados.json', 'derived/validacao-rais-microdados.json', 'derived/tentativas-fontes.json', 'derived/auditoria-universo-rais-2025.json']:
        path = ROOT / name
        manifest['reports'].append({'path': name, 'bytes': path.stat().st_size, 'sha256': sha(path)})
    probes = json.loads((ROOT / 'derived/tentativas-fontes.json').read_text())
    manifest['alternative_official_access_attempts'] = [{'url': x['url'], 'accessed_at': x['accessed_at'], 'status': x['status'],
                                                        **({'error': x['error']} if 'error' in x else {})} for x in probes]
    manifest['status'] = {'acquisition': 'complete', 'raw_files': len(sources),
                          'raw_bytes': sum(x['bytes'] for x in sources.values()), 'raw_integrity_verified': True,
                          'rais_2025_municipal_payroll': 'exploratory_national_universe_reconciled_municipal_difference_pending', 'caged_municipal_employment_series': 'ready',
                          'caged_municipal_admission_wages': 'pending_etl', 'ui_or_scoring_changed': False}
    manifest['coverage'] = {'rais_municipal_jobs': {'years': [2023, 2024, 2025], 'municipalities': 5571},
                            'rais_municipal_wages': {'year': 2025, 'municipalities': rais['municipalities'], 'parts_processed': rais['parts_processed']},
                            'caged_municipal_series': {'start': '2020-01', 'end': '2026-08', 'months': 80, 'municipalities': 5571},
                            'caged_microdata': {'start': '2024-09', 'end': '2026-08', 'months': 24, 'files': 72, 'roles': ['MOV', 'FOR', 'EXC']}}
    manifest['limitations'] = [
        'Dados administrativos de vínculos formais, não de pessoas distintas nem de toda população ocupada.',
        'Salários e soma das remunerações municipais da RAIS referem-se a dezembro2025. Não é massa salarial anual.',
        'Antes do tratamento:60.691.770 vínculos ativos31/12. Nota técnica RAIS2025 seção16 p9 determina segregar720.825 abandonados. Após:59.970.945, igual à Tabela1 nacional. A soma municipal da Tabela4 permanece59.871.633, diferença99.312 não redistribuída. Agregado salarial exploratório em Revisão, não habilitado para índice.',
        'Nota técnica RAIS2025 seção18 p11 registra493 entes públicos com omissão remuneratória,353 deles municipais;116.622 vínculos públicos afetados,44.675 na esfera municipal. Isso limita massa observada e médias, independentemente da diferença entre tabelas.',
        'Nota técnica RAIS2025 seção17 p10 informa ausência de remuneração de dezembro para vínculos militares; não há imputação de remuneração no ETL.',
        'Salários municipais RAIS2024 não foram agregados; esse ano tem vínculos municipais no XLSX e contexto remuneratório não municipal.',
        'Novo Caged municipal de salários:72 arquivos brutos completos, porém tratamento de salário/hora, unidade salarial, exclusões e envios fora do prazo ainda pendente. Não há média salarial municipal pronta.',
        'Médias RAIS de positivos e de informados têm denominadores explícitos; não presumir mesmo tratamento estatístico da remuneração publicada pelo MTE.',
        'Zeros oficiais preservados. Ausência de observação permanece nula. Não Identificado999999 não foi associado a uma cidade.',
        'A nota do Caged explica estoques municipais negativos exibidos como zero e mantidos nos totais. Diferenças históricas de somas registradas sem redistribuição.',
        'RAIS XLSX contém26 combinações município/ano em que os cinco setores não fecham o total. Ambos preservados.',
        'Metadados do portal e data interna do XLSX podem divergir. RAIS2025: corpo menciona Abril2026, portal atualizado17Jun2026. Referência do dado permanece2025.',
        'O sumário de remuneração RAIS chama nominal enquanto corpo chama Real. Contexto XLSX preservado sem redeflacionar; derivado dos microdados usa campo nominal explícito.',
        'Nenhuma integração com interface, nota Agrobar ou modelo de decisão foi realizada nesta aquisição.'
    ]
    manifest['completed_at'] = now()
    manifest['rais_universe_audit'] = {'before_excluding_abandoned': 60691770, 'abandoned_excluded': 720825,
                                       'after_excluding_abandoned': 59970945, 'national_table_1': 59970945,
                                       'municipal_table_4_sum': 59871633, 'municipal_difference': 99312,
                                       'method_version': rais['method_version'],
                                       'source': 'raw/notas/nota-tecnica-rais-2025.zip -> Nota técnica 2025.pdf, seção 16, página 9',
                                       'municipal_reconciliation': rais['active_stock_reconciliation']}
    save(manifest)
    print(json.dumps({'status': manifest['status'], 'coverage': manifest['coverage']}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
