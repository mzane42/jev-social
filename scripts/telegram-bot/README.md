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
