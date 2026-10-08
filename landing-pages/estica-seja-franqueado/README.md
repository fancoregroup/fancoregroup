# Estica | Seja franqueado

Código completo da [LP publicada](https://estica-seja-franqueado.fancore-9419.chatgpt.site), exportado da versão 1 em 08/10/2026. HTML, CSS, JavaScript, imagens e fontes em `dist/` são idênticos ao commit original `a08ffa73163b95a48a40258efec27f49917d112b`.

## Executar localmente

Na raiz do repositório:

```bash
python3 -m http.server 8850 --bind 127.0.0.1 --directory landing-pages/estica-seja-franqueado/dist
```

Abra http://127.0.0.1:8850/. Não precisa de instalação de dependências, build, chaves ou banco de dados.

## Editar

- `dist/index.html`: textos, seções, links, campos do formulário e aviso de privacidade.
- `dist/styles.css`: identidade visual, layout e responsividade.
- `dist/script.js`: estados, validação, CTAs, formulário final e abertura do WhatsApp.
- `dist/assets/`: logo, fotos e fontes locais.
- `assets-proveniencia.json`: origem e hashes dos assets.
- `ORIGEM.json`: versão exportada e hashes dos arquivos originais.

## Formulário e destino

O formulário prepara uma mensagem para o WhatsApp da expansão `+55 11 94509-3884`. O visitante confirma o envio no WhatsApp. Esta versão não salva leads em servidor, não possui integração RD/CRM e não contém banco de cadastros. Os eventos locais de `dataLayer` não incluem dados pessoais; não há pixel ou tag de analytics instalado.

Para trocar o destino, ajuste o número em `dist/script.js` e no link de alternativa sem JavaScript em `dist/index.html`. O número é o destino provisório da versão em revisão, não uma configuração comercial recém-aprovada.

## Hospedagem e revisão

Em um novo projeto Vercel, use a raiz `landing-pages/estica-seja-franqueado/dist`, framework Other e sem comando de build; a pasta já contém todos os arquivos estáticos. Também pode ser hospedada em outro servidor estático. A configuração do site dos dashboards é independente desta LP.

Esta publicação no GitHub compartilha o código com a equipe; o endereço e as permissões do site original permanecem como estavam. Commits neste repositório não atualizam automaticamente a LP no Sites.

A LP permanece em revisão, com `noindex,nofollow`. Faixas de capital servem à qualificação do interessado e não representam o preço da franquia. Imagens e fontes mantêm sua procedência e não recebem uma nova licença por serem copiadas para o GitHub.
