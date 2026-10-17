# Ambiente de DESENVOLVIMENTO em um único container: PostgreSQL 17 + Node 24 (next dev).
# Não use para produção (produção roda na Vercel + Neon, ver docs/DEPLOY.md).
# O código é copiado na imagem e mantido em dia pelo `docker compose up --watch` (develop.watch).
FROM node:24-bookworm-slim AS node

FROM postgres:17-bookworm

# Node + npm + corepack copiados da imagem oficial do Node
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/corepack/dist/corepack.js /usr/local/bin/corepack \
    && ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

# openssl: exigido pelos binários do Prisma; ca-certificates: download dos pacotes/engines
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# pnpm é o gerenciador obrigatório do projeto (AGENTS.md)
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@12.10.1 --activate

COPY docker/dev/entrypoint.sh /usr/local/bin/dev-entrypoint.sh
RUN chmod +x /usr/local/bin/dev-entrypoint.sh

WORKDIR /app

# Dependências numa camada própria: só reinstala quando package.json / pnpm-lock.yaml mudam.
# O postinstall roda `prisma generate` e copia o WASM do ZXing, por isso prisma/ e scripts/ vêm junto.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma
COPY scripts ./scripts
RUN --mount=type=cache,target=/pnpm-store \
    CI=true pnpm install --frozen-lockfile --store-dir /pnpm-store

COPY . .

EXPOSE 3000 5432
ENTRYPOINT ["/usr/local/bin/dev-entrypoint.sh"]
