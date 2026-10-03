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

## Documentação

- [`AGENTS.md`](AGENTS.md) — convenções para agentes de IA e desenvolvedores
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — arquitetura e modelo de dados
- [`docs/DEPLOY.md`](docs/DEPLOY.md) — deploy em produção (Vercel + Neon)
- [`docs/OFFLINE.md`](docs/OFFLINE.md) — decisões e arquitetura da operação offline (#33)
