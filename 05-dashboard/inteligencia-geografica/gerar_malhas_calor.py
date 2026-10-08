"""Dissolve as malhas municipais locais para a leitura progressiva do mapa.

Dependência de geração: shapely>=2. O navegador recebe apenas GeoJSON estático.
Os contornos simplificados servem à visualização, não a cálculo de área.
"""
import hashlib
import json
from collections import defaultdict
from pathlib import Path

from shapely import make_valid
from shapely.geometry import mapping, shape
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[2]
SITE = ROOT / '05-dashboard/demo/site/inteligencia-geografica'


def main():
    source_path = SITE / 'dados/regioes-pib.json'
    source = json.loads(source_path.read_text())
    rows = {r['id']: r for r in source['cities']}
    geometries = {}
    files = sorted((SITE / 'malhas').glob('*.json'))
    for file in files:
        for f in json.loads(file.read_text())['features']:
            geometries[str(f['properties']['codarea'])] = make_valid(shape(f['geometry']))
    manifest = {'source': 'Malhas IBGE locais simplificadas + vínculos regionais da planilha PIB 2023',
                'use': 'Contornos de visualização. Não usar para área, rotas ou influência comercial.',
                'input_sha256': {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in [source_path, *files]}, 'levels': {}}
    for level, expected in [('macro', 5), ('intermediate', 133), ('immediate', 510)]:
        groups = defaultdict(list)
        for row in rows.values():
            groups[str(row[level + 'Id'])].append(row)
        assert len(groups) == expected
        features = []
        for code, members in sorted(groups.items()):
            shapes = [geometries[r['id']] for r in members if r['id'] in geometries]
            assert len(shapes) == len(members), (level, code, 'malha ausente')
            geom = unary_union(shapes)
            if geom.geom_type == 'GeometryCollection':
                geom = unary_union([g for g in geom.geoms if g.geom_type in ('Polygon', 'MultiPolygon')])
            assert geom.is_valid and not geom.is_empty
            features.append({'type': 'Feature', 'properties': {'id': code, 'name': members[0][level], 'uf': '' if level == 'macro' else members[0]['uf'], 'cities': len(members)}, 'geometry': mapping(geom)})
        output = SITE / f'dados/heatmap-{level}.json'
        output.write_text(json.dumps({'type': 'FeatureCollection', 'features': features}, ensure_ascii=False, separators=(',', ':')) + '\n')
        manifest['levels'][level] = {'regions': len(features), 'cities': sum(f['properties']['cities'] for f in features), 'sha256': hashlib.sha256(output.read_bytes()).hexdigest(), 'bytes': output.stat().st_size}
        print(level, manifest['levels'][level])
    (ROOT / '05-dashboard/inteligencia-geografica/malhas-calor-manifesto.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')


if __name__ == '__main__':
    main()
