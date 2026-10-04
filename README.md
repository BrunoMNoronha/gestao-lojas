# Gestão de Lojas — ERP / PDV

Sistema de gestão comercial e frente de caixa (PDV) para lojas físicas, distribuidores,
agropecuárias e mercados.

**Módulos:** autenticação · produtos e categorias · clientes e fornecedores · PDV · estoque e
movimentações · caixa (abertura, sangrias, fechamento) · contas a receber (fiado) · dashboard e
relatório de vendas.

**Stack:** Next.js 16 (App Router) · TypeScript · Prisma 6 + PostgreSQL · Auth.js v5 ·
Tailwind CSS v4 + Shadcn UI · pnpm.

## Rodando localmente

Pré-requisitos: Node.js 20+, pnpm e um PostgreSQL.

```bash
pnpm install
cp .env.example .env        # ajuste DATABASE_URL / DIRECT_URL e AUTH_SECRET
pnpm db:migrate             # aplica as migrations no banco local
pnpm dev                    # http://localhost:3000
```

No primeiro login, se o banco não tiver usuários, o administrador é criado a partir de
`ADMIN_EMAIL` / `ADMIN_PASSWORD` (em desenvolvimento, sem essas variáveis, é criado o admin local
descrito em `.env.example`).

## Comandos

| Comando                         | Uso                                           |
| ------------------------------- | --------------------------------------------- |
| `pnpm dev`                      | Servidor de desenvolvimento                   |
| `pnpm build`                    | Build de produção e checagem de tipos         |
| `pnpm db:migrate --name <nome>` | Cria e aplica uma migration (desenvolvimento) |
| `pnpm db:deploy`                | Aplica migrations pendentes (produção)        |
| `pnpm test:integration`         | Testes de integração com PostgreSQL real      |
| `pnpm test:unit`                | Testes unitários (fila do PDV, sem banco)     |
| `pnpm test:e2e`                 | Build + testes de navegador (Playwright)      |

## Testes

Os testes de integração (`tests/integration/`) usam um PostgreSQL real e **descartável**: o
`TEST_DATABASE_URL` precisa apontar para um banco local com `test` no nome (outros são recusados),
porque as tabelas são apagadas entre os testes. As migrations são aplicadas automaticamente.

```bash
docker run --rm -d --name gestao-lojas-test -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=gestao_lojas_test -p 127.0.0.1:55432:5432 postgres:17-alpine
TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:55432/gestao_lojas_test" pnpm test:integration
docker stop gestao-lojas-test
```

No PowerShell, defina antes `$env:TEST_DATABASE_URL = "postgresql://..."` e rode
`pnpm test:integration`.

Os testes unitários (`tests/unit/`, `pnpm test:unit`) não usam banco: cobrem a fila de vendas do
PDV sem internet com o IndexedDB simulado pelo `fake-indexeddb` e o saldo da consulta de estoque.

### Testes de navegador

Os cenários offline de ponta a ponta (`tests/e2e/`, Playwright) rodam contra o **build de
produção** (`next start` na porta 3200), porque o Service Worker só existe nele, com o mesmo banco
descartável dos testes de integração (`TEST_DATABASE_URL`). O login usa o reCAPTCHA de produção com
o `siteverify` do Google simulado no servidor (`tests/e2e/support/mock-siteverify.mjs`); nenhuma
chave real é necessária.

```bash
pnpm exec playwright install chromium
TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:55432/gestao_lojas_test" pnpm test:e2e
```

`pnpm test:e2e` faz o build e roda tudo; `pnpm test:e2e:run` roda sem refazer o build. O relatório
fica em `playwright-report/` e os rastros das falhas em `test-results/`.

Cada cenário roda em três navegadores: `chromium`, `msedge` (o Edge instalado na máquina) e
`android` (Chrome no Android emulado). Para rodar só um, use `--project`, por exemplo
`pnpm test:e2e:run --project=chromium`. A câmera do leitor de código de barras é simulada com um
vídeo gerado no início da suíte. O que cada camada de teste comprova, e o que fica para a
homologação, está em `docs/OFFLINE.md`, seção 9.1.

## PDV sem internet

O app é instalável (manifest e Service Worker com Serwist). Em `/pdv`, o operador com o caixa aberto
prepara o aparelho uma vez com internet; depois o PDV abre e consulta produtos e clientes sem
conexão por até 12 horas, com os dados da última sincronização. Toda venda do `/pdv` é gravada
no aparelho e enviada ao servidor na hora, se houver conexão, ou quando ela voltar; o recibo sai
provisório até a venda ser sincronizada. O carrinho em montagem também fica no aparelho: recarregar
ou reabrir o `/pdv` traz o carrinho de volta. Conflitos, pendências e aparelhos ficam em
**Sincronização offline** (`/admin/sincronizacao`, ADMIN e MANAGER). O Service Worker só é
registrado no build de produção
(`pnpm build` / `pnpm start`); em `pnpm dev` ele fica desligado. Detalhes em
[`docs/OFFLINE.md`](docs/OFFLINE.md).

**Instalar o app:** use "Instalar app Gestão Lojas" no menu do painel ou no cabeçalho do `/pdv`
(Chrome e Edge abrem a janela de instalação). Quando o navegador não oferece a janela, o botão vira
"Como instalar o app", com o passo a passo da plataforma (no iPhone/iPad: Compartilhar → Adicionar à
Tela de Início). Instalar não prepara o PDV para uso sem internet: a preparação continua no `/pdv`,
com conexão. Detalhes em [`docs/OFFLINE.md`](docs/OFFLINE.md), seção 6.1.1.

## Documentação

- [`AGENTS.md`](AGENTS.md) — convenções para agentes de IA e desenvolvedores
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — arquitetura e modelo de dados
- [`docs/DEPLOY.md`](docs/DEPLOY.md) — deploy em produção (Vercel + Neon)
- [`docs/OFFLINE.md`](docs/OFFLINE.md) — decisões e arquitetura da operação offline (#33)
