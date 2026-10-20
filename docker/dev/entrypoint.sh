#!/usr/bin/env bash
# Sobe o PostgreSQL e o `next dev` no mesmo container (somente desenvolvimento).
set -euo pipefail

log() { echo "[dev-entrypoint] $*"; }

# ── PostgreSQL ────────────────────────────────────────────────────────────────
# O entrypoint oficial da imagem faz o initdb e cria POSTGRES_DB no primeiro boot.
docker-entrypoint.sh postgres &
pg_pid=$!
app_pid=""

shutdown() {
  log "encerrando..."
  [ -n "$app_pid" ] && kill -TERM "$app_pid" 2>/dev/null || true
  kill -INT "$pg_pid" 2>/dev/null || true
  wait "$pg_pid" 2>/dev/null || true
  exit 0
}
trap shutdown TERM INT

log "aguardando o PostgreSQL..."
for _ in $(seq 1 60); do
  if pg_isready -q -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"; then break; fi
  if ! kill -0 "$pg_pid" 2>/dev/null; then log "o PostgreSQL parou ao iniciar"; exit 1; fi
  sleep 1
done
pg_isready -q -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" || { log "PostgreSQL não respondeu em 60s"; exit 1; }
log "PostgreSQL pronto."

# ── Migrations ────────────────────────────────────────────────────────────────
# prisma/ é montado da pasta do projeto: o client é regerado caso o schema tenha mudado.
log "gerando o Prisma Client e aplicando migrations..."
pnpm prisma generate >/dev/null
pnpm db:deploy

# ── Next.js ───────────────────────────────────────────────────────────────────
log "iniciando next dev (porta 3000 do container)"
pnpm dev --hostname 0.0.0.0 --port 3000 &
app_pid=$!

# Se o app ou o banco cair, derruba o container (o compose mostra o erro)
wait -n "$app_pid" "$pg_pid"
status=$?
log "um dos processos terminou (código $status)"
shutdown
