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
   - `AUTH_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME`.
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
- [ ] Login com o administrador.
- [ ] Configurações da Loja: salvar nome, CNPJ e endereço.
- [ ] Produtos: cadastrar um produto com estoque inicial → aparece em Estoque como "Estoque inicial".
- [ ] Caixa: abrir com suprimento inicial.
- [ ] PDV: venda em dinheiro (com troco) e venda no Fiado para um cliente; recibo abre e imprime.
- [ ] Contas a Receber: título do fiado aparece; registrar um recebimento.
- [ ] Caixa: fechar com o valor contado; fechamento aparece no histórico.
- [ ] Dashboard e Relatório de Vendas mostram as vendas do dia.
- [ ] `/vendor/zxing/zxing_reader-<versão>.wasm` responde 200 (o `postinstall` rodou no build).
- [ ] Celular: ler um EAN pela câmera no PDV (HTTPS de produção).

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
