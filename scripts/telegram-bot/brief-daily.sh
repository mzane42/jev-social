#!/usr/bin/env bash
# Morning brief: radar, then the brief (+ TikTok searches, Telegram digest), then push it to the
# private veille branch that the Mac pulls at 08:45. Never push briefs to jev-social (public).
# Env (jev-brief.service): TELEGRAM_* from the EnvironmentFile, JEV_BRIEF_DIR inside the veille clone.
set -uo pipefail

NICHE="${1:-football-anime}"
DIR="${JEV_SOCIAL_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
VEILLE="${JEV_VEILLE_REPO:-/var/lib/jev/veille}"
: "${JEV_BRIEF_DIR:?}"

fail() {
  echo "$1" >&2
  for chat in ${TELEGRAM_CHAT_ID//,/ }; do
    curl -fsS -m 20 "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      --data-urlencode "chat_id=${chat}" --data-urlencode "text=⚠️ Brief ${NICHE}: $1" >/dev/null || true
  done
  exit 1
}

git -C "$VEILLE" -c rebase.autoStash=true pull -q --rebase origin veille || fail "git pull veille a échoué"
cd "$DIR"
node bin/jev-social.js radar --niche "$NICHE" --max 40 || echo "radar failed, brief continues with stored items" >&2
node bin/jev-social.js brief --niche "$NICHE" --social --notify || fail "le brief a échoué (journalctl -u jev-brief)"

cd "$VEILLE"
git -c rebase.autoStash=true pull -q --rebase origin veille || fail "git pull veille a échoué"
git add -A
git diff --cached --quiet || git commit -qm "veille: brief $(date +%F)" || fail "git commit a échoué"
git push -q origin veille || fail "git push veille a échoué"
