# Desempenho do PDV, das listas e do catálogo

Implementação da issue #72. A base de comparação é `75d509895c39f5a2c357fe781bf74b7a68a33119`.

## Contratos

- Produtos e clientes são consultados no servidor em páginas de 50, com ordenação por nome e ID. O histórico de estoque e os recebíveis também substituem a página visível, sem acumular todas as páginas no DOM.
- O PDV online recebe uma projeção de produto sem custo, descrição, imagem, categoria ou datas. Busca digitada tem debounce; Enter e câmera consultam o código exato. Caixa e avulso relacionados acompanham o resultado, preservando a abertura e o carrinho misto.
- F4 mostra no máximo 50 clientes. Os seletores de produto, avulso e cliente fazem busca remota. As opções de clientes não consultam contagens de vendas; na lista administrativa, as contagens são restritas aos IDs da página.
- O servidor continua autorizando consultas e mutações. Custos administrativos não são enviados a SELLER. A venda confirma o saldo no servidor; a atualização local após o recibo não substitui essa guarda.
- As mutações usam `revalidatePath`; foram removidas as chamadas redundantes a `router.refresh` nos respectivos formulários. Listas com filtros locais recarregam sua própria consulta quando necessário. O menu administrativo não antecipa consultas das outras páginas após uma mutação. A atualização manual de impedimentos, sem mutação confirmada, continua disponível.
- A vitrine pública usa cache de dados por 60 segundos. Produtos, categorias, configurações, estoque, abertura de caixas, vendas online, vendas offline aplicadas e aprovação de conflitos invalidam a tag imediatamente. Erros de consulta ficam fora do cache. O proxy deixa de executar no catálogo e em ícones/vendor; a autorização das páginas administrativas continua no servidor.
- A leitura de configurações é deduplicada por renderização com `React.cache`. Leituras feitas dentro de transações de venda continuam usando o cliente da transação. A verificação de caixa aberto para PDV/recebíveis seleciona apenas seu ID.

## Cópia offline

As assinaturas do IndexedDB separam produtos, clientes, operações e chaves de metadados. Alterar uma operação não refaz as leituras integrais de produtos/clientes. Metadados iguais não são regravados. O catálogo é ordenado com um `Intl.Collator` compartilhado; atualizar reservas não repete a ordenação.

A estrutura local sobe para a versão 4, adicionando o índice `operations.seq` e preservando fila e rascunhos. Registrar uma venda lê apenas os produtos do carrinho e obtém a última sequência pelo índice. O timeout de envio parte de 30 segundos e cresce 3 segundos por operação adicional, limitado a 180 segundos; a idempotência continua cobrindo respostas perdidas.

A retenção continua conservadora: operações sincronizadas/refletidas ou descartadas podem ser limpas após 24 horas. Conflitos aprovados/descartados assumem esses estados pelo fluxo existente. Uma rejeição sem registro no servidor não prova resolução e não autoriza apagar uma venda local.

O cursor SQL usa comparação de `(syncVersion, id)`, com parâmetros vinculados e limite de transações seguro. A primeira carga omite exclusões antigas. O cursor leva um limite opcional de início da carga para continuar entregando exclusões que ocorram entre suas páginas. Cursores anteriores permanecem aceitos.

## Banco e ambientes

`0014_performance_indexes` é aditiva: índices de vendas por caixa/cliente, itens por venda/produto, movimentos de caixa, recebimentos, histórico de estoque e status de recebíveis. Essa parte atende à dependência de índices da #68; as mudanças de datas/fuso e a aplicação em produção da #68 continuam separadas.

Somente a conexão de execução com hostname contendo `-pooler.` recebe os padrões `pgbouncer=true`, `connection_limit=5` e `pool_timeout=10`. Valores explícitos são preservados. URLs diretas/locais e `DIRECT_URL` de migrations não são alteradas. Parâmetros referenciados na [documentação do conector PostgreSQL do Prisma 6](https://docs.prisma.io/docs/orm/v6/overview/databases/postgresql).

O projeto mantém seu Prisma 6 e o cliente atual. A troca pelo adapter Neon exige comparação no ambiente Neon alvo para justificar alteração de dependências e conexão; o teste local não demonstra ganho de cold start na nuvem. `pg_trgm` também não foi instalado: esta carga contém 10 mil produtos, abaixo do cenário de mais de 50 mil produtos previsto para sua avaliação na issue.

As migrations desta validação são aplicadas exclusivamente a bancos descartáveis. A publicação da alteração não executa migrations nem altera produção.

## Medições reproduzíveis

Os scripts exigem URL local e banco com `test` no nome. `performance-seed.mjs` recusa banco já populado. A carga tem 10.000 produtos, 50.000 clientes, 100.000 vendas e 100.000 itens. O navegador usa Chromium com viewport/user agent de Pixel 7; não representa um telefone físico.

```powershell
$env:TEST_DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:55452/gestao_lojas_performance_test'
$env:DATABASE_URL = $env:TEST_DATABASE_URL
$env:DIRECT_URL = $env:TEST_DATABASE_URL
pnpm db:deploy
node scripts/performance-seed.mjs
pnpm build

# Em um terminal separado, contra o mesmo banco fictício:
$env:AUTH_SECRET = 'e2e-segredo-local-de-teste-nao-usar-em-producao'
$env:AUTH_TRUST_HOST = 'true'
$env:RECAPTCHA_SECRET_KEY = 'e2e-chave-ficticia'
$env:NODE_OPTIONS = '--import=./tests/e2e/support/mock-siteverify.mjs'
pnpm start --hostname 127.0.0.1 --port 3202

# No terminal de medições:
$env:PERFORMANCE_OUTPUT = "$env:TEMP/gestao-lojas-performance.json"
$env:PERFORMANCE_CHECK = 'true'
node scripts/performance-browser.mjs
$env:PERFORMANCE_OUTPUT = "$env:TEMP/gestao-lojas-cursor.json"
node scripts/performance-cursor.mjs
```

O PostgreSQL de teste deve iniciar com `shared_preload_libraries=pg_stat_statements` e `pg_stat_statements.track=all`. O script mede bytes do HTML completo, incluindo os dados RSC de hidratação, tempo de resposta e chamadas ao banco daquela base. Testa o orçamento de 300 KB do PDV, o limite de clientes, a segunda leitura pública sem consultas e a ausência de releitura integral de produtos/clientes ao gravar uma venda offline. Depois registra mais quatro vendas pela interface e mede o envio do lote de cinco ao reconectar, com a busca de produtos em uso.

### Antes

| Rota                       | Bytes HTML + hidratação | Tempo local | Chamadas ao banco |
| -------------------------- | ----------------------: | ----------: | ----------------: |
| PDV                        |              20.963.218 |    7.432 ms |                14 |
| Produtos                   |              78.581.412 |   27.916 ms |                 6 |
| Clientes                   |             266.637.398 |  138.277 ms |                 8 |
| Estoque                    |               8.635.769 |    9.808 ms |                13 |
| Catálogo, primeira leitura |                 167.739 |    2.107 ms |                 4 |
| Catálogo, segunda leitura  |                 167.739 |    1.275 ms |                 5 |

F4: 50.000 clientes renderizados, além dos botões de consumidor final e fechar. Os tempos são amostras locais, sujeitos à carga da máquina; bytes, quantidade de itens e consultas são as evidências principais.

O `EXPLAIN (ANALYZE, BUFFERS)` perto do fim do cursor demonstrou a diferença de acesso ao índice: produtos passaram de 104 para 9 blocos acessados; clientes, de 482 para 9. A consulta com OR descartou respectivamente 9.001 e 45.001 linhas, enquanto a comparação por tupla utilizou diretamente a condição do índice existente.

### Validação da versão otimizada

Medição com a mesma carga sintética, PostgreSQL 17 local e build de produção. O orçamento definido para o HTML com RSC de hidratação do PDV é **300.000 bytes**.

| Rota                       | Bytes HTML + hidratação | Tempo local | Chamadas ao banco |
| -------------------------- | ----------------------: | ----------: | ----------------: |
| PDV                        |                  71.181 |      322 ms |                 6 |
| Produtos                   |                 453.794 |      124 ms |                 6 |
| Clientes                   |                 316.937 |       83 ms |                 5 |
| Estoque                    |                 114.742 |       85 ms |                12 |
| Catálogo, primeira leitura |                 166.680 |       56 ms |                 4 |
| Catálogo, segunda leitura  |                 167.370 |       20 ms |                 0 |

O PDV reduziu os bytes em **99,66%**. Produtos e Clientes renderizaram 50 registros por página; o F4 renderizou 50 clientes (52 botões ao contar consumidor final e fechar). Os tempos não são uma promessa para Neon ou hardware real: as amostras ocorreram em momentos diferentes de carga do computador, sem throttling de CPU. Bytes, limites de linhas e chamadas ao banco são as comparações principais.

No Pixel 7 emulado, uma venda offline levou **423 ms** da busca ao recibo e não releu integralmente produtos nem clientes. O lote de **cinco vendas** sincronizou em **943 ms**, com uma releitura de produtos para refletir o novo saldo e nenhuma de clientes. O observador de `longtask` não registrou tarefas de 50 ms ou mais durante a venda nem durante esse envio; `maxLongTaskMs: 0` significa ausência desses eventos, não execução instantânea.

Evidências brutas: [antes](performance/issue-72-before.json), [depois](performance/issue-72-after.json) e [planos SQL](performance/issue-72-cursor.json). São dados fictícios locais. O script de volume exige um banco diferente do usado na suíte de integração/navegador, pois a suíte limpa seu banco entre os cenários.

### Verificações executadas

- `pnpm lint` e ESLint direcionado nos últimos arquivos alterados: sem erros.
- `pnpm build`: compilação, TypeScript e geração de páginas aprovados.
- `pnpm check:actions`: 63 Server Actions e cinco Route Handlers offline com autorização.
- `pnpm test:unit --maxWorkers=1 --testTimeout=30000`: 116 testes aprovados. Execução serial evita concorrência de recursos no computador de validação.
- `pnpm test:integration`: 181 testes aprovados, com PostgreSQL descartável e schema conferido após aplicar as migrations.
- `pnpm test:e2e:run --project=chromium --project=android`: 92 cenários exercitados. A rodada completa aprovou 90 e apontou duas ocorrências do mesmo seletor ambíguo (notificação e histórico de remoção com o mesmo texto). Após delimitar o seletor à notificação, o recorte `--grep 'ADMIN remove|gerente vincula|PDV limita|listas buscam|preço público'` aprovou os dez testes, incluindo as duas ocorrências. Os 92 cenários estão cobertos entre as rodadas.
- `PERFORMANCE_CHECK=true node scripts/performance-browser.mjs`: orçamento de bytes, paginação, F4, cache e releituras offline aprovados na base de volume.
- `git diff --check`: sem erros de espaços.

Os cenários de navegador incluem carrinho misto, abertura mínima, desistência, resposta perdida, migração do IndexedDB com fila pendente, restauração do carrinho, troca de usuário, estoque concorrente, falha de armazenamento e sincronização intermitente. O Edge instalado não foi executado nesta validação.
