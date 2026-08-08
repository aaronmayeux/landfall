#!/usr/bin/env bash
#
# with-server.sh — run a command with the app served on 127.0.0.1:8099.
#
# WHY THIS EXISTS
# A background process started in one shell call is gone by the next one — each
# call is its own process group and the sandbox reaps it. Measured 2026-08-08,
# after a session started a server, moved on, and spent the next several minutes
# confused about why every browser check said connection refused.
#
# So: the server and the thing that needs it must live inside ONE command. This
# starts it, runs whatever you pass, and shuts it down again on the way out —
# including if the command fails or you interrupt it.
#
#   bash tools/with-server.sh node tools/csp-check.mjs
#   bash tools/with-server.sh node tools/privacy-check.mjs
#
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1

if [ $# -eq 0 ]; then
  echo "usage: bash tools/with-server.sh <command...>" >&2
  exit 2
fi

PORT=8099
STARTED_BY_US=0

# A separate process, so the descriptor cannot leak back here and hang a pipe.
port_open() { timeout 2 bash -c "exec 3<>/dev/tcp/127.0.0.1/$PORT" 2>/dev/null; }

if port_open; then
  echo "with-server: something is already serving :$PORT — using it"
else
  python3 -m http.server "$PORT" --bind 127.0.0.1 </dev/null >/tmp/landfall-server.log 2>&1 &
  SERVER_PID=$!
  STARTED_BY_US=1
  for _ in $(seq 1 20); do
    port_open && break
    sleep 0.25
  done
  if ! port_open; then
    echo "with-server: server never came up. /tmp/landfall-server.log:" >&2
    tail -5 /tmp/landfall-server.log >&2
    exit 1
  fi
  echo "with-server: serving $PWD on 127.0.0.1:$PORT (pid $SERVER_PID)"
fi

cleanup() {
  if [ "$STARTED_BY_US" = "1" ] && [ -n "${SERVER_PID:-}" ]; then
    kill "$SERVER_PID" 2>/dev/null
    wait "$SERVER_PID" 2>/dev/null
  fi
}
trap cleanup EXIT INT TERM

"$@"
