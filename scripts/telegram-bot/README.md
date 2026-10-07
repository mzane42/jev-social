# Telegram bot

Drives `jev-social profile` from Telegram on a headless host (VPS with Xvfb + socai). It uses
long polling, so there is no public endpoint, and it answers only the chat IDs listed in
`TELEGRAM_CHAT_ID`.

| Command | Effect |
| --- | --- |
| `/profile <@handle\|url> <niche>` | Queue a collection; reply with videos, median views, insights and a dashboard link |
| `/niches` | Niches in the DB with account count and last date |
| `/last` | Five most recent reports |
| `/queue` | Running and waiting collections |

Collections run one at a time and `socai stop` runs after each, per the GUIDE. A job is killed
after `JEV_BOT_JOB_TIMEOUT_MS` (default 15 min). The database is opened read-only.

## Configuration

Credentials live in an env file, `JEV_BOT_ENV_FILE` (default `/etc/notify/channels/jev.env`):

```sh
PROVIDER=telegram
TELEGRAM_BOT_TOKEN=<from @BotFather>
TELEGRAM_CHAT_ID="<your chat id>[,<another>]"
```

The bot refuses to start with an empty `TELEGRAM_CHAT_ID`. Keep the file `0640` and out of any
repository.

| Variable | Default |
| --- | --- |
| `JEV_SOCIAL_DIR` | this repository |
| `JEV_SOCIAL_DB` | `~/.jev-social/jev-social.db` |
| `SOCAI_BIN` | `~/.local/bin/socai` |
| `JEV_DASHBOARD_URL` | `http://localhost:5173` |
| `DISPLAY` | `:99` |

## Run as a service

`jev-bot.service` is an example systemd unit: replace `anis` and the Node path, then

```sh
sudo install -m 644 scripts/telegram-bot/jev-bot.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now jev-bot
journalctl -u jev-bot -f
```

Anyone whose chat ID is allowed triggers collections on the socai browser sessions of the host
account.

## Daily TikTok Shop collection

`shop-daily.sh [niche]` runs `jev-social shop collect`, stops socai, then posts the summary line
and the five products with the most views of the day to every chat in `TELEGRAM_CHAT_ID`. It
reads the same env file as the bot. `jev-shop-collect.service` + `.timer` run it every morning
at 07:00 (±20 min):

```sh
sudo install -m 644 scripts/telegram-bot/jev-shop-collect.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now jev-shop-collect.timer
sudo systemctl start jev-shop-collect.service   # run once now
journalctl -u jev-shop-collect -n 50 --no-pager
```

The collection needs the socai build with TikTok Shop anchors (fork branch `feat/tiktok-anchors`,
see `docs/GUIDE-LOCAL.md`) and a TikTok session in the socai Chrome profile of the host.

## Deploy

`scripts/deploy/deploy.sh` is a pull deploy: every 5 minutes `jev-deploy.timer` fetches `origin/main`
and, once the GitHub `tests` workflow is green on that commit, fast-forwards the checkout, runs
`npm ci` where a lockfile changed, installs changed systemd units, restarts `jev-bot` and
`jev-social-dashboard`, and posts the result on Telegram. It waits while a collection runs, never
touches a dirty tree, and on failure goes back to the previous commit and skips the failed one
until the next push. No inbound access or CI secret is needed. Install once:

```sh
sudo install -m 644 scripts/deploy/jev-deploy.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now jev-deploy.timer
journalctl -u jev-deploy -n 30 --no-pager   # last deploy; state in ~/.local/state/jev-deploy/
```

The deploy user needs passwordless `sudo` for `install`, `systemctl daemon-reload` and `systemctl restart`.
