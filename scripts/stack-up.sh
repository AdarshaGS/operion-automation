#!/usr/bin/env bash
# Brings up a *fresh, disposable* Operion stack for this suite: new databases, backend jar on
# :8091, Vite dev server on :5184 pointed at it. A fresh database every run is required while
# Operion's tenant-scoping bug on generated student ids is open (GitHub #354: a second
# organisation cannot admit its first student in a database that already has one).
#
# Never touches Operion's own dev/e2e ports (8080/8090/5173/5183) or databases.
#
#   OPERION_HOME   path to the Operion checkout        (default: ../Operion)
#   OPERION_JAR    backend jar to run                  (default: $OPERION_HOME/build/libs/operion-0.0.1-SNAPSHOT.jar)
#   AUTO_API_PORT / AUTO_UI_PORT                       (default: 8091 / 5184)
#   MYSQL_USER / MYSQL_PASSWORD                        (default: root / empty)
#   SKIP_UI=1      skip starting the frontend (API-only runs)
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
OPERION_HOME="${OPERION_HOME:-$HERE/../Operion}"
OPERION_JAR="${OPERION_JAR:-$OPERION_HOME/build/libs/operion-0.0.1-SNAPSHOT.jar}"
API_PORT="${AUTO_API_PORT:-8091}"
UI_PORT="${AUTO_UI_PORT:-5184}"
MYSQL_USER="${MYSQL_USER:-root}"
MYSQL_PASSWORD="${MYSQL_PASSWORD:-}"
DB="operion_auto"
STACK_DIR="$HERE/.stack"
mkdir -p "$STACK_DIR"

[ -f "$OPERION_JAR" ] || { echo "Backend jar not found: $OPERION_JAR (run ./gradlew bootJar in Operion, or set OPERION_JAR)"; exit 1; }
if [ -n "$(find "$OPERION_HOME/src/main" -type f -newer "$OPERION_JAR" 2>/dev/null | head -1)" ]; then
  echo "WARNING: Operion source is newer than $OPERION_JAR - you'd be testing an OLDER build than your working tree."
  echo "         Run './gradlew bootJar' in Operion first (or point OPERION_JAR at a fresh copy)."
fi
for port in "$API_PORT" "$UI_PORT"; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port $port is already in use - run scripts/stack-down.sh first (or pick another port)."; exit 1
  fi
done

echo "==> Recreating databases ${DB} and ${DB}_platform"
MYSQL=(mysql -u"$MYSQL_USER"); [ -n "$MYSQL_PASSWORD" ] && MYSQL+=(-p"$MYSQL_PASSWORD")
"${MYSQL[@]}" -e "DROP DATABASE IF EXISTS ${DB}; DROP DATABASE IF EXISTS ${DB}_platform; CREATE DATABASE ${DB} CHARACTER SET utf8mb4; CREATE DATABASE ${DB}_platform CHARACTER SET utf8mb4;"

echo "==> Starting backend on :$API_PORT (log: .stack/backend.log)"
SERVER_PORT="$API_PORT" \
APP_CORS_ALLOWED_ORIGINS="http://localhost:$UI_PORT" \
DB_URL="jdbc:mysql://localhost:3306/${DB}?allowPublicKeyRetrieval=true" \
PLATFORM_DB_URL="jdbc:mysql://localhost:3306/${DB}_platform?allowPublicKeyRetrieval=true" \
DB_USERNAME="$MYSQL_USER" DB_PASSWORD="$MYSQL_PASSWORD" \
REPORTING_DB_URL="jdbc:mysql://localhost:3306/${DB}?allowPublicKeyRetrieval=true" \
REPORTING_DB_USERNAME="${REPORTING_DB_USERNAME:-reporting_ro}" REPORTING_DB_PASSWORD="${REPORTING_DB_PASSWORD:-changeme-reporting-ro}" \
JWT_SECRET=dev-only-secret-change-me-before-any-real-deployment-32bytes-min \
PLATFORM_JWT_SECRET=dev-only-platform-secret-change-me-before-any-real-deployment-32b \
BACKUP_DIR="$STACK_DIR/backups" \
SPRING_PROFILES_ACTIVE=dev \
APP_DEV_LOGAUTHTOKENS=true \
  nohup java -jar "$OPERION_JAR" >"$STACK_DIR/backend.log" 2>&1 </dev/null &
echo $! >"$STACK_DIR/backend.pid"

if [ -z "${SKIP_UI:-}" ]; then
  echo "==> Starting frontend on :$UI_PORT (log: .stack/frontend.log)"
  (cd "$OPERION_HOME/web" && VITE_API_BASE_URL="http://localhost:$API_PORT" nohup npm run dev -- --port "$UI_PORT" --strictPort >"$STACK_DIR/frontend.log" 2>&1 </dev/null & echo $! >"$STACK_DIR/frontend.pid")
fi

echo "==> Waiting for backend health (up to 5 min)"
for _ in $(seq 1 150); do
  if curl -fs "http://localhost:$API_PORT/v3/api-docs" >/dev/null 2>&1; then
    echo "Backend ready."
    [ -z "${SKIP_UI:-}" ] && for _ in $(seq 1 30); do curl -fs "http://localhost:$UI_PORT" >/dev/null 2>&1 && break || sleep 1; done
    cat <<MSG

Stack is up. Run the suite with:
  OPERION_API_URL=http://localhost:$API_PORT OPERION_UI_URL=http://localhost:$UI_PORT npm test
(or put those two lines in .env.local-stack and 'source' it).
MSG
    exit 0
  fi
  kill -0 "$(cat "$STACK_DIR/backend.pid")" 2>/dev/null || { echo "Backend exited - see .stack/backend.log"; tail -20 "$STACK_DIR/backend.log"; exit 1; }
  sleep 2
done
echo "Backend did not become healthy in time - see .stack/backend.log"; exit 1
