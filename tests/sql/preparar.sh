#!/usr/bin/env bash
# ======================================================================
# preparar.sh — Levanta un PostgreSQL local y monta la base de Smart Hub.
#
# Las pruebas SQL necesitan un PostgreSQL de verdad: RLS no se evalúa
# para el superusuario, y leer los .sql no demuestra que una policy se
# aplique. Esto deja una base lista para `npm run test:sql`.
#
#   bash tests/sql/preparar.sh
#   npm run test:sql
#
# Si ya tienes un PostgreSQL propio, sáltate esto y exporta PGURL:
#   PGURL=postgres://usuario@host:5432/labase npm run test:sql
#
# NO usa el proyecto de Supabase: todo es local y desechable.
# ======================================================================
set -euo pipefail

PUERTO="${PGPUERTO:-5433}"
BASE="${PGBASE:-app}"
DATOS="${PGDATOS:-/var/lib/postgresql/smarthub-test}"
BIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)"
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if [ -z "$BIN" ]; then
  echo "❌ No encuentro PostgreSQL. Instálalo:  apt-get install -y postgresql" >&2
  exit 1
fi

# initdb y postgres se niegan a correr como root, con razón.
correr() {
  if [ "$(id -u)" = "0" ]; then su postgres -s /bin/bash -c "$1"; else bash -c "$1"; fi
}

if ! pg_isready -h /tmp -p "$PUERTO" >/dev/null 2>&1; then
  echo "▸ Levantando PostgreSQL en el puerto $PUERTO…"
  rm -rf "$DATOS"
  [ "$(id -u)" = "0" ] && { mkdir -p "$DATOS"; chown postgres:postgres "$DATOS"; }
  correr "$BIN/initdb -D $DATOS -A trust -U postgres" >/dev/null
  correr "$BIN/pg_ctl -D $DATOS -o '-p $PUERTO -k /tmp' -l $DATOS/log start" >/dev/null
  sleep 2
fi

echo "▸ Montando la base «$BASE»…"
psql -h /tmp -p "$PUERTO" -U postgres -tAc "drop database if exists $BASE" >/dev/null
psql -h /tmp -p "$PUERTO" -U postgres -tAc "create database $BASE" >/dev/null

# El orden importa: auth simulado primero (schema.sql depende de él),
# y las restricciones después de las funciones que validan.
for f in \
  supabase/local/auth-simulado.sql \
  supabase/schema.sql \
  supabase/policies.sql \
  supabase/seguridad.sql \
  supabase/restricciones.sql \
  supabase/caducidad.sql \
  supabase/seed.sql
do
  printf '  %-40s' "$f"
  if psql -h /tmp -p "$PUERTO" -U postgres -d "$BASE" -v ON_ERROR_STOP=1 -q -f "$RAIZ/$f" 2>/tmp/pgerr; then
    echo "ok"
  else
    echo "FALLA"; cat /tmp/pgerr >&2; exit 1
  fi
done

echo ""
echo "✅ Base lista:  PGURL=postgres://postgres@localhost:$PUERTO/$BASE"
psql -h /tmp -p "$PUERTO" -U postgres -d "$BASE" -tAc \
  "select '   ' || count(*) || ' espacios · ' || count(*) filter (where reservable) || ' reservables' from public.espacios"
