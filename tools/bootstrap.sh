#!/usr/bin/env bash
#
# bootstrap.sh — get a fresh cloud session from "empty box" to "can work".
#
# AARON PASTES NOTHING. The project instructions tell the session to run this
# and the session runs it. One command, and it is idempotent — running it twice
# is harmless and fast the second time.
#
#   git clone --single-branch --branch main \
#       https://github.com/aaronmayeux/landfall.git && \
#     cd landfall && bash tools/bootstrap.sh
#
# ==> `--single-branch` MATTERS AND IS NOT DECORATION. <==
# A plain clone fetches EVERY branch, and `archive` gains 297 KB of feed
# payloads every hour forever. Without this flag, session startup gets slower
# every day for data no session has asked for yet. Fetch it on demand instead:
#     git fetch origin archive && git show origin/archive:latest/manifest.json
#
# WHAT IT DOES
#   1. Git identity              Andy (Cowork) <andy@getgravitate.app>
#   2. Push credential           found in the project note, never written to a
#                                repo file, never printed
#   3. Playwright 1.56.0         the ONLY minor matching the sandbox chromium
#   4. Static server :8099       so the browser checks have something to load
#   5. pre-push hook             check-syntax + a credential-leak scan
#   6. Prints an orientation card so the session knows what is true
#
# FLAGS
#   --no-playwright   skip step 3 (saves ~30s if this session is reading only)
#   --no-server       skip step 4
#
set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1
REPO="$PWD"

WANT_PW=1
WANT_SERVER=1
for a in "$@"; do
  case "$a" in
    --no-playwright) WANT_PW=0 ;;
    --no-server) WANT_SERVER=0 ;;
  esac
done

say() { printf '%s\n' "$*"; }
# Careful: a leaked file descriptor here will hold a pipe open and hang the
# whole command. Open, test, close.
# A subshell, so the descriptor cannot leak back into this shell and hang a
# pipe. `timeout` because a connect to a dead port can sit there.
port_open() { timeout 2 bash -c 'exec 3<>/dev/tcp/127.0.0.1/8099' 2>/dev/null; }
ok()   { printf '  ok    %s\n' "$*"; }
warn() { printf '  WARN  %s\n' "$*"; }
bad()  { printf '  FAIL  %s\n' "$*"; }

say ""
say "landfall bootstrap — $REPO"
say ""

# ---------------------------------------------------------------- 1. identity
# Deliberate and settled: commits are authored by Andy, not by the environment
# default. See claude/repo-access.md — do not "fix" this to get a Verified badge.
git config user.name  "Andy (Cowork)"
git config user.email "andy@getgravitate.app"
ok "git identity: $(git config user.name) <$(git config user.email)>"

# -------------------------------------------------------------- 2. push creds
# ==> THE PAT IS NECESSARY AND IT IS NO LONGER SUFFICIENT. READ THIS BEFORE
# DEBUGGING A FAILED PUSH. <==
#
# The Cowork sandbox MITMs all github.com traffic through a local proxy
# (https_proxy=127.0.0.1:PORT) that gates writes on a per-session ALLOWLIST OF
# REPOSITORIES. If landfall is not in that set, every push fails the same way no
# matter what credential you present:
#
#   remote: access denied by the git proxy: aaronmayeux/landfall is not in this
#   session's authorized repository set, so the proxy will not inject a
#   credential for it. To fix, add the repository to the session's sources.
#   fatal: ... The requested URL returned error: 403
#
# THAT IS NOT A TOKEN PROBLEM AND NO TOKEN FIXES IT. Measured 2026-08-08: a
# tokenized remote URL and a credential-helper file both get the identical 403,
# while `git ls-remote` succeeds — reads are anonymous and unaffected, so a
# working fetch tells you nothing about whether push will work. Aaron fixes it
# by adding aaronmayeux/landfall to the session's sources in the Cowork UI.
#
# An earlier note here said a credential-less push returns GitHub's own plain
# 401. That was true when it was written and it is not true now. Do not spend a
# session re-deriving the token setup; check the error text for the word
# "proxy" first.
#
# With the repo authorized, the PAT below is still what authenticates the push.
#
# The token is read straight out of the project note into a git config value.
# It is never echoed, never written to a tracked file, and `.git/config` is
# inside `.git`, which is not part of the working tree.
find_token() {
  local f
  for f in \
    /sessions/*/mnt/.projects/*/docs/repo-access.md \
    "$HOME"/repo-access.md \
    /mnt/user-data/*/repo-access.md
  do
    [ -f "$f" ] || continue
    grep -ohE 'github_pat_[A-Za-z0-9_]+' "$f" 2>/dev/null | head -1
    return
  done
}

if git config --get remote.push-origin.url >/dev/null 2>&1; then
  ok "push remote 'push-origin' already configured"
else
  TOKEN="$(find_token)"
  if [ -n "${TOKEN:-}" ]; then
    git remote add push-origin \
      "https://aaronmayeux:${TOKEN}@github.com/aaronmayeux/landfall.git" 2>/dev/null \
      || git remote set-url push-origin \
      "https://aaronmayeux:${TOKEN}@github.com/aaronmayeux/landfall.git"
    unset TOKEN
    ok "push remote 'push-origin' configured (token not printed)"
    say "        push with:  git push push-origin main"
  else
    warn "no credential found — 'origin' can read but CANNOT push."
    warn "the PAT lives in the project note claude/repo-access.md."
  fi
fi

# ------------------------------------------------------------- 3. playwright
# Chromium build 1194 ships at /opt/pw-browsers. Exactly one Playwright minor
# speaks to it — measured by launching each: 1.55.0 wants build 1187 and fails,
# 1.57.0 wants 1200 and fails, 1.56.0 launches. NEVER run `playwright install`;
# browser downloads are blocked by design and the binary is already there.
if [ "$WANT_PW" = "1" ]; then
  if [ -d "$REPO/node_modules/playwright" ]; then
    ok "playwright already present"
  elif [ -d /opt/pw-browsers ]; then
    if npm i --no-audit --no-fund --silent playwright@1.56.0 >/tmp/pw-install.log 2>&1; then
      ok "playwright@1.56.0 installed (matches chromium build 1194)"
    else
      warn "playwright install failed — see /tmp/pw-install.log"
    fi
  else
    warn "/opt/pw-browsers missing — not a sandbox with a chromium. Skipping."
  fi
  # package.json and node_modules are already ignored at the repo root (see
  # .gitignore, which explains at length why). Confirm rather than assume.
  if [ -n "$(git status --porcelain --untracked-files=all | grep -E 'node_modules|package(-lock)?\.json' || true)" ]; then
    bad "npm dirtied the tree — .gitignore is not covering it. Do not commit."
  fi
fi

# ---------------------------------------------------------------- 4. server
# The browser checks load the app over http, not file://. Port 8099 because
# every tool in tools/ has that address hardcoded. 127.0.0.1 only — the sandbox
# has no business listening on anything else.
#
# ==> A BACKGROUND SERVER DOES NOT SURVIVE BETWEEN SHELL CALLS. <==
# Measured 2026-08-08: started here, gone by the next command. Each shell call
# is its own process group and the sandbox reaps it. So this start is only good
# for the rest of THIS command, and any browser check must run in the same
# command as the server that serves it. `tools/with-server.sh` does exactly
# that and is the thing to reach for.
if [ "$WANT_SERVER" = "1" ]; then
  if port_open; then
    ok "static server already up on 127.0.0.1:8099"
  else
    (cd "$REPO" && exec python3 -m http.server 8099 --bind 127.0.0.1) \
      </dev/null >/tmp/landfall-server.log 2>&1 &
    disown 2>/dev/null || true
    sleep 1
    if port_open; then
      ok "static server up on 127.0.0.1:8099 — DIES when this command ends"
      say "        for browser checks:  bash tools/with-server.sh node tools/csp-check.mjs"
    else
      warn "static server did not come up — see /tmp/landfall-server.log"
    fi
  fi
fi

# -------------------------------------------------------------- 5. pre-push
# Two things that have each cost real damage:
#   - a SyntaxError in an ES module = blank screen in production (2026-07-23)
#   - a credential in a repo file = a live write token in a public repo
cat > "$REPO/.git/hooks/pre-push" <<'HOOK'
#!/usr/bin/env bash
# Installed by tools/bootstrap.sh. Lives in .git/hooks, so it is per-clone and
# is never committed. Bypass in a genuine emergency with --no-verify.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)" || exit 1

fail=0

printf 'pre-push: scanning for credentials... '
if git grep -I -n -E 'github_pat_[A-Za-z0-9_]{20,}|ghp_[A-Za-z0-9]{20,}' -- . >/tmp/leak.txt 2>/dev/null; then
  printf 'FOUND\n'
  sed -E 's/(github_pat_|ghp_)[A-Za-z0-9_]+/[REDACTED]/g' /tmp/leak.txt
  printf '\nA credential is in a tracked file. Push refused.\n'
  fail=1
else
  printf 'clean\n'
fi

printf 'pre-push: parsing every module as an ES module...\n'
if ! node tools/check-syntax.mjs; then
  printf '\ncheck-syntax failed. A SyntaxError means the module never parses and\n'
  printf 'nothing runs at all — that is a blank screen in production. Push refused.\n'
  fail=1
fi

exit $fail
HOOK
chmod +x "$REPO/.git/hooks/pre-push"
ok "pre-push hook installed (credential scan + check-syntax)"

# ------------------------------------------------------------ 6. orientation
say ""
say "ORIENTATION — read these, not the spec"
say "  NOW.md         16 KB   live state, what is actually being worked on"
say "  README.md       4 KB   what this is"
say "  SPEC-INDEX.md          section number -> file and line range"
say ""
say "  The spec is ~680 KB across 8 files. Do not read it whole. Look the"
say "  section up in SPEC-INDEX.md and sed out the line range."
say ""
say "NETWORK — the sandbox reaches GitHub and npm. NOTHING ELSE."
say "  curl cannot reach nhc.noaa.gov, gdacs.org, cloudflare, or our own app."
say "  Live payloads and D1 telemetry: read them off the 'archive' branch,"
say "  refreshed hourly by a runner, which does have open internet:"
say "      git fetch origin archive"
say "      git show origin/archive:latest/manifest.json            # feeds + headers"
say "      git show origin/archive:latest/telemetry/freshness.json # read FIRST"
say "      git show origin/archive:latest/telemetry/platform-rollup.json"
say ""
say "  sessions.ts is in SECONDS, not milliseconds. Dividing by 1000 gives you"
say "  1970 and does not error."
say ""
say "bootstrap done."
say ""
