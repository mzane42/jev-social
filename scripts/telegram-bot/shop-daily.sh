#!/usr/bin/env bash
# Daily TikTok Shop collection, then a Telegram summary (same env file as the bot).
# Usage: shop-daily.sh [niche]   Env: JEV_BOT_ENV_FILE, JEV_SOCIAL_DIR, JEV_SOCIAL_DB, SOCAI_BIN
set -uo pipefail

NICHE="${1:-tiktok-shop-fr}"
ENV_FILE="${JEV_BOT_ENV_FILE:-/etc/notify/channels/jev.env}"
DIR="${JEV_SOCIAL_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
DB="${JEV_SOCIAL_DB:-$HOME/.jev-social/jev-social.db}"
SOCAI="${SOCAI_BIN:-$HOME/.local/bin/socai}"

# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a
: "${TELEGRAM_BOT_TOKEN:?}" "${TELEGRAM_CHAT_ID:?}"

html() { sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }
notify() { # stdin = HTML message
  local text; text="$(cat)"
  for chat in ${TELEGRAM_CHAT_ID//,/ }; do
    curl -fsS -m 20 "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      --data-urlencode "chat_id=${chat}" --data-urlencode "text=${text}" \
      -d parse_mode=HTML -d disable_web_page_preview=true >/dev/null || echo "telegram send failed for ${chat}" >&2
  done
}

cd "$DIR"
out="$(node bin/jev-social.js shop collect --niche "$NICHE" 2>&1)"; code=$?
"$SOCAI" stop >/dev/null 2>&1 || true
summary="$(printf '%s\n' "$out" | grep -E '^shop [0-9]{4}-' | tail -1)"

if [ "$code" -ne 0 ] || [ -z "$summary" ]; then
  { printf '<b>Shop %s: échec</b> (exit %s)\n<pre>%s</pre>' "$NICHE" "$code" "$(printf '%s\n' "$out" | tail -8 | html)"; } | notify
  exit "$code"
fi

# ponytail: top 5 products by today's video views, straight from SQLite; the brief (sub-project 4) replaces this.
top="$(sqlite3 -separator '|' "$DB" "
  select coalesce(nullif(p.short_title,''), p.title), sum(coalesce(s.views,0)), count(*)
  from shop_videos v
  join shop_snapshots s on s.kind='video' and s.id=v.url and s.date=date('now','localtime')
  join shop_products p on p.product_id=v.product_id
  group by p.product_id order by 2 desc limit 5;" 2>/dev/null \
  | awk -F'|' '{ v=$2; u=""; if (v>=1e6){v=v/1e6;u="M"} else if (v>=1e3){v=v/1e3;u="K"}; printf "• %s — %.1f%s vues, %d vidéo%s\n", substr($1,1,60), v, u, $3, ($3>1?"s":"") }' | html)"

{ printf '<b>%s</b>\n' "$(printf '%s' "$summary" | html)"; [ -n "$top" ] && printf '\n%s\n' "$top"; [ -n "${JEV_DASHBOARD_URL:-}" ] && printf '\n%s/shop' "$JEV_DASHBOARD_URL"; } | notify
