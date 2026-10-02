<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# 🤖 Guia para Agentes de IA - Sistema de Gestão de Lojas (ERP / PDV)

Este repositório contém um sistema de gestão comercial e frente de caixa (PDV) genérico, objetivo, *clean* e profissional, voltado para lojas físicas, distribuidores, agropecuárias e mercados.

## 🛠️ Tech Stack & Ferramentas
- **Framework:** Next.js 16 (App Router)
- **Linguagem:** TypeScript
- **Gerenciador de Pacotes:** `pnpm` (OBRIGATÓRIO: NUNCA use `npm` ou `yarn`)
- **Estilização:** Tailwind CSS v4 + Shadcn UI
- **Banco de Dados & ORM:** PostgreSQL + Prisma ORM
- **Autenticação:** Auth.js v5 (`next-auth`)
- **Formatação:** Prettier + `prettier-plugin-tailwindcss`

---

## ⚡ Comandos Essenciais

```bash
# Servidor de Desenvolvimento
pnpm dev

# Build de Produção & Validação de Tipos
pnpm build

# Gerar Prisma Client
pnpm prisma generate

# Criar migration após alterar prisma/schema.prisma (desenvolvimento)
pnpm db:migrate --name <descricao>

# Aplicar migrations pendentes (produção / CI) — nunca use `db push` em produção
pnpm db:deploy

# Adicionar novos componentes Shadcn UI
npx shadcn@latest add <componente>
```

---

## 📂 Estrutura do Projeto

```
gestao-lojas/
├── prisma/
│   └── schema.prisma          # Schema do banco de dados (User, Product, StoreSettings, etc.)
├── src/
│   ├── actions/               # Server Actions (mutações e consultas do servidor)
│   ├── app/
│   │   ├── (auth)/            # Rotas de autenticação (login, etc.)
│   │   ├── admin/             # Módulo administrativo (dashboard, produtos, configurações)
│   │   │   ├── configuracoes/ # Tela de parametrização da loja
│   │   │   └── page.tsx       # Dashboard principal
│   │   ├── layout.tsx         # Root Layout
│   │   └── page.tsx           # Página inicial
│   ├── components/
│   │   ├── ui/                # Componentes Shadcn UI (button, card, input, table...)
│   │   ├── admin-sidebar.tsx  # Navegação lateral do painel admin
│   │   └── store-settings-form.tsx # Formulário de parametrização da loja
│   └── lib/
│       ├── prisma.ts          # Singleton do Prisma Client
│       └── utils.ts           # Utilitários (cn, formatadores, etc.)
```

---

## 📏 Convenções de Código para Agentes

1. **Gerenciador de Pacotes:** Use **exclusivamente `pnpm`**.
2. **Server vs Client Components:**
   - Mantenha componentes como **Server Components** por padrão.
   - Adicione `"use client"` apenas onde houver estado interativo (`useState`, `useEffect`, manipuladores de eventos).
3. **Mutações de Dados:**
   - Utilize **Next.js Server Actions** (`"use server"`) na pasta `src/actions/`.
   - Sempre utilize `revalidatePath()` após mutações no banco para atualizar o cache do Next.js.
4. **Tratamento de Erros e Fallbacks:**
   - Adicione blocos `try/catch` nas Server Actions e forneça fallbacks amigáveis caso o banco ou serviço falhe.
   - Nunca quebre a renderização de páginas no servidor por falta de conexão inicial com o banco.
5. **Estilização:**
   - Utilize Tailwind CSS com classes semânticas e o componente `cn()` de `@/lib/utils` para mesclar classes.
6. **Autorização (obrigatório):**
   - A matriz de acesso por perfil (ADMIN / MANAGER / SELLER) fica em `src/lib/permissions.ts`, e o mapa de rotas e menu em `src/lib/routes.ts`.
   - Toda Server Action exportada começa com `const authz = await authorize("<permissão>")` (`src/lib/authz.ts`) e retorna erro ou vazio quando `!authz.ok`. Confira com `pnpm check:actions`.
   - Toda página de `/admin` chama `await requirePageAccess("<permissão>")`. Nova rota no menu = nova entrada em `APP_ROUTES`.
   - O `src/proxy.ts` só redireciona quem não está logado; nunca dependa dele para permissão.

---

## 📌 Links Úteis
- **Repositório GitHub:** [BrunoMNoronha/gestao-lojas](https://github.com/BrunoMNoronha/gestao-lojas)
- **Roadmap de Issues:** [GitHub Issues](https://github.com/BrunoMNoronha/gestao-lojas/issues)
