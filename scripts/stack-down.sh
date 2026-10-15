#!/usr/bin/env bash
# Stops only the processes scripts/stack-up.sh started (by recorded PID), never by name.
HERE="$(cd "$(dirname "$0")/.." && pwd)"
for name in backend frontend; do
  pidfile="$HERE/.stack/$name.pid"
  [ -f "$pidfile" ] || continue
  pid="$(cat "$pidfile")"
  if kill -0 "$pid" 2>/dev/null; then
    # npm spawns children; stop the whole group where possible
    pkill -P "$pid" 2>/dev/null || true
    kill "$pid" 2>/dev/null && echo "Stopped $name (pid $pid)"
  fi
  rm -f "$pidfile"
done
