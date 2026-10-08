#!/usr/bin/env python3
"""Casos independentes de CNAE, universo e ausência no agregador real."""
import csv
import io
from agregar_rais_2025 import Aggregator, FIELDS, VALUES, METHOD_VERSION


def run(cnae, active='1', abandoned='0', wage='100.00'):
    values = {'municipio_mte': '410690', 'ativo': active, 'abandonado': abandoned,
              'cnae_classe': cnae, 'remuneracao_dezembro': wage}
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(FIELDS)
    writer.writerow([values[FIELDS[key]] for key in FIELDS])
    data = buffer.getvalue().encode('latin1')
    parser = Aggregator()
    parser.write(data)
    parser.close()
    return parser


def main():
    cases = [(' 41204', 'construcao'), (' 69125', 'servicos'), ('01113', 'agropecuaria'),
             ('47113', 'comercio'), ('10112', 'industria'), ('99008', 'servicos'),
             ('99999', 'nao_classificado'), ('', 'nao_classificado'), (' 99999 ', 'nao_classificado')]
    for value, expected in cases:
        parser = run(value)
        assert list(parser.groups) == [('410690', expected)], (value, parser.groups)
        assert parser.groups[('410690', expected)][VALUES.index('vinculos_ativos')] == 1
    assert not run('47113', abandoned='1').groups
    assert run('47113', abandoned='1').abandoned_active == 1
    assert not run('47113', active='0').groups
    missing = run('47113', wage='').groups[('410690', 'comercio')]
    zero = run('47113', wage='0.00').groups[('410690', 'comercio')]
    assert missing[VALUES.index('remuneracao_dezembro_ausente_n')] == 1
    assert missing[VALUES.index('remuneracao_dezembro_zero_n')] == 0
    assert zero[VALUES.index('remuneracao_dezembro_ausente_n')] == 0
    assert zero[VALUES.index('remuneracao_dezembro_zero_n')] == 1
    assert zero[VALUES.index('remuneracao_dezembro_informada_n')] == 1
    print(f'Método v{METHOD_VERSION}: 9 classificações CNAE, 3 verificações de universo e 5 de ausência/zero passaram.')


if __name__ == '__main__':
    main()
