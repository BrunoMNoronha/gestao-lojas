# Operação offline — decisões de negócio e arquitetura

Documento da etapa 1 de 7 da operação offline (issue #34, épico #33). Registra as regras de negócio e
as escolhas técnicas que as etapas seguintes (#35 a #40) devem seguir. **Não há código de produção
nesta etapa.**

Decisões aprovadas pelo responsável (Bruno M. Noronha) em 03/10/2026, que aceitou as recomendações do
levantamento da #34. Base conferida: `main` em `eab97bc`, Next.js 16.3.8.

> Regras de ouro
>
> - Uma venda feita offline já aconteceu: a sincronização **nunca** recalcula, descarta ou duplica uma
>   venda em silêncio. O que não puder ser aplicado vira conflito visível e auditável.
> - O servidor continua sendo a autoridade: o cache do aparelho não é autorização, e o relógio do
>   aparelho não decide permissões nem validade.
> - Cada operação produz **um único** conjunto de efeitos (venda, itens, estoque, caixa), garantido
>   por unicidade no banco na mesma transação dos efeitos.
> - O aparelho guarda só o mínimo necessário ao PDV.

## 1. Situação atual (o que muda com o offline)

| Ponto                      | Hoje                                                                                                               | Consequência para o offline                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Tela do PDV                | `src/app/admin/pdv/page.tsx` usa `connection()` e recebe produtos e clientes do servidor a cada acesso             | Não existe tela que abra sem rede; o layout `/admin` também consulta o banco                |
| Venda (`createSale`)       | Cliente envia só produto e quantidade; o servidor recalcula o preço a partir de `salePrice`                        | A venda offline precisa levar o preço praticado                                             |
| Estoque                    | Baixa com `currentStock >= quantidade`; se faltar saldo, a venda inteira é recusada. Estoque negativo é impossível | Dois terminais podem vender o mesmo saldo                                                   |
| Caixa                      | A venda vai para o caixa **aberto** do operador no momento do envio; o fechamento grava um resumo imutável         | Uma venda que chega depois do fechamento iria para o caixa errado                           |
| Data da venda              | `Sale.createdAt` é gravado pelo servidor e usado em relatórios, dashboard e vencimento do fiado                    | Uma venda sincronizada no dia seguinte cairia no dia errado                                 |
| Identificação              | `Sale.code` é uma sequência (`SERIAL`) **sem** índice único; não há chave de operação                              | Não há como deduplicar um reenvio                                                           |
| Exclusões                  | `Product`, `Customer`, `Category` (e `Supplier`) são excluídos fisicamente                                         | Um aparelho desconectado nunca fica sabendo da exclusão (exclusão lógica na #36, seção 3.7) |
| Datas de alteração         | `Category` não tem `createdAt`/`updatedAt`; `Sale`, `CashRegister` e outros não têm `updatedAt`                    | Falta cursor para sincronização incremental (resolvido na #36 com `syncVersion`, seção 5)   |
| Cancelamento               | Não existe estorno/cancelamento de venda                                                                           | A conciliação não pode "desfazer" uma venda; trabalha com aprovação, descarte ou ajuste     |
| Sessão                     | JWT do Auth.js, validade padrão (30 dias); `authorize()` confere usuário ativo e perfil no banco a cada chamada    | O login exige internet (reCAPTCHA no servidor)                                              |
| Fuso                       | Servidor usa `America/Sao_Paulo` (`src/lib/store-time.ts`); recibo e `src/lib/dates.ts` usam o fuso do navegador   | O recibo offline deve usar o fuso da loja                                                   |
| Service Worker / IndexedDB | Não existem. `localStorage` só no carrinho do catálogo público (`src/lib/catalog-cart.ts`)                         | Toda a infraestrutura é nova                                                                |
| Testes                     | Integração com vitest e PostgreSQL descartável (`pnpm test:integration`, #35); navegador ainda não                 | Navegador (#39) monta o Playwright                                                          |

Já corrigido durante o levantamento: o preço de custo deixou de ser enviado a quem não tem
`catalog.manage` (#41), e o PDV passou a tratar falha ao finalizar a venda (#42).

## 2. Matriz de cobertura

Legenda: **Sim** = disponível offline · **Não** = exige conexão · **Expansão** = avaliar na #40.

| Módulo                           | Consulta                                              | Criação                                    | Edição | Exclusão | Entrega              |
| -------------------------------- | ----------------------------------------------------- | ------------------------------------------ | ------ | -------- | -------------------- |
| PDV (carrinho e venda)           | Sim                                                   | Sim — venda local pendente                 | Não    | Não      | **Primeira (PDV)**   |
| Produtos (dados para o PDV)      | Sim — cópia mínima, com idade dos dados               | Não                                        | Não    | Não      | **Primeira (PDV)**   |
| Categorias                       | Sim — só para filtrar no PDV                          | Não                                        | Não    | Não      | **Primeira (PDV)**   |
| Clientes                         | Sim — nome e documento mascarado (3.8)                | Não                                        | Não    | Não      | **Primeira (PDV)**   |
| Configurações da loja            | Sim — só os dados do recibo                           | —                                          | Não    | —        | **Primeira (PDV)**   |
| Caixa                            | Sim — o turno preparado (abertura e valor inicial)    | Não (abertura, sangria, suprimento)        | Não    | —        | Primeira: só leitura |
| Fechamento de caixa              | —                                                     | Não — bloqueado com pendências no aparelho | —      | —        | Primeira (3.3)       |
| Estoque                          | No PDV: saldo sincronizado menos pendentes            | Não (entrada, ajuste)                      | Não    | —        | Expansão             |
| Contas a receber / fiado         | Não                                                   | Não — fiado bloqueado offline (3.4)        | Não    | —        | Expansão             |
| Fornecedores                     | Não                                                   | Não                                        | Não    | Não      | Expansão             |
| Dashboard e relatórios           | Não                                                   | —                                          | —      | —        | Expansão             |
| Usuários, perfis e configurações | Não                                                   | Não                                        | Não    | Não      | Sempre online        |
| Login e troca de senha           | —                                                     | Não                                        | —      | —        | Sempre online        |
| Catálogo público / WhatsApp      | Fora deste trabalho (carrinho em `localStorage`, #17) | —                                          | —      | —        | Avaliar à parte      |

Critério de expansão (#40): um módulo só ganha escrita offline depois de ter política de conflito
registrada aqui, chave de operação idempotente no servidor e testes dos cenários de concorrência.

## 3. Decisões de negócio

### 3.1 Preço alterado no servidor depois da venda offline

- **Vale o preço praticado offline.** A sincronização nunca recalcula uma venda já feita.
- O servidor aceita o preço enviado somente se ele foi um preço válido do produto **no período da
  preparação** (ver 3.5). Para isso, as alterações de `salePrice` passam a ser registradas em um
  histórico de preços. Preço que nunca existiu no período vira **conflito** (proteção contra cliente
  adulterado).
- Histórico (#36): tabela `ProductPrice` (`productId`, `salePrice`, `validFrom` em UTC), gravada por
  gatilho no banco no cadastro e a cada mudança de `salePrice`, por qualquer caminho. O preço vigente
  num instante é o da linha mais recente com `validFrom` anterior ou igual a ele. Os produtos que já
  existiam recebem o preço atual com `validFrom` na data da migration (não há histórico anterior).
- Diferença entre o preço praticado e o preço atual é gravada na venda para auditoria
  (pendência informativa, sem bloquear).
- Implementado na #38 (`src/lib/offline-sale.ts`): o período vai de `issuedAt` da autorização
  **menos 15 minutos** até `min(expiresAt, recebimento)`, e vale o preço vigente no início dele e
  todo preço que começou dentro dele. A tolerância cobre uma borda da carga completa: o histórico
  grava o início da transação que mudou o preço, e uma alteração iniciada pouco antes da emissão e
  confirmada depois da leitura deixa no aparelho o preço anterior. Pendência: `PRICE_DIVERGENCE`.
- Vendas online continuam com o preço calculado no servidor, como hoje.

### 3.2 Estoque insuficiente ao sincronizar / dois terminais vendendo o mesmo saldo

- O aparelho desconta localmente as quantidades das vendas pendentes e **não deixa vender além do
  saldo local**.
- Na sincronização, se o saldo do servidor não cobrir a venda, **a venda é aceita** e o estoque pode
  ficar negativo. Isso vale **apenas** para operações vindas da sincronização offline; venda online
  mantém a regra atual (sem saldo, sem venda).
- Estoque negativo gera **pendência de conciliação** para quem tem `stock.manage`, resolvida com
  ajuste de estoque ou ciência registrada. A tela de estoque destaca saldos negativos.
- Implementado na #38, parte 2 (`reservedQuantities` em `src/lib/offline/sale-operation.ts`): a
  reserva vale para toda venda da fila que a cópia ainda não mostra, **inclusive em conflito ou
  recusada** (a mercadoria já saiu; decisão do responsável em 04/10/2026). Deixam de reservar a
  venda descartada por um gerente e a sincronizada cujo `appliedTxid` está abaixo do `watermark`
  da última sincronização completa da cópia.

### 3.3 Venda que chega depois do fechamento do caixa original

- A venda é vinculada ao **caixa original** (o do turno preparado), nunca ao caixa aberto no momento
  do envio. A sincronização trava o caixa pelo id original.
- O resumo gravado no fechamento (`expectedAmount`, `countedAmount`, `difference`) **não é
  alterado**.
- O detalhe do caixa mostra, separado do resumo, o **ajuste pós-fechamento**: vendas daquele caixa
  lançadas depois do fechamento (total e parte em dinheiro). Não precisa de campo novo.
- Implementado na #38, parte 3: a venda pós-fechamento é a que tem a pendência `POST_CLOSING_SALE`,
  gravada na mesma transação quando a venda é aplicada (sincronizada ou aprovada) com o caixa já
  fechado. A data de recebimento não serve de critério: a venda aprovada guarda a data do envio,
  que pode ser anterior ao fechamento. O resumo do caixa (`computeCashSummary`) deixa essas vendas
  de fora, e o detalhe as lista à parte, com a data em que foram lançadas.
- O aparelho **bloqueia o fechamento do caixa** enquanto houver vendas pendentes dele. No servidor, o
  fechamento mostra um aviso quando algum aparelho preparado para aquele caixa ainda não sincronizou.
- Implementado na #38, parte 2: o banco comum do navegador guarda, por operador, as vendas ainda não
  gravadas no servidor por caixa; o "Fechar Caixa" do painel lê esse número e fica bloqueado,
  com atalho para o `/pdv`. Só enxerga o navegador em que está aberto.
- Implementado na #38, parte 3 (migration `0010_offline_reconciliation`): o `/pdv` com conexão
  informa ao servidor, a cada envio da fila (no máximo a cada 2 min com o mesmo conteúdo), quantas
  vendas de cada autorização ainda não chegaram (`POST /api/offline/report`, colunas
  `OfflineGrant.pendingCount` e `pendingReportedAt`). O "Fechar Caixa" mostra um **aviso**, sem
  bloquear, para cada aparelho não revogado preparado para o caixa que nunca informou, tinha
  vendas no último informe ou está **sem contato há mais de 10 minutos**. O servidor não tem como
  saber das vendas de um aparelho sem internet: o "sem contato" é o sinal de risco. Um aparelho
  que só fechou o `/pdv` também aparece assim; o texto diz que ele "pode ter" vendas.

### 3.4 Fiado e formas de pagamento offline

- Permitidos offline: **dinheiro, PIX, cartão de crédito e cartão de débito**, registrados como
  declarados pelo operador (como já acontece online; o sistema não comprova PIX nem cartão e não
  integra com adquirente).
- **Fiado (`ON_ACCOUNT`) bloqueado offline** na primeira entrega: limite de crédito e bloqueio de
  vencidos (#29) não podem ser verificados sem o servidor.
- Recebimentos de contas a receber continuam só online.

### 3.5 Validade offline, dispositivos e revogação

- **Preparação:** feita online pelo operador, com o caixa aberto. Gera uma **autorização offline**
  registrada no servidor (usuário, aparelho, caixa, emitida em, expira em).
- **Duração máxima:** 12 horas a partir da emissão (um turno). Renovar exige estar online e
  sincroniza os dados.
- **Defasagem dos dados:** no máximo 24 horas. Acima disso o PDV offline não abre para venda; a
  idade dos dados fica sempre visível.
- O aparelho usa o próprio relógio só para avisar e bloquear localmente. Quem decide é o servidor, com
  os instantes que ele mesmo emitiu (ver 3.6).
- **Navegadores suportados:** Chrome e Edge nas duas últimas versões principais, em computador e
  Android. Safari/iOS **não suportado** (o navegador pode apagar os dados guardados); funciona como
  melhor esforço, sem garantia nem testes de aceite.
- **Revogação:** se o usuário for desativado, perder a permissão `pdv.use` ou o aparelho for revogado
  durante a desconexão, as vendas dele **viram conflito** para aprovação de um gerente. Nunca são
  aplicadas automaticamente nem descartadas.
- **Autorização vencida na hora do envio não é conflito** (decisão do responsável em 04/10/2026,
  #38): quem vende às 11 h e só reconecta às 13 h é o uso normal. A data da venda já fica limitada à
  validade (3.6). Conflito por autorização só quando ela não existe ou não corresponde ao operador,
  ao aparelho ou ao caixa da venda, ou quando o aparelho foi revogado.
- Usuário desativado ou sem sessão não consegue enviar (o `authorize` responde 401): as vendas ficam
  guardadas no aparelho. O envio delas por um gerente, chegando como conflito com a autoria
  original (fluxo assistido, seção 5), é da terceira parte da #38.
- Implementado na #38, parte 3: no `/pdv`, quem tem `offline.reconcile` vê "de outros operadores"
  quando o navegador guarda vendas de outro usuário (que saiu, foi desativado ou perdeu o acesso)
  e as envia para conferência. O servidor aceita a operação de outro operador só de quem tem
  `offline.reconcile` e **nunca a aplica**: ela é sempre conflito, com o motivo encontrado na
  avaliação ou `ASSISTED_SUBMISSION` se não houver outro, com a autoria original e quem enviou
  (`SyncOperation.submittedById`). Aprovar grava a venda com o operador e o caixa originais.
- Revogação pela tela "Sincronização offline" (aba Aparelhos), com quem revogou e quando. Não há
  como desfazer pela tela.

### 3.6 Qual data vale para relatórios, caixa e vencimento

- A venda passa a ter duas datas: **quando aconteceu** (`occurredAt`, informada pelo aparelho) e
  **quando chegou** (`createdAt`, do servidor, como hoje).
- `occurredAt` é limitada pelo servidor ao intervalo entre
  `max(abertura do caixa, emissão da autorização)` e `min(expiração da autorização, recebimento)`.
  Valor fora do intervalo é ajustado ao limite, e o valor original fica registrado como pendência
  informativa ("data ajustada").
- **Relatórios, dashboard e vencimento do fiado** passam a usar `occurredAt`. Vendas online gravam
  `occurredAt = createdAt`.
- **Caixa:** vale o caixa original (3.3), independentemente da data.

### 3.7 Exclusões de produtos, clientes e categorias

- **Exclusão lógica** em `Product`, `Customer` e `Category`: a ação "excluir" passa a marcar
  `deletedAt` e o registro some das listagens. A exclusão física deixa de ser usada para eles.
- A sincronização envia as exclusões ao aparelho; vendas pendentes de um produto excluído continuam
  válidas (a venda aconteceu).
- `Category` ganha `createdAt` e `updatedAt`, necessários ao cursor de sincronização.
- Unicidade de SKU, código de barras, documento e nome de categoria passa a valer **só entre
  registros ativos**: índices únicos parciais (`WHERE "deletedAt" IS NULL`) criados em SQL na
  migration `0007_offline_local_copy`. O Prisma 6 não declara índice parcial no schema, mas também o
  ignora ao comparar (`prisma migrate diff` fica vazio), então nenhuma migration futura tenta
  removê-lo. Por isso o schema não tem mais `@unique` nesses campos, e as checagens de duplicidade
  nas actions filtram `deletedAt: null`.
- **Regras de exclusão** (aprovadas na #36):
  - Produto: pode ser excluído mesmo com vendas, movimentações ou saldo (antes, a chave estrangeira
    impedia). O histórico de vendas e de estoque continua com o nome do produto.
  - Cliente: vendas antigas não impedem mais a exclusão; título do Fiado em aberto (`OPEN` ou
    `PARTIAL`) impede.
  - Categoria: só produtos **ativos** impedem a exclusão e entram na contagem.
  - Registro excluído não pode ser editado nem usado em venda online, entrada ou ajuste de estoque,
    e some do catálogo público. Não há restauração pela interface.
- `Supplier` fica como está (fora do PDV).

### 3.8 Campos gravados no aparelho

Iguais para todos os perfis (a cópia local serve só ao PDV):

| Origem                | Campos guardados                                                                        | Nunca guardados                                   |
| --------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Produto               | id, nome, SKU, código de barras, preço de venda, unidade, saldo, categoria, `updatedAt` | preço de custo, estoque mínimo, descrição, imagem |
| Categoria             | id, nome                                                                                | —                                                 |
| Cliente               | id, nome, documento **mascarado** (ex.: `***.456.789-**`)                               | documento completo, telefone, e-mail, endereço    |
| Configurações da loja | nome, documento, endereço e telefone **da loja** (recibo)                               | parâmetros do fiado e demais configurações        |
| Caixa                 | id, abertura, valor inicial                                                             | movimentos e resumos de outros caixas             |
| Usuário               | id, nome, perfil                                                                        | senha, hash de senha, token de sessão             |

O recibo offline imprime o documento do cliente mascarado. Essa política também reduz o que fica
exposto a quem tiver acesso físico ao aparelho (LGPD).

## 4. Estados de uma operação local

| Estado            | Significado                                                              | Próximos estados                               |
| ----------------- | ------------------------------------------------------------------------ | ---------------------------------------------- |
| Pendente          | Gravada no aparelho, ainda não enviada                                   | Sincronizando                                  |
| Sincronizando     | Enviada; aguardando resposta                                             | Sincronizada, Conflito, Falha recuperável      |
| Falha recuperável | Rede, servidor ou banco indisponível, sessão expirada; nada foi aplicado | Pendente (nova tentativa automática ou manual) |
| Sincronizada      | Aplicada no servidor; tem o id e o código oficiais da venda              | — (final)                                      |
| Conflito          | Recusada por regra de negócio; guardada no servidor para decisão         | Resolvida                                      |
| Resolvida         | Gerente aprovou (aplica com a autoria original) ou descartou com motivo  | — (final)                                      |

- **Pendência de conciliação** é diferente de conflito: a operação foi aplicada, mas exige
  acompanhamento (estoque negativo, venda pós-fechamento, preço divergente, data ajustada).
- **Conflitos** (não aplicados; `SyncOperation.status = CONFLICT`, com o payload e o motivo em
  `conflictReason`): aparelho revogado (`DEVICE_REVOKED`); autorização ou aparelho inexistente, ou
  autorização de outro operador, aparelho ou caixa (`GRANT_MISMATCH`); caixa inexistente ou de outro
  operador (`CASH_REGISTER_MISMATCH`); preço inexistente no período (`PRICE_NOT_VALID`); produto ou
  cliente que nunca existiu (`PRODUCT_NOT_FOUND`, `CUSTOMER_NOT_FOUND`); quantidade fracionada em
  produto vendido por UN ou CX (`FRACTIONAL_QUANTITY`); Fiado (`ON_ACCOUNT_OFFLINE`); desconto maior
  que o subtotal ou dinheiro menor que o total (`INVALID_AMOUNTS`); venda de outro operador enviada
  por um gerente, sem outro motivo (`ASSISTED_SUBMISSION`). Usuário inativo ou sem `pdv.use`
  não chega a enviar (3.5).
- **Pendências** (`ReconciliationIssue`, venda aplicada): `NEGATIVE_STOCK`, `POST_CLOSING_SALE`,
  `PRICE_DIVERGENCE`, `DATE_ADJUSTED` e `DELETED_CUSTOMER` (cliente excluído depois da venda: a
  venda é aceita). Cada uma guarda os valores do caso em `details` e recebe uma ciência, com nota.
- **Aprovação** (#38): grava a venda com a autoria, o caixa e os preços originais, mesmo com o caixa
  já fechado, gera as pendências de sempre e, numa venda no Fiado, o título. Quantidade fracionada
  fica a critério do gerente. Produto, cliente ou caixa inexistente e valores inconsistentes não
  podem ser aprovados: só descartados. Aprovar ou descartar de novo não tem efeito.
- Resolver conflito exige a nova permissão `offline.reconcile` (ADMIN e MANAGER). Aprovação e
  descarte registram quem decidiu, quando e o motivo.
- "Resposta perdida" não é estado: o reenvio com a mesma chave devolve o resultado já gravado.
- Uma operação nunca sai da fila do aparelho antes de chegar a **Sincronizada** ou **Resolvida**.
- No aparelho (#38, parte 2, `LocalOperationStatus` em `src/lib/offline/db.ts`): `pending`,
  `syncing`, `failed` (falha recuperável), `synced` (inclusive aprovada), `conflict`, `discarded`
  (resolvida por descarte) e `rejected`. Mapeamento das respostas do servidor:
  - `applied`/`approved` → `synced`; `conflict` → `conflict`; `discarded` → `discarded`;
  - `invalid` e `protocol_error` → `rejected`: o servidor não gravou nada e reenviar não muda o
    resultado. A venda fica na fila, visível como "Erro: avise o gerente", e nunca é apagada;
  - `retry`, falta de resposta para a operação, rede, tempo esgotado, 401, 403, 503 e protocolo
    desatualizado → `failed`, com nova tentativa automática;
  - `forbidden` (operação de outro operador para a sessão atual) → `failed`: nada foi gravado, e a
    venda volta a ser enviada quando o operador dela entrar.
- Conflitos são consultados de novo (reenvio da mesma chave) a cada 5 minutos ou no botão
  "Sincronizar", para o aparelho saber da decisão do gerente.
- Retenção: vendas sincronizadas ou descartadas ficam 24 h na fila (reimpressão do recibo) e saem
  depois que a cópia local já reflete a baixa delas.

## 5. Contrato do protocolo de sincronização

Transporte: **Route Handlers** em `src/app/api/offline/` (não Server Actions). Motivo: os ids de
Server Action mudam a cada build, e uma fila gravada antes de um deploy precisa continuar enviável
depois dele. Cada handler começa com `authorize("<permissão>")`, e o `pnpm check:actions` passa a
conferir também esses handlers (o `src/proxy.ts` não atua em `/api`).

### Envio (aparelho → servidor)

Cada operação leva:

| Campo             | Descrição                                                                                     |
| ----------------- | --------------------------------------------------------------------------------------------- |
| `protocolVersion` | Versão do protocolo (começa em `1`)                                                           |
| `operationId`     | UUID gerado no aparelho; chave de idempotência                                                |
| `kind`            | Tipo da operação (`sale.create` na primeira entrega)                                          |
| `deviceId`        | Aparelho registrado                                                                           |
| `grantId`         | Autorização offline usada                                                                     |
| `userId`          | Operador original                                                                             |
| `cashRegisterId`  | Caixa original                                                                                |
| `occurredAt`      | Instante local da operação (informativo; limitado pelo servidor, 3.6)                         |
| `payload`         | Itens com quantidade e **preço praticado**, desconto, forma de pagamento, valor pago, cliente |
| `payloadHash`     | SHA-256 do `payload` canônico                                                                 |

O servidor grava `receivedAt` e o resultado.

Implementado na #38: `POST /api/offline/operations` com `authorize("pdv.use")`, corpo JSON
`{ "protocolVersion": 1, "operations": [...] }` e até 50 operações por lote (400 acima disso, com
versão desconhecida, lote vazio ou corpo que não é JSON; 401/403 como os demais handlers).

- Decimais chegam **como texto** (`"quantity": "0.333"`, `"unitPrice": "45.90"`, `"discount"`,
  `"amountPaid"` só em dinheiro); número é recusado, para não perder precisão.
- O servidor calcula o `payloadHash` sobre a operação normalizada (envelope e venda, itens em ordem
  estável); o aparelho não precisa enviá-lo. Itens repetidos com o mesmo preço são somados.
- Resultado por operação: `applied` ou `approved` (com `sale.id`, `sale.code`, `sale.occurredAt` e
  `appliedTxid`), `conflict` (com `reason` e `message`), `discarded`, `invalid` (formato),
  `protocol_error` (mesma chave com outros dados), `forbidden` (operação de outro operador, nada é
  gravado) e `retry` (falha temporária, nada foi gravado). `replayed: true` indica resultado de um
  envio anterior.
- `appliedTxid` é o id da transação que gravou a venda. A resposta da cópia local
  (`GET /api/offline/snapshot`) traz `watermark`: depois da última página, toda transação com id
  menor já está refletida. Assim o aparelho sabe quando parar de descontar do saldo local uma venda
  já sincronizada.

- **Idempotência:** tabela de operações com `operationId` único, inserida **na mesma transação** da
  venda, dos itens, do estoque e do caixa. Mesma chave e mesmo hash devolvem o resultado anterior;
  mesma chave com hash diferente é rejeitada como erro de protocolo.
- **Autoria:** só são enviadas as operações cujo `userId` é o usuário da sessão atual. Outro login no
  mesmo aparelho não envia nem assume as operações de outro operador. Se o operador original não puder
  mais entrar, um gerente envia pelo fluxo assistido, e as operações chegam como conflito, com a
  autoria original preservada.
- **Resposta por operação:** cada item do lote volta com o próprio estado (sincronizada, conflito ou
  falha recuperável). Um lote parcialmente processado é seguro de reenviar.
- **Atomicidade:** venda, itens, estoque, caixa e pendências numa única transação. Conflito não deixa
  efeito parcial.

### Recebimento (servidor → aparelho)

- `GET /api/offline/snapshot?cursor=<cursor>&limit=<1..1000>` (padrão 500), com
  `authorize("pdv.use")` e `Cache-Control: no-store`. Sem cursor é a carga completa (`reset: true`:
  o aparelho substitui a cópia local); com o `cursor` da resposta anterior, só o que mudou. Com
  `hasMore`, o aparelho pede a próxima página na hora. Respostas: 401 sem sessão, 403 sem permissão,
  400 para cursor ou limite inválido, 503 se o banco falhar.
- Cada resposta traz produtos, categorias e clientes alterados (campos de 3.8; decimais como texto
  para não perder precisão) e, completos, os dados da loja do recibo, o caixa aberto do operador e o
  usuário. Exclusões chegam só com o id: `{ "id": "...", "deleted": true }`.
- **Cursor sem perdas (aprovado na #36, substitui o cursor por `(updatedAt, id)`):** o `updatedAt` é
  gravado com o horário da consulta, não o da confirmação. Uma transação lenta (ex.: venda com vários
  itens) que grava `updatedAt = T1` e confirma em T3 seria pulada por uma leitura em T2 que já tivesse
  avançado o cursor além de T1. Por isso:
  - `Product`, `Category` e `Customer` têm `syncVersion BIGINT`, preenchida por gatilho no banco em
    todo `INSERT`/`UPDATE` com `pg_current_xact_id()` (id da transação, 64 bits, nunca reinicia).
    Vale também para `updateMany` (baixa de estoque da venda e ajuste) e para SQL direto.
  - A leitura roda em `REPEATABLE READ` e só entrega versões abaixo de
    `pg_snapshot_xmin(pg_current_snapshot())`: toda transação com id menor já terminou. O que está
    acima desse limite chega na leitura seguinte.
  - O cursor é a posição `(syncVersion, id)` de cada tabela, opaco para o aparelho (base64url).
  - Limite conhecido: uma transação muito longa e aberta no banco segura o limite e atrasa a
    sincronização (não perde dados).
- Ao aplicar mudanças recebidas, o aparelho preserva as operações pendentes e recalcula o saldo local
  (saldo recebido menos pendentes).

### Conectividade

- Sincroniza automaticamente com a aplicação aberta e o servidor acessível, e oferece botão manual.
- O sinal de conexão é uma chamada real ao servidor (ex.: `GET /api/offline/ping`, sem cache e com
  tempo limite), não `navigator.onLine`. Não depende de Background Sync nem promete envio com o
  navegador fechado.
- Implementado na #37 (`src/lib/offline/sync.ts`): `GET /api/offline/ping` com `authorize("pdv.use")`
  e tempo limite de 5 s no aparelho. 200 traz o usuário da sessão; 401 manda ao login; 403 apaga a
  cópia local e mostra "sem acesso"; falha de rede, tempo esgotado ou 503 contam como servidor
  inacessível. O `/pdv` confere a cada 30 s, nos eventos `online`/`offline` e ao voltar para a aba, e
  sincroniza as alterações a cada 2 min com conexão.

### Preparação (aparelho → servidor, #37)

- `POST /api/offline/prepare` com `{ "deviceId"?, "deviceName"? }` em JSON (outro tipo de conteúdo é
  recusado, para obrigar a checagem de CORS), `authorize("pdv.use")` e `Cache-Control: no-store`.
  Exige o caixa aberto do operador (409 `cash_closed`). Registra o aparelho na primeira vez (id
  desconhecido também registra de novo), recusa aparelho revogado (403 `device_revoked`) e emite a
  autorização offline de 12 h vinculada ao caixa. Renovar é preparar de novo.
- Em seguida o aparelho pede `navigator.storage.persist()`, grava a autorização e faz a carga completa
  da cópia (`GET /api/offline/snapshot` sem cursor).

## 6. Escolhas técnicas

Verificadas contra `node_modules/next/dist/docs/01-app/` (Next.js 16.3.8):
`02-guides/progressive-web-apps.md`, `02-guides/offline-support.md`,
`02-guides/single-page-applications.md`, `03-api-reference/04-functions/use-offline.md` e
`03-api-reference/05-config/01-next-config-js/useOffline.md`.

### 6.1 Service Worker: Serwist

- **Escolha:** Serwist com `@serwist/turbopack`, que o guia de PWA do Next indica como opção para
  cache offline completo com Turbopack. O Service Worker é servido por uma rota
  (`app/serwist/[path]/route.ts` com `createSerwistRoute`).
- **Por quê:** gera a lista de arquivos do build a guardar (`_next/static`), que é a parte difícil de
  manter à mão, e trata atualização de versão.
- **Validado na #37** com `serwist` e `@serwist/turbopack` **9.5.12** (estáveis) no Next 16.3.8:
  - o fonte fica em `src/service-worker/sw.ts` (tsconfig próprio, com a lib `webworker`, fora do
    tsconfig da aplicação) e é empacotado no build pelo `esbuild` nativo (dependência de
    desenvolvimento; `useNativeEsbuild: true`, também na Vercel);
  - `/serwist/sw.js` sai estático no build, com `Service-Worker-Allowed: /` (escopo `/`) e
    `Cache-Control: no-cache, no-store, must-revalidate` (`next.config.ts`); o proxy não atua em
    `/serwist/` nem no manifest;
  - guarda `_next/static` (inclusive chunks sob demanda e as fontes `.woff2`) e `public/` (com o
    WASM do leitor e os ícones), mais as páginas estáticas `/pdv` e `/offline`. A revisão dessas
    páginas é `VERCEL_GIT_COMMIT_SHA` ou, fora da Vercel, o hash da lista de arquivos do build;
  - qualquer outra navegação vai direto à rede e nunca é guardada; sem conexão, cai na página
    `/offline` (com atalho para o `/pdv`). `/api` não passa pelo Service Worker;
  - a versão nova **espera** (`skipWaiting: false`): o `/pdv` mostra "Atualizar o app" e só troca
    quando o operador confirma. Os caches antigos são apagados na troca; o IndexedDB não é tocado;
  - em `next dev` o registro fica desligado.

### 6.2 Tela do PDV offline

- O PDV atual não pode ser guardado: a página usa `connection()`, recebe os dados do servidor, e o
  layout de `/admin` consulta o banco e mostra o nome e o menu do usuário.
- **Escolha:** uma rota nova, `/pdv`, **fora** do `/admin`, estática e renderizada só no navegador
  (`next/dynamic` com `ssr: false`, conforme o guia de SPA). O HTML não contém dados do usuário; tudo
  vem do IndexedDB. Quando há rede, os dados chegam pelos Route Handlers autenticados.
- Por estar fora do `/admin`, a página não usa `requirePageAccess` (não há dado no HTML para
  proteger). A proteção fica nos handlers (`authorize("pdv.use")`).
- **Decisões da #37 (aprovadas pelo responsável em 03/10/2026):**
  1. O `/admin/pdv` fica como está (PDV online). O `/pdv` entra no menu como "PDV sem internet"
     (`APP_ROUTES`) e é aceito como destino do login. O redirecionamento fica para a #38.
  2. (Substituída na #38, abaixo.) No `/pdv` a venda só é finalizada com conexão, pelo `createSale` com a idempotência da #35. Sem
     conexão, o carrinho é montado normalmente e o botão de finalizar fica desativado com aviso.
  3. A tela de aparelhos e a revogação pela interface vão para a #38; aqui entram o campo
     `revokedAt` e a recusa na preparação.
  4. O acesso segue esta seção, não o `requirePageAccess` citado no escopo da issue.
- **Decisões da #38 (aprovadas pelo responsável em 04/10/2026):**
  1. Caminho único no `/pdv`: toda venda entra na fila do aparelho e é enviada na hora pelo
     `POST /api/offline/operations`, com as regras offline. O `/admin/pdv` continua com o
     `createSale` e as regras online. Sem redirecionar o `/admin/pdv` para o `/pdv` até a #39.
  2. A #38 é entregue em três partes: servidor; fila no navegador; telas de conciliação, aparelhos,
     caixa e estoque, com o envio assistido por um gerente.
- **Implementado na #38, parte 2:**
  - O `PdvTerminal` recebe `submitSale`. No `/pdv`, finalizar grava a venda na fila do aparelho
    (`recordSale`, `src/lib/offline/queue.ts`) e só então mostra o recibo; falha de gravação ou de
    cota mantém o carrinho. Com e sem conexão o fluxo é o mesmo; com conexão, o recibo espera até
    4 s pelo envio para já sair com o código oficial.
  - Valores calculados em inteiros (centavos e milésimos), com o mesmo arredondamento do servidor
    (subtotal de cada item com meio para cima). O terminal usa o mesmo cálculo na tela, também no
    `/admin/pdv`: em ponto flutuante, 0,01 kg x R$ 14,50 apareceria como R$ 0,14 e não R$ 0,15.
  - Envio pelo `sendQueue`: lotes de até 50, na ordem das vendas, uma aba por vez (Web Locks;
    sem Web Locks envia sem trava, o que continua seguro pela idempotência). A ordem é o relógio
    do aparelho (`createdAt`) e, no mesmo milissegundo, o número de gravação (`seq`, crescente no
    banco do operador e atribuído na mesma transação da gravação). Roda em qualquer tela
    do `/pdv` com conexão, inclusive na de preparação (caixa fechado ou autorização vencida), e
    sincroniza a cópia depois de uma venda aplicada.
  - Recibo provisório com o código do aparelho (8 primeiros caracteres do `operationId`) e a
    situação; depois de sincronizada, o recibo traz `VENDA #<código>` e o código do aparelho. O
    recibo usa sempre o fuso da loja.
  - Lista "Vendas deste aparelho" no cabeçalho, com a situação, o motivo do conflito ou da falha e
    o recibo de cada venda. "Encerrar neste aparelho" e "Sair" mantêm as vendas não finalizadas.
- O terminal é o mesmo do `/admin/pdv` (`src/components/pdv-terminal.tsx`), com os dados da cópia
  local. O Fiado não é oferecido no `/pdv`: a cópia não leva os parâmetros dele (3.4 e 3.8).
- Abre sem conexão só com: operador ativo preparado, cópia completa, autorização válida, dados com
  até 24 h e o caixa da autorização igual ao da última sincronização. Fora disso, a tela explica o
  motivo. Com conexão, autorização vencida, caixa fechado ou caixa trocado levam à tela de
  preparação.

### 6.3 IndexedDB: Dexie

- **Escolha:** Dexie 4.x.
- **Por quê:** versões de estrutura com migração (uma atualização da aplicação não pode descartar a
  fila), transações em várias tabelas e consultas reativas para o React. O custo é de cerca de 30 KB
  comprimidos, carregados só no `/pdv`.
- **Alternativa descartada:** `idb`, menor, mas as migrações e a reatividade ficariam por nossa conta.
- A fila de operações é migrada junto com a estrutura e coberta por teste de atualização com fila
  existente (#38, parte 2: versão 2 do banco do operador, `tests/unit/offline-queue.test.ts`, com o
  IndexedDB simulado pelo `fake-indexeddb`). Uma linha da versão 1 sem os dados da venda (a fila
  nunca recebeu vendas antes da #38) vira `rejected`, visível, em vez de ser apagada.
- O aparelho pede `navigator.storage.persist()` na preparação. Falha de gravação ou de cota **impede**
  confirmar a venda localmente e mantém o carrinho.

### 6.4 `experimental.useOffline`: não usar agora

- Pela documentação, ele guarda as Server Actions pendentes só na memória da aba e as reenvia uma vez
  quando a conexão volta. Recarregar a página perde as pendências.
- Se a resposta se perdeu depois de o banco gravar, o reenvio duplicaria a venda.
- O hook `useOffline()` só funciona com a flag ligada.
- **Reavaliar depois da #35**, quando a venda online tiver idempotência, apenas para retentar
  navegação e ações das telas que continuam online. Não substitui a fila nem o protocolo.

## 7. Habilitação do aparelho e isolamento entre usuários

- **Registro do aparelho:** na primeira preparação, o aparelho recebe um `deviceId` registrado no
  servidor (nome, quem registrou, quando, última sincronização, revogação). ADMIN e MANAGER podem
  revogar um aparelho.
- Implementado na #37 (migration `0008_offline_devices`): tabelas `OfflineDevice` (o aparelho,
  compartilhado pelos operadores do mesmo navegador) e `OfflineGrant` (operador, aparelho, caixa,
  emissão e expiração). O `deviceId` fica no banco comum do navegador. Limite: apagar os dados do
  site no navegador gera um aparelho novo na próxima preparação. A interface de revogação entrou na parte 3 da #38 (seção 3.5).
- **Preparação** (online, por operador): caixa aberto, `pdv.use`, download da cópia mínima e emissão
  da autorização offline (3.5).
- **Quem opera offline:** só o usuário que preparou o aparelho, enquanto a autorização for válida.
  Sair encerra a operação offline desse usuário; entrar de novo exige internet.
- **Separação dos dados:** um banco IndexedDB por usuário (`gestao-lojas-offline-<userId>`) e um banco
  comum só com o `deviceId` e a contagem de pendências por usuário.
- **Saída e troca de usuário:** a cópia de dados do usuário que sai é apagada; a fila pendente é
  mantida e fica oculta para os outros usuários até o dono sincronizar. Nada pendente é apagado em
  silêncio.
- Implementado na #37 (`src/lib/offline/db.ts`): o "Sair" do painel e do `/pdv` apaga a cópia antes
  de encerrar a sessão; o painel (`OfflineUserGuard`) e o `/pdv` (pelo `ping`) apagam a cópia do
  operador anterior quando outro usuário entra sem que ele tenha saído. Sem conexão, "Encerrar neste
  aparelho" apaga a cópia local. Sem fila, o banco do operador é removido; com fila, ficam só as
  operações.
- **Senha nunca é guardada.** A sessão continua no cookie `HttpOnly` do Auth.js; o cache não vale
  como autorização no servidor.
- **Limite assumido:** quem tem acesso físico ao aparelho e à conta do sistema operacional consegue ler
  o IndexedDB. Por isso a cópia é mínima (3.8) e não inclui custo nem contato de clientes.

## 8. Mudanças previstas por etapa

Nada abaixo é feito nesta issue; serve de referência para as próximas.

| Etapa                     | Mudanças decorrentes deste documento                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #35 Idempotência e testes | Tabela de operações (`operationId` único, aparelho, operador, hash, estado, resultado); `Sale.occurredAt`; venda travando o caixa pelo id original; relatórios e vencimento por `occurredAt`; testes de integração com PostgreSQL                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| #36 Cópia local           | Exclusão lógica em produtos, clientes e categorias (índices únicos parciais); datas em `Category`; histórico de preços; Route Handlers de cópia com cursor e campos de 3.8                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| #37 PWA                   | Teste do Serwist (6.1); manifest; rota `/pdv` (6.2); Dexie (6.3); registro de aparelho e autorização offline (7); limpeza na saída e troca de usuário                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| #38 Fila e conciliação    | Parte 1 (servidor, feita): migration `0009_offline_sync`, envio por lote, pendências, `offline.reconcile` e actions de conciliação. Parte 2 (navegador, feita): fila no Dexie, saldo reservado, envio entre abas, recibo provisório e bloqueio do fechamento. Parte 3 (feita): migration `0010_offline_reconciliation`, tela "Sincronização offline" (conflitos, pendências e aparelhos), envio assistido, aviso do servidor no fechamento, ajuste pós-fechamento e saldo negativo em destaque. Estados (4); envio por lote; estoque negativo só pela sincronização; ajuste pós-fechamento no detalhe do caixa; permissão `offline.reconcile` e tela de conflitos; recibo provisório no fuso da loja |
| #39 Testes de navegador   | Playwright com os cenários da #33 (rede cortada, recarga, resposta perdida, dois terminais, caixa fechado, usuário revogado, cota, atualização com fila). Parte (a), feita: infraestrutura e 12 cenários (seção 9). Parte (b), feita: cota, atualização de versão, câmera, Edge, Android emulado e relatório por camada (9.1)                                                                                                                                                                                                                                                                                                                                                                        |
| #40 Expansão              | Módulos marcados como "Expansão" na matriz (2), seguindo o critério de expansão                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

Migrations seguem o fluxo de `docs/DEPLOY.md` (aplicação explícita com `pnpm db:deploy`, nunca no
build).

## 9. Testes de navegador (#39)

Suíte Playwright em `tests/e2e/` (como rodar: README, "Testes de navegador"), contra o build de
produção, com o Service Worker ativo, o banco descartável dos testes de integração e o `siteverify`
do reCAPTCHA simulado no servidor.

**Navegadores** (matriz da seção 3.5), um projeto do Playwright cada:

- `chromium`: o Chromium do Playwright, no lugar do Chrome de computador;
- `msedge`: o Edge instalado na máquina (`channel: "msedge"`);
- `android`: Chrome no Android **emulado** (Pixel 7: tela, toque e user agent). Não é um aparelho
  real: câmera, armazenamento e economia de bateria do Android ficam para a homologação.

Safari/iOS não é suportado (3.5) e não entra na suíte.

**Como cada situação é simulada:**

| Situação                       | Como                                                                                                        |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Sem rede                       | `context.setOffline`                                                                                        |
| Falhas do servidor             | Interceptação das chamadas `/api/offline/**` na página (o Service Worker não atende `/api`)                 |
| Mudanças "por outro lado"      | Direto no banco (preço, caixa, usuário)                                                                     |
| Sem espaço / erro do IndexedDB | `IDBObjectStore.add` da fila passa a lançar `QuotaExceededError` ou `UnknownError` na página                |
| Versão nova do app             | Preload do servidor (`support/mock-app-version.mjs`) serve o `/serwist/sw.js` com outra revisão das páginas |
| Banco local da versão anterior | O teste recria o banco do operador com a estrutura da versão 1 (antes da #38), com as mesmas linhas         |
| Câmera                         | Câmera falsa do Chromium com um vídeo Y4M de um EAN-13, gerado no `global-setup` (`support/fake-camera.ts`) |

O Playwright não intercepta a busca do script do Service Worker (quem a faz é o navegador, fora da
página), por isso a versão nova é simulada no servidor. É o mesmo build com outra revisão do `/pdv`
e do `/offline`: o navegador instala o Service Worker novo e guarda as páginas de novo. A troca
dos arquivos `_next/static` entre dois builds diferentes fica para a homologação.

| Arquivo                    | Cenários                                                                                                         |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `service-worker.spec.ts`   | `/pdv` preparado recarrega sem rede; painel sem rede mostra a página offline                                     |
| `offline-sales.spec.ts`    | vender sem rede, recarregar, reconectar e comparar vendas/itens/estoque/caixa/recebíveis; reconexão intermitente |
| `network-failures.spec.ts` | resposta perdida depois da gravação; servidor fora do ar com internet; lote processado em parte                  |
| `business-rules.spec.ts`   | dois terminais com o último saldo; preço alterado; caixa fechado no servidor                                     |
| `users-sessions.spec.ts`   | operador desativado (envio assistido pelo gerente); troca de usuário com fila; sessão expirada                   |
| `storage-failures.spec.ts` | sem espaço no aparelho e erro do IndexedDB: sem recibo, carrinho mantido e uma única venda na nova tentativa     |
| `app-update.spec.ts`       | Service Worker novo com a fila cheia ("Atualizar o app"); banco local da versão anterior migrado com a fila      |
| `camera-scanner.spec.ts`   | sem rede, a câmera lê o código (ZXing em WASM do cache do Service Worker) e a venda segue pela fila              |

Encontrado pela suíte (corrigido na #39): usuário desativado com o cookie ainda válido ficava em
laço de redirecionamento entre `/login` e `/` (o navegador desistia com erro). Agora o servidor
manda para `/login?sessao=invalida`, que explica o motivo e permite entrar com outro usuário.
Comportamento confirmado: o `/pdv` só percebe o caixa fechado no servidor ao atualizar a cópia
(a cada 2 min ou no "Sincronizar"); a fila é enviada antes disso, e a venda vai para o caixa
original como ajuste pós-fechamento.

### 9.1 Evidências por camada (critérios de aceite da #33)

Camadas:

- **Unidade:** `pnpm test:unit`. Fila e venda no navegador, com `fake-indexeddb`, sem servidor.
- **Integração:** `pnpm test:integration`. Servidor e PostgreSQL real e descartável.
- **Navegador:** `pnpm test:e2e`. Build de produção nos três projetos acima.
- **Homologação:** no ambiente alvo (Vercel + Neon), com aparelho real. **Nenhum item foi
  homologado por esta suíte**: o roteiro de conferência de produção está no `docs/DEPLOY.md`.

| Critério da #33                                                                      | Unidade                                          | Integração                                                     | Navegador                                                          | Homologação |
| ------------------------------------------------------------------------------------ | ------------------------------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------ | ----------- |
| Preparar, cortar a rede, recarregar, consultar e vender; defasagem e bloqueios       | Autorização vencida não grava                    | Preparação, autorização de 12 h, recusas (`offline-device`)    | `service-worker`, `offline-sales`, `camera-scanner`                | Pendente    |
| Vendas pendentes sobrevivem a recarregar; novas vendas descontam as pendentes        | Saldo reservado sem erro de ponto flutuante      | —                                                              | `offline-sales` (recarga e saldo reservado), `app-update`          | Pendente    |
| Carrinho em montagem sobrevive a fechar e reabrir                                    | —                                                | —                                                              | **Lacuna**: o carrinho só existe na memória da página (ver abaixo) | —           |
| Uma única venda: resposta perdida, cliques repetidos, duas abas, lote repetido       | Trava entre abas; venda "sincronizando" retomada | Mesma chave, chamadas simultâneas, lote repetido               | `network-failures`, `offline-sales` (reconexão intermitente)       | Pendente    |
| Atualizações e exclusões chegam sem apagar pendentes                                 | Limpeza só das finalizadas e refletidas          | Incremental, exclusões, cursor sem perdas (`offline-snapshot`) | `business-rules` (preço alterado)                                  | Pendente    |
| Preço alterado, produto removido, estoque disputado, caixa fechado, Fiado bloqueado  | —                                                | Todas as políticas (`offline-sync`, `offline-reconciliation`)  | Preço, dois terminais e caixa fechado (`business-rules`)           | Pendente    |
| Sessão expirada, operador inativo ou sem permissão; autoria e isolamento             | Fila do operador e envio assistido               | 401/403, envio assistido com a autoria original                | `users-sessions`                                                   | Pendente    |
| Dinheiro, desconto/troco, unidades inteiras e fracionadas, datas                     | Arredondamento como o servidor                   | Precisão de valores e quantidades; data limitada à validade    | `offline-sales` (UN e KG)                                          | Pendente    |
| Cota, banco indisponível, atualização do app, falha intermediária: sem falso sucesso | Falha de rede é recuperável                      | Falha no meio desfaz tudo; 503 com o banco fora                | `storage-failures`, `network-failures`, `app-update`               | Pendente    |
| Fluxos online continuam funcionando                                                  | —                                                | `createSale` com idempotência e autorização (`sales-action`)   | —                                                                  | Pendente    |

**Lacuna encontrada no levantamento da parte (b):** o carrinho que o operador está montando (antes
de "Finalizar Venda") fica só no estado do React (`pdv-terminal.tsx`). Recarregar ou fechar a aba
perde os itens. Venda nenhuma se perde, porque a venda só existe depois de gravada na fila. Mas o
critério da #33 fala em "carrinho e vendas pendentes" e precisa de uma issue própria (guardar o
rascunho no banco do operador).

**Fica para a homologação:**

- aparelho Android real (câmera, armazenamento, economia de bateria);
- dois builds diferentes trocando arquivos `_next/static`;
- cota real do navegador (a suíte simula o erro, não enche o disco);
- desempenho com o catálogo real;
- Chrome instalado (a suíte usa o Chromium do Playwright, da mesma base).
