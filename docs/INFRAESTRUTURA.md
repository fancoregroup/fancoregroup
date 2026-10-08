# Infraestrutura dos dashboards

## Estrutura de execução

O site fica em `05-dashboard/demo/site`. As interfaces são HTML, CSS e JavaScript; as funções Node.js ficam em `api/`. `vercel.json` contém rotas e cabeçalhos. O site usa Node.js 24 e as bibliotecas `@neondatabase/serverless` e `@vercel/blob` para o ATS.

Para instalar as dependências do ATS:

```bash
cd 05-dashboard/demo/site
npm ci
```

Para um novo projeto Vercel, configure a raiz como `05-dashboard/demo/site`, framework Other, sem build. As funções e arquivos estáticos usam a estrutura já existente. O projeto de produção permanece independente; nenhuma transferência de hospedagem ou banco foi feita nesta publicação.

## Configuração de ambiente

Configure variáveis no ambiente do servidor, sem colocá-las em commits.

| Variável | Função |
|---|---|
| `AGROBAR_MAP_PASSWORD` | Código de acesso ao mapa e acesso geral de performance |
| `AGROBAR_MAP_SECRET` | Assinatura das sessões |
| `CAMPAIGN_REPORTS_DATA_SECRET` | Chave de leitura do snapshot AES-GCM, mínimo 32 caracteres |
| `CAMPAIGN_REPORTS_DANIEL_PASSWORD` | Código opcional exclusivo de acesso aos dois painéis de performance |
| `CAMPAIGN_REPORTS_SNAPSHOT_PATH` | Caminho de snapshot privado disponível no runtime; quando ausente, usa apenas a fixture cifrada de demonstração |
| `FANCORE_GEO_DATA_PATH` | Caminho do dataset privado de mapas disponível no runtime; quando ausente, usa `mapa-agrobar/demo.json` |
| `ATS_DATABASE_URL` | Conexão Postgres Neon do ATS |
| `ATS_DATABASE_URL_UNPOOLED` | Alternativa para aplicar a migração do ATS |
| `ATS_BLOB_READ_WRITE_TOKEN` | Acesso ao armazenamento privado de currículos |

O modo `--demo` gera em memória um snapshot fictício, define códigos locais e ignora os caminhos de dados privados herdados do ambiente. Não acessa Meta, CRM ou arquivos de credenciais.

A fixture cifrada versionada só pode ser lida com a chave fictícia definida em `tools/campaign_reports/demo.cjs`. Um servidor com chave própria deve receber um novo snapshot gerado para essa chave. Nunca reutilize códigos e chaves de demonstração em um ambiente com dados reais.

## Coleta e snapshots privados

`tools/campaign_reports/collect.py` contém os adaptadores de leitura da Meta, RD Station CRM e ONECRM. `model.py` agrega e concilia os dados; `build.py` atualiza as páginas e chama `seal.cjs` para cifrar os agregados. Os arquivos de credenciais esperados aparecem no código do coletor e ficam em `~/.secrets/fancore/`, com permissão 600. Fontes e saídas ficam em `~/.local/share/fancore/campaign-reports/`.

`seal.cjs` grava por padrão o snapshot nessa pasta privada e rejeita saída dentro deste repositório público. Configure `CAMPAIGN_REPORTS_SNAPSHOT_PATH` para o arquivo privado no servidor. Os sincronizadores de performance e geografia dos leads também atualizam arquivos privados externos ao checkout.

Em Vercel, esses caminhos não apontam para o disco do seu computador. O administrador precisará disponibilizar as fontes privadas no runtime, por exemplo adaptando a API para armazenamento privado, ou manter a produção no repositório privado existente. Este clone é imediatamente executável como demonstração local; não inclui uma nova coleta recorrente nem um deploy dos dados reais.

## Recrutamento e carreiras

O ATS utiliza um banco Neon e um Blob privado para currículos. Use recursos de desenvolvimento separados e aplique o schema somente no banco que deseja configurar:

```bash
node 05-dashboard/recrutamento/migrar.mjs /caminho/privado/ats.env
# Opcional: primeiro administrador; senha provisória vai para arquivo externo, modo 600.
node 05-dashboard/recrutamento/migrar.mjs /caminho/privado/ats.env --admin "Administrador" admin@example.test /caminho/privado/senha.txt
```

Depois execute o projeto no ambiente de funções Vercel, com as variáveis configuradas. O servidor de demonstração `serve.cjs` não emula as operações do ATS.

## Fontes públicas geográficas

Os arquivos em `inteligencia-geografica/dados/` contêm agregados municipais e regionais e seus metadados de origem. Malhas e coordenadas identificam territórios, não endereços internos de lojas. Rede, leads e faturamento exibidos por este clone são fictícios e chegam pela API do mapa.

Licenças e atribuições das fontes e bibliotecas continuam nos dados e assets. Os geradores completos precisam dos arquivos públicos originais e das dependências específicas de cada aquisição; a distribuição inclui as interfaces e os agregados prontos para consulta.
