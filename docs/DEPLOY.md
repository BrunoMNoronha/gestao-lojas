# Deploy em produção — Vercel + Neon

Runbook da publicação do sistema (issues #7 e #23). Banco: **Neon via Vercel Marketplace** (sucessor
do "Vercel Postgres"). Hospedagem: **Vercel** (time TechLab, projeto `gestao-lojas`).

Só existe o ambiente de **produção** (`main`). Não há previews nem banco de desenvolvimento na nuvem.

> Regras de ouro
>
> - Nunca versione segredos. Valores de produção ficam apenas nas variáveis de ambiente da Vercel.
> - Migrations são aplicadas por passo explícito (`pnpm db:deploy`), **não** no build — assim um
>   deploy de preview nunca altera o banco de produção.
> - Migrations são só "para frente". Para desfazer uma mudança de schema, crie uma nova migration.

## 1. Variáveis de ambiente

| Variável         | Ambiente   | Valor                                                                                     |
| ---------------- | ---------- | ----------------------------------------------------------------------------------------- |
| `DATABASE_URL`   | Production | URL **com pooler** da Neon (criada pela integração)                                       |
| `DIRECT_URL`     | Production | URL **sem pooler** da Neon (`DATABASE_URL_UNPOOLED` da integração)                        |
| `AUTH_SECRET`    | Production | Segredo aleatório: `npx auth secret` ou `openssl rand -base64 32`                         |
| `ADMIN_EMAIL`    | Production | E-mail do primeiro administrador                                                          |
| `ADMIN_PASSWORD` | Production | Senha do primeiro administrador (mínimo 12 caracteres), definida pelo responsável da loja |
| `ADMIN_NAME`     | Production | Opcional (padrão "Administrador")                                                         |

`AUTH_URL` não é necessário na Vercel (o host é detectado automaticamente).

Variáveis do reCAPTCHA do login (passo a passo na seção 9):

| Variável                      | Ambiente   | Tipo               | Valor                                                                               |
| ----------------------------- | ---------- | ------------------ | ----------------------------------------------------------------------------------- |
| `RECAPTCHA_SITE_KEY`          | Production | Plain ou Sensitive | Chave do site (pública, enviada à tela de login). Mudou, redeploy                   |
| `RECAPTCHA_SECRET_KEY`        | Production | Sensitive          | Chave secreta (só no servidor). Sem ela o login é recusado                          |
| `RECAPTCHA_MIN_SCORE`         | Production | Plain              | Opcional. Score mínimo de 0 a 1 (padrão `0.5`)                                      |
| `RECAPTCHA_ALLOWED_HOSTNAMES` | Production | Plain              | Opcional. Recomendado: `gestao-lojas-dpv.vercel.app` (padrão: o host da requisição) |

## 2. Configuração do projeto na Vercel

| Item                  | Valor                                                                                                                                       | Onde                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Região das funções    | `gru1` (São Paulo), perto do banco Neon `aws-sa-east-1`                                                                                     | `vercel.json` (`regions`)               |
| Deploys automáticos   | Só a `main` (produção). Outros branches não geram preview                                                                                   | `vercel.json` (`git.deploymentEnabled`) |
| Deployment Protection | Vercel Authentication só em previews (`deploymentType: preview`); a URL de produção é pública e o acesso é controlado pelo login do sistema | Settings → Deployment Protection        |
| Integração Prisma     | Instalada pela importação do projeto, **não usada**                                                                                         | —                                       |

## 3. Criar o banco

1. Vercel → time **TechLab** → _Add New → Project_ → importar `BrunoMNoronha/gestao-lojas`.
   Framework: Next.js. Comandos padrão (`pnpm install` / `next build`). O `postinstall` gera o
   Prisma Client.
2. Banco atual de produção (criado em 2026-10-02): projeto Neon **`gestao-lojas`**
   (`fancy-violet-38898614`), org **"TechLab+ Gestão Lojas"** (plano Free), região **São Paulo
   (`aws-sa-east-1`)**, Postgres 18, branch `production`, banco `neondb`. Foi criado no console da
   Neon (não pelo Marketplace), então **não há integração** sincronizando variáveis: as URLs foram
   gravadas manualmente na Vercel. Se a senha do role `neondb_owner` for trocada na Neon, atualize
   `DATABASE_URL` e `DIRECT_URL` e faça redeploy.
   - Alternativa para um banco novo: _Storage_ → _Create Database_ → **Neon** pelo Marketplace,
     ligado só a Production. A org "TechLab Aldeia" é gerida pela Vercel e bloqueia criação de
     projetos pela API/console da Neon.
3. Em _Settings → Environment Variables_, ambiente **Production**, tipo **Sensitive**:
   - `DATABASE_URL`: URL **com pooler** (host com `-pooler`);
   - `DIRECT_URL`: a mesma URL **sem** `-pooler` (conexão direta, usada pelas migrations);
   - `AUTH_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME`;
   - `RECAPTCHA_SECRET_KEY` (seção 9).
4. Preview e Development ficam sem banco e sem variáveis: os previews estão desligados no
   `vercel.json`. Nunca conecte o banco de produção a esses ambientes.

## 4. Aplicar as migrations no banco de produção

```bash
# baixa as variáveis de produção para um arquivo local (ignorado pelo Git: .env*)
vercel env pull .env.production.local --environment=production
# carrega DATABASE_URL / DIRECT_URL no shell e aplica as migrations
set -a; . ./.env.production.local; set +a
pnpm db:deploy
# apague o arquivo em seguida
rm .env.production.local
```

### Banco criado antes das migrations (`db push`)

Se o banco já tem as tabelas do schema atual (criadas com `prisma db push`), marque o baseline
como aplicado antes do primeiro `db:deploy`:

```bash
pnpm prisma migrate resolve --applied 0001_init
pnpm db:deploy
```

## 5. Deploy de produção e primeiro acesso

1. Faça o deploy de produção (merge no `main` com a integração Git, ou _Redeploy_ no painel).
2. Acesse `/login` e entre com `ADMIN_EMAIL` / `ADMIN_PASSWORD`. O administrador é criado nesse
   primeiro login (somente se o banco não tem usuários).
3. Opcional: depois do primeiro acesso, remova `ADMIN_PASSWORD` das variáveis da Vercel.

Se o login falhar com banco vazio, confira os logs da função: `[bootstrap-admin]` informa se as
variáveis estão ausentes ou se a senha tem menos de 12 caracteres.

## 6. Checklist de fumaça (após cada deploy de produção)

- [ ] `/login` abre; `/admin` sem sessão redireciona para `/login`.
- [ ] `/login` mostra o aviso "Este site é protegido pelo reCAPTCHA…" e o botão "Entrar" habilita.
- [ ] Login com o administrador.
- [ ] Configurações da Loja: salvar nome, CNPJ e endereço.
- [ ] Configurações da Loja: a seção "Venda no Fiado" abre com o fiado permitido e salva/recarrega os parâmetros.
- [ ] Produtos: cadastrar um produto com estoque inicial → aparece em Estoque como "Estoque inicial".
- [ ] Caixa: abrir com suprimento inicial.
- [ ] PDV: venda em dinheiro (com troco) e venda no Fiado para um cliente; recibo abre e imprime.
- [ ] Contas a Receber: título do fiado aparece; registrar um recebimento.
- [ ] Caixa: fechar com o valor contado; fechamento aparece no histórico.
- [ ] Dashboard e Relatório de Vendas mostram as vendas do dia.
- [ ] `/vendor/zxing/zxing_reader-<versão>.wasm` responde 200 (o `postinstall` rodou no build).
- [ ] Celular: ler um EAN pela câmera no PDV (HTTPS de produção).
- [ ] `/serwist/sw.js` responde 200 com `Service-Worker-Allowed: /` e `Cache-Control: no-cache…`.
- [ ] PDV sem internet (`/pdv`): preparar com o caixa aberto, desligar a rede do aparelho, recarregar
      e reabrir o navegador → o PDV abre, busca produtos e clientes e mostra "Sem conexão".
- [ ] Depois do deploy, o `/pdv` já preparado mostra "Atualizar o app"; ao atualizar, os dados
      continuam (idade e validade no topo).
- [ ] Configurações da Loja (ADMIN): a seção "Dados de teste" **não aparece** em produção
      (`ENABLE_STORE_TEST_TOOLS` ausente; seção 11).

## 7. Usabilidade e performance do PDV

- [ ] Venda de 3 itens só com teclado (F2 busca → Enter → F10 → F10): medir o tempo total.
- [ ] Tempo de resposta de `createSale` (aba Network do navegador) — referência: < 1 s.
- [ ] TTFB de `/admin/pdv` com o banco "acordado" e após inatividade (cold start da Neon Free).
- [ ] Layout em 1366×768 e 1920×1080: carrinho, totais e botões visíveis sem rolagem horizontal.
- [ ] Leitor de código de barras: ler um EAN cadastrado adiciona o item ao carrinho.

## 8. Rollback

- **Código:** Vercel → _Deployments_ → deploy anterior → _Promote to Production_.
- **Banco:** migrations não são revertidas automaticamente. Se uma migration causar problema,
  publique uma nova migration corretiva. Antes de mudanças de schema arriscadas, crie um branch
  ou snapshot da Neon.
- **Restauração do banco pela tela (seção 11):** o sistema não guarda cópia. Só a restauração por
  ponto no tempo ou um branch da Neon criado antes trazem os dados de volta.

## 9. reCAPTCHA no login (issue #26)

Toda tentativa de login passa por uma verificação **reCAPTCHA v3** (invisível, por score) validada
no servidor, dentro do `authorize()` do Auth.js (`src/auth.ts` → `src/lib/recaptcha.ts`), **antes**
do bootstrap do administrador e de qualquer consulta ao banco. Chamar
`POST /api/auth/callback/credentials` direto, sem token válido, não chega ao banco.

O servidor confere no `siteverify` do Google (timeout de 5 s): `success`, `action === "login"`,
`hostname` aceito e `score` ≥ `RECAPTCHA_MIN_SCORE`. Cada token vale uma vez (o Google recusa a
reutilização) e a tela gera um novo a cada envio.

### Criar a chave (responsável pela conta Google)

O reCAPTCHA agora é gerenciado no Google Cloud (não é mais possível criar chaves "Classic").
Os nomes abaixo são os da documentação oficial em 2026-10; confira no console se mudaram.

1. No [Google Cloud Console](https://console.cloud.google.com/), crie ou escolha um projeto da loja
   e abra a página **Fraud Defense** (reCAPTCHA) → aba **Keys** → **Create key**.
2. _Display name_ à escolha; tipo **Web**; deixe **Disable domain verification** desligado.
3. **Add a domain**: `gestao-lojas-dpv.vercel.app` e `localhost`. Mantenha a opção padrão (por
   score, sem checkbox). Mudanças de domínio levam até 30 minutos para valer.
4. Copie o **ID da chave** (chave do site) → `RECAPTCHA_SITE_KEY`.
5. Na chave criada: **Key Details** → aba **Integration** → **Use Legacy Key** → copie a chave
   secreta legada → `RECAPTCHA_SECRET_KEY` (é a usada pelo `siteverify`).
6. Grave as duas na Vercel (Production; a secreta como **Sensitive**) e faça **redeploy**: a tela de
   login é gerada no build. Nunca registre a chave secreta em issue, PR ou chat.
7. Depois do deploy, faça um login real e confira as avaliações no console do reCAPTCHA.

Plano gratuito: **10.000 avaliações por mês**. Cada tentativa de login conta uma avaliação.
Atenção: acima da cota, o `siteverify` passa a responder `success: true` com score 0.9
(_fail open_ do Google), ou seja, a proteção deixa de filtrar. Se o volume crescer, ative o
faturamento no projeto.

### Comportamento quando algo falta ou falha (fail closed)

| Situação                                                                | Desenvolvimento                         | Produção (`NODE_ENV=production`)                      |
| ----------------------------------------------------------------------- | --------------------------------------- | ----------------------------------------------------- |
| Sem `RECAPTCHA_SECRET_KEY`                                              | Verificação desligada, aviso no log     | Login recusado; log `[recaptcha] ... não configurada` |
| Sem `RECAPTCHA_SITE_KEY`                                                | Tela sem reCAPTCHA                      | Tela não envia token; login recusado                  |
| Google fora do ar / timeout                                             | Login recusado, log `[recaptcha] Falha` | Login recusado, log `[recaptcha] Falha`               |
| Token ausente, inválido, reutilizado, action/host errado ou score baixo | Recusado                                | Recusado ("A verificação de segurança falhou")        |

`pnpm start` local também roda em modo produção: sem as chaves, o login fica bloqueado.

**Login travado em produção?** Abra os logs da função (Vercel → _Logs_, filtro `[recaptcha]`):

- `não configurada`: a variável foi apagada ou não está em Production. Grave de novo a chave
  secreta e faça redeploy.
- `Falha ao consultar o Google`: indisponibilidade do Google. Aguarde; não há contorno seguro.
- `hostname inesperado`: o domínio mudou. Inclua o novo domínio na chave do Google e em
  `RECAPTCHA_ALLOWED_HOSTNAMES` (se definida).
- `score ... abaixo de`: pessoas reais sendo recusadas com frequência. Reduza
  `RECAPTCHA_MIN_SCORE` (por exemplo para `0.3`) e faça redeploy.

Complementos recomendados (fora desta issue): limite de tentativas por usuário/IP e regras de
firewall da Vercel.

## 10. Homologação da operação offline (#33)

Roteiro para conferir a operação sem internet no ambiente alvo (Vercel + Neon), com aparelhos
reais. Fecha a coluna **Homologação** da tabela de evidências do `docs/OFFLINE.md` (seção 9.1) e
os itens que a suíte de navegador não cobre. As regras de negócio que cada passo confere estão no
`docs/OFFLINE.md` (seções 3 a 7); aqui fica só o que fazer e o que esperar.

Duração estimada: meio turno com duas pessoas (um operador e um gerente). Os cenários H17 e H18
dependem de esperar um deploy novo e uma noite, e podem ser feitos em outro dia.

### 10.1 Antes de começar

**Ambiente e dados.** Só existe produção: tudo o que a homologação gravar fica no banco real. Não há
estorno de venda, então as vendas de teste entram em relatórios, caixa e estoque.

- [ ] **DECISÃO PENDENTE (responsável):** o que fazer com os registros da homologação.
  - **RECOMENDAÇÃO:** fazer a homologação **antes** de a loja operar com dados reais, ou fora do
    expediente, com um branch de backup da Neon criado logo antes. Se nenhuma operação real
    acontecer entre o backup e o fim da homologação, restaurar o branch `production` a partir dele
    apaga os registros de teste. Se houver operação real no meio, **não restaure** (perderia vendas
    reais): os registros de teste ficam, identificados pelo prefixo `HOMOLOG`.
- [ ] Branch de backup na Neon (projeto `fancy-violet-38898614`, branch `production`), com nome
      `backup-antes-homologacao-offline-AAAAMMDD`.
- [ ] Produção com o código da #58 ou posterior (commit `a5159a8`) e as migrations até
      `0010_offline_reconciliation`. Conferir no console SQL da Neon (só leitura):

  ```sql
  select migration_name, finished_at from "_prisma_migrations" order by migration_name;
  ```

- [ ] Checklist de fumaça da seção 6 sem falhas.

**Massa de dados** (cadastrada pelo painel, com o prefixo `HOMOLOG` para achar e limpar depois):

| Cadastro | Dados                                                                                                                         |
| -------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Usuários | `HOMOLOG Operador A` e `HOMOLOG Operador B` (perfil Vendedor) e `HOMOLOG Gerente` (perfil Gerente)                            |
| Produtos | `HOMOLOG Arroz` (UN, R$ 10,00, estoque 20, com o EAN de uma embalagem real à mão), `HOMOLOG Queijo` (KG, R$ 45,90, estoque 5) |
|          | `HOMOLOG Último` (UN, R$ 5,00, estoque **1**) e `HOMOLOG Excluir` (UN, R$ 3,00, estoque 10)                                   |
| Cliente  | `HOMOLOG Cliente`, com CPF fictício válido                                                                                    |
| Loja     | Fiado permitido nas Configurações da Loja (para conferir que ele some no `/pdv`)                                              |

**Aparelhos** (matriz de navegadores do `docs/OFFLINE.md`, seção 3.5):

- **Computador:** Windows com Chrome instalado e Edge (aparelho 1).
- **Celular:** Android real com Chrome, câmera e economia de bateria disponíveis (aparelho 2).
- Um terceiro navegador ou aparelho para o gerente agir no painel enquanto os outros estão sem rede.

"Sem rede" é sempre a rede do aparelho desligada (Wi-Fi e dados, ou modo avião), nunca o DevTools,
exceto onde o passo diz o contrário.

**Registro.** Para cada cenário anote: data, aparelho, navegador, resultado (OK ou falhou) e a
evidência (print do recibo, da tela ou do resultado da consulta SQL). Falha vira issue com o print e
o passo. Ao fim, preencha a coluna Homologação da tabela 9.1 do `docs/OFFLINE.md`.

### 10.2 Cenários

Cada cenário indica o critério da tabela 9.1 que ele fecha. Faça na ordem: os primeiros preparam
os aparelhos para os seguintes.

**H1. Preparar, cortar a rede, recarregar e reabrir** (critério: preparar, cortar a rede...)

1. Aparelho 1, `HOMOLOG Operador A`: abrir o caixa no painel e entrar no **PDV sem internet**
   (`/pdv`). **Preparar este aparelho**; esperar sumir "Guardando o app no aparelho...".
2. Desligar a rede. Recarregar a página; depois fechar o navegador inteiro e abrir o `/pdv` de novo.
3. Esperado: o PDV abre com "Sem conexão com o servidor", a idade dos dados e a validade no topo;
   a busca acha os produtos `HOMOLOG` e o cliente (documento mascarado); a forma **Fiado não
   aparece** no pagamento; o painel **Estoque** abre só para leitura, sem botões de entrada ou ajuste.
4. Repetir 1 a 3 no aparelho 2 com `HOMOLOG Operador B` (o caixa dele aberto por ele).

**H2. Vender sem rede; vendas sobrevivem a fechar e reabrir** (critério: vendas pendentes...)

1. Aparelho 1, sem rede: três vendas.
   - 2 × `HOMOLOG Arroz`, Dinheiro, recebido R$ 50,00 (troco R$ 30,00).
   - 0,375 kg de `HOMOLOG Queijo`, PIX.
   - 1 × `HOMOLOG Excluir`, Débito, com desconto de R$ 0,50.
2. Esperado: cada recibo sai como **PENDENTE DE SINCRONIZAÇÃO**, com o código do aparelho; a busca e
   o painel Estoque mostram o saldo já descontado (Arroz 18).
3. Fechar o navegador, reabrir o `/pdv` ainda sem rede: **Vendas deste aparelho** lista as três como
   "Pendente de envio"; o saldo continua descontado.
4. No aparelho do gerente, conferir que nada chegou: o Relatório de Vendas não tem essas vendas.

**H3. Carrinho em montagem sobrevive a fechar e reabrir** (critério: carrinho em montagem...)

1. Aparelho 1, sem rede: montar um carrinho com 1 × Arroz, `HOMOLOG Cliente` e desconto de
   R$ 1,00. Recarregar; depois fechar e reabrir o navegador.
2. Esperado: o carrinho volta com itens, cliente e desconto ("Carrinho da venda em andamento
   restaurado"). Abrir **Finalizar Venda**, escolher PIX, recarregar: volta na tela de pagamento.
3. Confirmar a venda. Recarregar logo depois: o carrinho está **vazio** (a venda não volta).

**H4. Reconectar: uma venda para cada operação** (critério: uma única venda...)

1. Religar a rede do aparelho 1. Esperado: em até 30 s as vendas ficam "Sincronizada" e o recibo
   (em Vendas deste aparelho) passa a mostrar **VENDA #código**.
2. Painel (gerente): Relatório de Vendas com as 4 vendas do H2 e H3, na **hora em que foram feitas**
   (não na hora da reconexão), operador A, caixa do operador A; Estoque: Arroz 17 e movimentações
   uma vez cada.
3. Consulta de conferência (deve voltar **zero linhas**: nenhuma operação com mais de uma venda):

   ```sql
   select o.id, count(s.id) from "SyncOperation" o join "Sale" s on s.id = o."saleId"
   group by o.id having count(s.id) > 1;
   ```

4. Cliques repetidos e duas abas: com rede, abrir o `/pdv` em **duas abas** do aparelho 1 e, em cada
   uma, finalizar uma venda apertando **F10 duas vezes seguidas** na confirmação. Esperado: duas
   vendas no total (uma por aba), nunca quatro.

**H5. Servidor fora do ar com internet; resposta perdida** (critério: cota, banco indisponível...)

1. Aparelho 1 (Chrome do computador), com rede: DevTools → **Network request blocking** → bloquear
   `*/api/offline/*`. Fazer uma venda.
2. Esperado: recibo PENDENTE DE SINCRONIZAÇÃO; a venda fica "Falha ao enviar" ou "Pendente de envio"
   com a mensagem de que nada foi gravado; nada no servidor.
3. Tirar o bloqueio e clicar **Sincronizar**: a venda chega uma vez.
4. Resposta perdida: com rede, clicar **Confirmar Venda** e desligar a rede do aparelho logo em
   seguida. Religar depois de 1 min: uma única venda no servidor, mesmo que o recibo tenha saído
   provisório.

**H6. Preço alterado e produto excluído enquanto o aparelho estava sem rede** (critérios:
atualizações e exclusões; preço alterado, produto removido)

1. Aparelho 1 sem rede. No painel (gerente): mudar o preço de `HOMOLOG Arroz` para R$ 12,00 e
   **excluir** `HOMOLOG Excluir`.
2. Aparelho 1, ainda sem rede: vender 1 × Arroz (sai a R$ 10,00) e 1 × `HOMOLOG Excluir`.
3. Religar a rede. Esperado: as vendas são aceitas **com o preço praticado** (R$ 10,00), e a
   Sincronização offline → **Pendências** mostra "Preço diferente do atual". Depois da
   sincronização, o `/pdv` mostra Arroz a R$ 12,00 e não acha mais `HOMOLOG Excluir`; nenhuma
   venda pendente sumiu.
4. Montar um carrinho com Arroz **antes** de reconectar, reconectar, esperar sincronizar e
   recarregar: o carrinho volta com aviso de preço novo.

**H7. Dois terminais com o último saldo** (critério: estoque disputado)

1. Aparelhos 1 e 2 preparados (operadores A e B), os dois sem rede.
2. Cada um vende 1 × `HOMOLOG Último` (estoque 1).
3. Religar os dois. Esperado: as **duas** vendas entram, o estoque fica **-1** (em destaque) e
   aparece a pendência "Estoque negativo". O gerente dá ciência (**Dar ciência**) ou faz o ajuste
   de estoque.

**H8. Caixa fechado enquanto o aparelho estava sem rede** (critério: caixa fechado)

1. Aparelho 1, sem rede: vender 1 × Arroz em dinheiro.
2. No próprio aparelho 1, com rede só no painel: **Fechar Caixa** fica bloqueado com atalho para o
   `/pdv` enquanto houver venda pendente deste navegador.
3. Em outro aparelho, o operador A (ou o gerente) fecha o caixa do operador A. Esperado: o
   fechamento **avisa** que o aparelho 1 pode ter vendas guardadas (ou está sem contato), sem
   bloquear.
4. Religar o aparelho 1. Esperado: a venda vai para o **caixa original** como "Venda depois do
   fechamento"; o resumo do fechamento não muda; o detalhe do caixa mostra o ajuste pós-fechamento.
   O `/pdv` pede **Preparar para o novo caixa** depois que o caixa estiver aberto de novo.

**H9. Fiado bloqueado offline** (critério: Fiado bloqueado)

1. Com o Fiado permitido na loja: no `/pdv`, com e sem rede, a forma Fiado não aparece.
2. No `/admin/pdv` (online), o Fiado continua disponível para `HOMOLOG Cliente`.

**H10. Operador desativado, envio assistido e aparelho revogado** (critério: operador inativo...)

1. Aparelho 1, operador A, sem rede: duas vendas.
2. Gerente, em outro aparelho: desativar `HOMOLOG Operador A` em Usuários.
3. Religar o aparelho 1. Esperado: o operador A não consegue enviar; ao recarregar cai em
   `/login?sessao=invalida`, com a explicação. As vendas continuam no aparelho.
4. No mesmo navegador, entrar como `HOMOLOG Gerente` e abrir o `/pdv`: botão **2 de outros
   operadores** → **Enviar para conferência**. Esperado: as duas vendas viram conflito "Enviada pelo
   gerente" em Sincronização offline → Conflitos, com o operador A como autor e o gerente como quem
   enviou.
5. **Aprovar** uma: a venda é gravada com o operador A e o caixa original. **Descartar** a outra:
   ela some da fila e devolve a reserva de estoque.
6. Reativar o operador A. Na aba **Aparelhos**, **Revogar** o aparelho 2; vender sem rede no
   aparelho 2 e reconectar: a venda vira conflito "Aparelho revogado".

**H11. Troca de usuário com fila e sessão expirada** (critério: sessão expirada; autoria e
isolamento)

1. Aparelho 1, operador A, sem rede: uma venda. **Encerrar neste aparelho** → **Encerrar**.
2. Religar a rede e entrar como `HOMOLOG Operador B` no mesmo navegador. Esperado: B não vê produtos
   nem vendas de A até preparar; a venda de A não é enviada em nome de B.
3. Entrar de novo como A: a venda de A é enviada com a autoria de A.
4. Sessão expirada: Chrome do computador, DevTools → Application → Cookies → apagar **só** o cookie
   `__Secure-authjs.session-token`. Fazer uma venda e clicar Sincronizar. Esperado: "Sessão
   expirada: entre de novo..."; a venda continua guardada; depois de entrar, ela é enviada.

**H12. Valores, troco, unidades fracionadas e datas** (critério: dinheiro, desconto/troco...)

1. Sem rede: venda com 0,375 kg de Queijo e 3 × Arroz, desconto R$ 0,75, Dinheiro com R$ 100,00.
2. Anotar subtotal, desconto, total e troco do recibo provisório.
3. Depois de sincronizar, conferir os mesmos valores no recibo oficial, no Relatório de Vendas e no
   detalhe do caixa (sem diferença de centavo). A data e a hora são as da venda, no fuso da loja.

**H13. Atualização do app com a fila cheia** (critério: atualização do app; item "dois builds
trocando `_next/static`")

1. Com o `/pdv` preparado e **duas vendas pendentes sem rede**, publicar um deploy novo (o próximo
   merge real na `main`; um _Redeploy_ do mesmo commit não troca a versão).
2. Religar a rede. Esperado: aparece **Atualizar o app**; ao atualizar, as vendas pendentes
   continuam na fila e são enviadas uma vez; o PDV abre sem rede logo depois, já na versão nova.

**H14. Câmera do Android sem rede** (item "aparelho Android real")

1. Aparelho 2, sem rede: ler o EAN da embalagem real de `HOMOLOG Arroz` pela câmera. Esperado: o
   item entra no carrinho; a venda segue pela fila.

**H15. Economia de bateria e armazenamento do Android** (item "armazenamento, economia de bateria")

1. Aparelho 2 com a economia de bateria ligada e vendas pendentes: deixar o Chrome em segundo plano
   por 15 min, com a tela apagada.
2. Esperado: ao voltar, o PDV continua aberto ou abre sem rede, com as vendas pendentes.
3. Chrome → Configurações do site do domínio: o armazenamento aparece em uso. Anotar o tamanho.

**H16. Cota de armazenamento** (item "cota real do navegador")

1. Chrome do computador, DevTools → Application → Storage → **Simulate custom storage quota** com um
   valor pouco acima do uso atual (anotado no H15 ou na mesma tela).
2. Sem rede, fazer vendas até a gravação falhar. Esperado: aparece "Sem espaço no aparelho...", o
   **carrinho é mantido**, nenhum recibo sai para a venda que falhou, e ao tirar a simulação a
   nova tentativa grava uma única venda.

**H17. Validade de 12 h e dados de até 24 h** (opcional, depende de esperar)

1. Deixar o aparelho 1 preparado de um dia para o outro. No dia seguinte, sem rede: o `/pdv` mostra
   "Autorização sem internet vencida" e **não deixa vender**.
2. Com rede: **Renovar** prepara de novo e as vendas antigas (se houver) são enviadas.

**H18. Desempenho com o catálogo real** (item "desempenho com o catálogo real")

1. Com o catálogo real cadastrado, preparar um aparelho e anotar o tempo até o PDV abrir.
   Referência: até 1 min no Wi-Fi da loja.
2. Sem rede, a busca por nome e por código de barras responde sem atraso perceptível; anotar o uso
   de armazenamento (H15).

**H19. Fluxos online continuam funcionando** (critério: fluxos online)

1. Checklist de fumaça da seção 6 e uma venda pelo `/admin/pdv` com cada forma de pagamento,
   inclusive Fiado.

### 10.3 Depois da homologação

- [ ] Preencher a coluna Homologação da tabela 9.1 do `docs/OFFLINE.md` (OK com data e aparelho, ou
      o número da issue aberta para a falha).
- [ ] Fechar os caixas `HOMOLOG`, revogar os aparelhos de teste (aba Aparelhos), desativar os
      usuários `HOMOLOG` e excluir os produtos e o cliente `HOMOLOG`.
- [ ] Aplicar a decisão de 10.1 sobre os registros (restaurar o backup da Neon só se não houve
      operação real no meio). Sem restauração, apagar o branch de backup quando não for mais útil.
- [ ] Com todos os critérios OK (ou cada falha com issue e decisão registrada), fechar a #33.

## 11. Dados de teste e restauração do banco (#57, #67)

Em **Configurações da Loja**, a seção "Dados de teste" (só ADMIN) tem três ações. As regras estão no
`docs/OFFLINE.md` (seções 3.7 e 5) e no código em `src/lib/test-data.ts`.

**A seção só existe com `ENABLE_STORE_TEST_TOOLS=true` (#67).** Sem a variável, que é o padrão e o
caso da produção, a seção não aparece e as três ações são recusadas no servidor, inclusive em
chamadas diretas. Para demonstração ou treinamento, ligue a variável só no ambiente de teste
(`.env` local ou um deploy separado com banco descartável). Nunca na Vercel de produção.

- **Gerar dados de teste:** cria até 15 categorias, 50 produtos (com estoque inicial como entrada de
  um fornecedor gerado), 10 clientes e 5 fornecedores, sem alterar cadastros existentes. Os
  produtos ficam fora do catálogo público. Clientes e fornecedores gerados não têm CPF/CNPJ (um
  documento aleatório pode pertencer a uma pessoa real). Cada registro guarda o id da geração
  (`testDataRunId`).
- **Remover dados gerados:** tira só os registros marcados, com as regras da exclusão manual.
  Produtos, categorias e clientes saem por exclusão lógica (os aparelhos do PDV recebem a exclusão
  na sincronização). As entradas de estoque geradas são apagadas. Ficam os gerados ainda em uso por
  dados reais: categoria com produto real ativo, cliente com Fiado em aberto e fornecedor com
  entrada real. Vendas, títulos e cadastros reais não mudam. Registros gerados antes da migration
  `0012_test_data_marker` não têm marcação e não são removidos por aqui.
- **Restaurar banco:** apaga vendas, caixas, fiado, estoque, produtos, categorias, clientes,
  fornecedores, aparelhos e operações offline. Mantém usuários, configurações da loja e o histórico
  da seção. A numeração das vendas volta a 1. **É irreversível.**

### 11.1 Migration

O recurso precisa das migrations `0011_test_data_runs` (tabela `TestDataRun`) e
`0012_test_data_marker` (valor `CLEANUP` no enum e a coluna opcional `testDataRunId` em
`Category`, `Product`, `Customer`, `Supplier` e `StockMovement`). Nenhuma altera dados existentes.
A `0012` precisa estar aplicada **antes** do merge da #67: o código novo lê a coluna em toda
consulta desses cadastros, com a seção ligada ou não. Aplicar em produção pelo roteiro da seção 4 **antes** do merge que publica o
código, com um branch de backup da Neon criado antes. Conferência (console SQL da Neon, só
leitura):

```sql
select migration_name, finished_at from "_prisma_migrations" order by migration_name;
```

### 11.2 Antes de restaurar em produção

- [ ] Confirmar com o responsável pela loja que os dados podem ser apagados.
- [ ] Criar um branch de backup na Neon (ou anotar o instante para a restauração por ponto no
      tempo). O sistema não guarda cópia.
- [ ] Fechar todos os caixas e sincronizar os aparelhos do PDV sem internet: a restauração é
      recusada com caixa aberto ou aparelho que informou vendas não enviadas, e a tela lista os
      impedimentos. Venda guardada num aparelho que nunca avisou o servidor volta como conflito na
      conciliação.
- [ ] Na confirmação, digitar o nome fantasia da loja e a senha do ADMIN. Cinco tentativas erradas
      bloqueiam a ação por 15 minutos (contadas uma a uma, também em pedidos simultâneos).
- [ ] Depois: preparar de novo cada aparelho do PDV sem internet (eles recebem a carga completa e
      os registros dos aparelhos foram apagados) e conferir o histórico da seção.
