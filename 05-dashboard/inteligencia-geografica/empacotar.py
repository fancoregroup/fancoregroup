#!/usr/bin/env python3
"""Empacota somente os dados públicos prontos para uso, sem artefatos de inspeção."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parent
out = root / 'exportacoes'
files = [
    'fancore-geo-municipios.xlsx', 'municipios-brasil.csv',
    'indicadores-municipais.csv', 'dicionario-indicadores.csv',
    'estabelecimentos-osm.csv', 'fancore-geo.sqlite',
]
notes = '''Fancore Geo | Base municipal pública

Excel: Territorio, Renda e idade, Economia, Fontes e leitura.
CSV municipal: um registro por código IBGE.
CSV de indicadores: observações, anos, unidades e fontes.
CSV OSM: estabelecimentos mapeados nos recortes coletados.
SQLite: base para análise e integração própria.
Manifesto: consultas, datas, cobertura e hashes de origem.

Cada indicador possui ano próprio. Célula vazia não significa zero.
Os recortes OSM não são um censo de estabelecimentos. Coordenadas municipais
não representam endereços de lojas. A base não contém dados de faturamento,
fluxo de pessoas, status operacional da rede ou previsão de vendas.

Fontes: IBGE, OpenStreetMap e Municípios Brasileiros (coordenadas).
OpenStreetMap: https://www.openstreetmap.org/copyright
Coordenadas (MIT): https://github.com/kelvins/municipios-brasileiros
'''
target = out / 'fancore-geo-bases.zip'
with ZipFile(target, 'w', ZIP_DEFLATED, compresslevel=6) as archive:
    for name in files:
        archive.write(out / name, name)
    archive.write(root / 'manifesto.json', 'manifesto.json')
    archive.writestr('LEIA-ME.txt', notes)
with ZipFile(target) as archive:
    assert archive.testzip() is None
    assert len(archive.namelist()) == len(files) + 2
print(f'{target.name}: {target.stat().st_size:,} bytes, 8 arquivos conferidos.')
