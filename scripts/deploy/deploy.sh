#!/usr/bin/env bash
# Pull-based deploy for the headless host: fast-forward to origin/main once the GitHub "tests"
# workflow is green on that commit, refresh dependencies and systemd units, restart the services,
# then report on Telegram. Run by jev-deploy.timer every 5 minutes; safe to run by hand.
# Env: JEV_SOCIAL_DIR (repo, default this checkout), JEV_DEPLOY_REPO (owner/name), JEV_BOT_ENV_FILE.
set -uo pipefail

DIR="${JEV_SOCIAL_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
REPO="${JEV_DEPLOY_REPO:-mzane42/jev-social}"
ENV_FILE="${JEV_BOT_ENV_FILE:-/etc/notify/channels/jev.env}"
STATE="${XDG_STATE_HOME:-$HOME/.local/state}/jev-deploy"
UNITS=(scripts/telegram-bot/jev-bot.service scripts/telegram-bot/jev-shop-collect.service scripts/telegram-bot/jev-shop-collect.timer
  scripts/deploy/jev-social-dashboard.service scripts/deploy/jev-deploy.service scripts/deploy/jev-deploy.timer)
SERVICES=(jev-bot jev-social-dashboard)

mkdir -p "$STATE"
exec 9>"$STATE/lock"
flock -n 9 || exit 0 # a deploy is already running

notify() { # $1 = HTML text; silent when the bot env file is missing
  [ -r "$ENV_FILE" ] || return 0
  ( set -a; . "$ENV_FILE"; set +a
    for chat in ${TELEGRAM_CHAT_ID//,/ }; do
      curl -fsS -m 20 "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" --data-urlencode "chat_id=${chat}" \
        --data-urlencode "text=$1" -d parse_mode=HTML -d disable_web_page_preview=true >/dev/null || true
    done )
}
html() { sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }

cd "$DIR" || exit 1
git fetch -q origin main || exit 0 # network blip: next tick
old="$(git rev-parse HEAD)"
new="$(git rev-parse origin/main)"
[ "$(git rev-parse --abbrev-ref HEAD)" = main ] && [ "$old" = "$new" ] && exit 0
[ "$(cat "$STATE/failed" 2>/dev/null)" = "$new" ] && exit 0 # already failed, wait for the next commit

# Only deploy what CI has validated: the "tests" workflow run for this commit must be a success.
ci="$(curl -fsS -m 20 "https://api.github.com/repos/${REPO}/actions/runs?head_sha=${new}&event=push" 2>/dev/null \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=(JSON.parse(s).workflow_runs||[]).find(r=>r.name==="tests");console.log(r?`${r.status}/${r.conclusion}`:"none")})')"
case "$ci" in
  completed/success) ;;
  completed/*) echo "$new" >"$STATE/failed"; notify "<b>Deploy skipped</b> ${new:0:7}: CI ${ci#completed/}"; exit 0 ;;
  *) exit 0 ;; # queued, running or not started yet
esac

# Never restart the bot under a collection: its ExecStopPost runs `socai stop`.
if [ "$(systemctl is-active jev-shop-collect.service)" = activating ] || pgrep -f "jev-social.js (profile|shop)" >/dev/null; then exit 0; fi

fail() { # $1 = step; $2 = "keep" leaves the checkout alone (dirty tree: never discard local edits)
  local log; log="$(tail -6 "$STATE/last.log" 2>/dev/null | html)"
  [ "${2:-}" = keep ] || git checkout -q -f -B main "$old" 2>/dev/null
  echo "$new" >"$STATE/failed"
  notify "<b>Deploy failed</b> ${new:0:7} at $1, stayed on ${old:0:7}
<pre>${log}</pre>"
  exit 1
}

{
  [ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "local changes in $DIR"; false; }
} >"$STATE/last.log" 2>&1 || fail "dirty tree" keep
git checkout -q -B main origin/main >>"$STATE/last.log" 2>&1 || fail "checkout"

changed() { git diff --quiet "$old" "$new" -- "$@" 2>/dev/null && return 1 || return 0; }
if changed package-lock.json; then npm ci --omit=dev --no-audit --no-fund >>"$STATE/last.log" 2>&1 || fail "npm ci"; fi
if changed dashboard/package-lock.json; then (cd dashboard && npm ci --no-audit --no-fund) >>"$STATE/last.log" 2>&1 || fail "dashboard npm ci"; fi

reload=0
for unit in "${UNITS[@]}"; do
  target="/etc/systemd/system/$(basename "$unit")"
  [ -f "$unit" ] || continue
  cmp -s "$unit" "$target" && continue
  sudo -n install -m 644 "$unit" "$target" >>"$STATE/last.log" 2>&1 || fail "install $(basename "$unit")"
  reload=1
done
[ "$reload" = 1 ] && { sudo -n systemctl daemon-reload >>"$STATE/last.log" 2>&1 || fail "daemon-reload"; }
for svc in "${SERVICES[@]}"; do sudo -n systemctl restart "$svc" >>"$STATE/last.log" 2>&1 || fail "restart $svc"; done
sleep 5
for svc in "${SERVICES[@]}"; do systemctl is-active --quiet "$svc" || { journalctl -u "$svc" -n 6 --no-pager >>"$STATE/last.log" 2>&1; fail "$svc not running"; }; done

rm -f "$STATE/failed"
notify "<b>Deployed</b> ${new:0:7}: $(git log -1 --format=%s "$new" | html)
$(git log --format='• %s' "$old..$new" 2>/dev/null | head -8 | html)"
