# Dashboards Fancore

Código dos dashboards Fancore para o Daniel e a equipe desenvolverem, revisarem e evoluírem. Este repositório público contém uma versão executável de demonstração, com campanhas, CRM, unidades e ranking financeiro fictícios. Os indicadores municipais agregados preservam as fontes públicas originais.

## Consultar o dashboard atual

- [Performance Estica](https://fancore-dashboard-marketing.vercel.app/performance/estica/)
- [Performance Agrobar](https://fancore-dashboard-marketing.vercel.app/performance/agrobar/)
- [Dashboard principal](https://fancore-dashboard-marketing.vercel.app/)
- [Inteligência geográfica](https://fancore-dashboard-marketing.vercel.app/inteligencia-geografica/)
- [Mapa Agrobar](https://fancore-dashboard-marketing.vercel.app/mapa-agrobar/)
- [Campanhas de setembro](https://fancore-dashboard-marketing.vercel.app/campanhas-setembro-2026/)
- [Recrutamento](https://fancore-dashboard-marketing.vercel.app/recrutamento/)
- [Página de carreiras](https://fancore-dashboard-marketing.vercel.app/carreiras/)

Os módulos internos exigem suas credenciais próprias. O acesso concedido ao Daniel para Estica e Agrobar continua no ambiente de produção. A publicação deste código não muda as permissões dos demais módulos.

## Executar a demonstração

Requer Node.js 24. Os painéis de marketing e mapas não precisam de banco ou chaves de provedores para a demonstração.

```bash
git clone https://github.com/fancoregroup/fancoregroup.git
cd fancoregroup
node tools/campaign_reports/serve.cjs --demo
```

Abra http://127.0.0.1:8844/. Para performance Estica/Agrobar, use o código fictício `local-daniel` ou `local-preview`. Para geografia e mapa, use `local-preview`. Esses códigos só servem na demonstração local.

O servidor local atende as APIs de performance e mapa. As interfaces de recrutamento e carreiras estão incluídas, mas as operações do ATS precisam de Postgres, Blob e execução das funções Vercel. Veja [infraestrutura](docs/INFRAESTRUTURA.md).

## Onde editar

| Módulo | Arquivos principais |
|---|---|
| Dashboard principal e máquina de receita | `05-dashboard/demo/site/index.html`, `revenue-engine.js`, `revenue-ui.js`, `app.js` |
| Performance Estica e Agrobar | `05-dashboard/demo/site/performance/`, `api/campaign-reports.js` |
| Coleta, agregação e autenticação de performance | `tools/campaign_reports/` |
| Campanhas CSV | `05-dashboard/analises/campanhas-setembro-2026/` |
| Inteligência geográfica | `05-dashboard/demo/site/inteligencia-geografica/` |
| Mapas e rede de unidades | `05-dashboard/demo/site/mapa-agrobar/`, `api/mapa-agrobar.js` |
| Coleta e transformação de indicadores públicos | `05-dashboard/inteligencia-geografica/` |
| Recrutamento e carreiras | `05-dashboard/demo/site/recrutamento/`, `carreiras/`, `api/_ats/` |
| Banco e migração do ATS | `05-dashboard/recrutamento/schema.sql`, `migrar.mjs` |
| Configuração de deploy | `05-dashboard/demo/site/vercel.json`, `package.json`, `package-lock.json` |
| Verificações automáticas | `.github/workflows/dashboards.yml` |

## Colaborar

Crie uma branch, faça as mudanças e abra um pull request. Quem administra a conta `fancoregroup` pode conceder acesso de escrita ao GitHub pessoal do Daniel. O código pode ser clonado imediatamente por estar público.

```bash
git switch -c melhoria-dashboard
# editar e verificar
git add <arquivos>
git commit -m "Melhora o dashboard"
git push origin melhoria-dashboard
```

```bash
python3 -m unittest discover -s tools/campaign_reports -p 'test_*.py' -v
node --test tools/campaign_reports/test_auth.cjs tools/campaign_reports/test_demo.cjs
```

## Dados e origem

Base de código: snapshot de 08/10/2026. O histórico do repositório de produção não foi copiado. As interfaces, APIs, coletores e configuração de infraestrutura estão incluídos. Credenciais, exportações CRM, currículos, transcrições, capturas internas e datasets reais de campanhas, unidades e faturamento não acompanham esta distribuição, mesmo cifrados.

Os geradores geográficos de coleta completa dependem de arquivos de fontes baixados separadamente. Os JSON e as planilhas agregadas de IBGE, Receita Federal, Senatran e OpenStreetMap necessários à interface estão incluídos; suas datas e limitações constam nos próprios dados. Os índices exploratórios são modelos em revisão, não previsões de faturamento.

Os commits aqui não atualizam automaticamente o dashboard atual. O administrador poderá conectar um ambiente próprio ou organizar a integração com a produção após revisar as alterações. Detalhes e variáveis em [infraestrutura](docs/INFRAESTRUTURA.md).
