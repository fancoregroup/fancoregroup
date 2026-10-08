#!/usr/bin/env python3
"""Checador de marca Fancore. Verifica HTML e CSS dos materiais da holding contra o design system
(07-marketing/design-system-fancore.md). Erro derruba o comando; aviso só lista.

Uso: python3 tools/checa_marca.py [arquivos ou pastas]   (padrão: 07-marketing e tools/design_system_template.html)
"""
import re, sys, pathlib

RAIZ = pathlib.Path(__file__).resolve().parent.parent
PADRAO = [RAIZ / '07-marketing', RAIZ / 'tools/design_system_template.html']
PALETA = {'ed6c05', 'ff7a12', '111516', '202526', 'f4f1ee', 'ffffff', 'fff', '545454', 'cccccc', 'ccc', '8f8f8f', 'b5b5b5', '000000', '000'}
FONTES_OK = ('urbane', 'urbanist', 'inter', 'helvetica', 'arial', 'sans-serif', 'system-ui', 'monospace', 'menlo', 'sf mono', 'consolas')

def arquivos(args):
    alvos = [pathlib.Path(a) for a in args] if args else PADRAO
    for a in alvos:
        if a.is_dir():
            yield from sorted(p for p in a.rglob('*') if p.suffix in ('.html', '.css') and 'assets' not in p.parts and not ('canvas' in p.parts and not p.name.endswith('.dc.html')))
        elif a.exists():
            yield a

def checa(path):
    erros, avisos = [], []
    s = path.read_text(encoding='utf-8', errors='ignore')
    # 1. travessão e meia-risca
    for i, l in enumerate(s.split('\n'), 1):
        if '\u2014' in l or '\u2013' in l:
            erros.append((i, 'travessão ou meia-risca'))
    # 2. caixa alta por CSS
    for m in re.finditer(r'text-transform\s*:\s*uppercase', s):
        erros.append((s[:m.start()].count('\n') + 1, 'text-transform: uppercase (o site não usa caixa alta)'))
    # 3. sombra
    for m in re.finditer(r'box-shadow\s*:\s*(?!none)[^;}]+', s):
        erros.append((s[:m.start()].count('\n') + 1, 'box-shadow (profundidade na Fancore vem de gradiente, blur e véu)'))
    # 4. fonte serifada ou fora da lista
    for m in re.finditer(r'font-family\s*:\s*([^;}]+)', s):
        v = m.group(1).lower()
        if v.startswith('var(') or 'inherit' in v:
            continue
        nomes = [n.strip().strip('"\'') for n in v.split(',')]
        ruim = [n for n in nomes if n and not any(ok in n for ok in FONTES_OK)]
        if ruim:
            erros.append((s[:m.start()].count('\n') + 1, f'fonte fora do sistema: {", ".join(ruim)} (Urbane, Urbanist, Inter)'))
    # 5. cores fora da paleta (aviso)
    for m in re.finditer(r'#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b', s):
        h = m.group(1).lower()
        if h not in PALETA:
            avisos.append((s[:m.start()].count('\n') + 1, f'cor fora da paleta #{h}'))
    # 6. botão com raio grande
    for m in re.finditer(r'\.(?:botao|fc-botao)[^{]*\{[^}]*border-radius\s*:\s*(\d+)px', s):
        if int(m.group(1)) > 4:
            erros.append((s[:m.start()].count('\n') + 1, f'botão com raio {m.group(1)}px (padrão 2 px)'))
    # 7. emoji como marcador
    if re.search(r'[\U0001F300-\U0001FAFF]', s):
        avisos.append((0, 'emoji no conteúdo (o sistema não usa emoji como marcador)'))
    return erros, avisos

def main():
    total_erros = 0
    for p in arquivos(sys.argv[1:]):
        erros, avisos = checa(p)
        rel = p.relative_to(RAIZ) if RAIZ in p.parents else p
        vistos = set()
        for lin, msg in avisos:
            if msg in vistos: continue
            vistos.add(msg); print(f'aviso  {rel}:{lin}: {msg}')
        for lin, msg in erros:
            print(f'ERRO   {rel}:{lin}: {msg}')
        total_erros += len(erros)
    if total_erros:
        print(f'FALHOU: {total_erros} erro(s) de marca.'); sys.exit(1)
    print('ok: marca Fancore respeitada.')

if __name__ == '__main__':
    main()
