# 🤖 MIR4 Claim Bot

Discord bot for managing **MIR4 Magic Square / Secret Peak claim rotations** — floor claims, antidemon rooms, event groups (Fury/Frenzy), summons, reservations, and daily claim reports.

> The bot is **claim-only**: registration, ranking sync, salary polls, tickets, and temp-voice were removed.

---

## 📋 Overview

Claim panels are **bound to the channel you choose**: run the floor's `!` command (`!sp7` … `!ms12`, `!summons`) in the channel you want and the bot posts (and keeps refreshing) its panels there (see [Claim Panel Channels](#-claim-panel-channels)). All claiming is done via **buttons on the panels** — no slash commands needed. The bot never creates, deletes or renames channels.

---

## 🧩 Panels

### 🗺️ Magic Square (MS)

| Floor | Panels |
|-------|--------|
| **MS7–MS10** | Normal floor + Antidemon |
| **MS11–MS12** | Leaders, Events, Antidemon, Goblin |

### 🏔️ Secret Peak (SP)

| Floor | Panels |
|-------|--------|
| **SP7–SP10** | Regular Secret Peak |
| **SP11** | Secret Peak + Goblin |
| **SP12** | Secret Peak + Random Event + Goblin |

### 🌀 Summons

Single **Summon** panel for summon location claims.

---

## 🎮 Claiming

### Standard Floors & Secret Peak
1. Click the **Claim** button on the floor/boss you want
2. The panel updates to **🔴 Claimed** with your name + a time window
3. Click **Leave** when done — a grace period opens for the next player
4. After a boss is **killed**, a respawn cooldown runs automatically

### 🛡️ Antidemon Rooms (MS)
- Rooms **LEFT / MID / RIGHT** (or **MID + LEFT** / **MID + RIGHT** combos)
- **Slide / Ticket / Queue** interactions — join a queue if the room is taken
- **🔒 PT Password** — set, update, or clear a party password via modal
- Rooms auto-release on timeout or when the owner is absent

### ⚔️ Event Groups (Fury / Frenzy / Fixed / Summon)
- **Fixed events** (Fury/Frenzy) open on a schedule — claim inside the window
- **Slide events** — claim when the panel slides open
- Early claim: see [Early Claim](#-early-claim)

### 🔔 DM Notifications
Claim confirmations, boss respawn reminders, and warnings are sent via **DM**. Each user can toggle DMs with the **🔕** button on any panel.

---

## 🌐 Claim Website (browser)

The bot also serves a **local claim website** for members who can't use Discord. It runs **inside the bot process** and drives the **exact same claim handlers** — punishments, queues, cooldowns, daily logs and panel refreshes behave identically to Discord. The bot remains the **only writer** of the JSON databases.

> 🔌 **Disabled by default** (`WEB_ENABLED=false`) — set `WEB_ENABLED=true` in `.env` to serve the site again. The code stays in the repo.

### Env vars (`.env`)
```
# Optional — defaults shown
WEB_ENABLED=false       # set true to enable the website
WEB_HOST=0.0.0.0        # bind address (0.0.0.0 to expose on a VPS)
WEB_PORT=3000           # port
WEB_HTTPS=true          # set true ONLY behind an HTTPS reverse proxy (secure cookies)
```

> ⚠️ For public access, put the bot behind an **HTTPS reverse proxy** (nginx/caddy) and set `WEB_HTTPS=true`. Without HTTPS, passwords travel in plain text.

### Managing accounts
Accounts live in `web-accounts.json` (gitignored). The admin can manage them **in the website** (👑 Admin button — create/remove/change password) or from the command line:

```
# Member with Discord — use their Discord ID so website claims merge with Discord claims
npm run web:adduser -- add john "senha123" --uid 123456789012345678 --name "John"

# Member WITHOUT Discord — omit --uid (a synthetic web:<username> identity is used)
npm run web:adduser -- add mary "senha456" --name "Mary"

# Mod/admin (can force-cancel any claim)
npm run web:adduser -- add mod1 "senha789" --uid 987654321098765432 --mod
npm run web:adduser -- add boss "senha000" --uid 111222333444555666 --admin

npm run web:adduser -- list          # list accounts
npm run web:adduser -- remove john   # remove account
npm run web:adduser -- passwd john nova-senha
```

Admin safeguards: only admins can manage accounts, an admin cannot remove their own account, and the last admin account can never be removed.

### Site views
- **Painéis** — mostra o **estado vivo exato dos painéis do Discord** (via `renderEmbed`): countdowns de respawn, "Xm atrás", donos, filas com ETA, salas com senha e reservas — atualizado a cada 15s. E renderiza **os mesmos botões dos painéis** (via `renderButtons`): claim/cancelar, death marks (💀 nos Leaders/Red Boss, com confirmação de atualização), claim de eventos fixos (Fury/Frenzy), filas e menus de sala/passwords (antidemon/summon/event group). O toggle 🔕 DM fica no cabeçalho do site.
- **📜 Histórico** — últimas atividades de claim (do `daily-logs.json`) e punições ativas, com nomes resolvidos (conta do site → claim atual → Discord).
- **👑 Admin** (só admins) — criar/remover contas e trocar senhas sem usar o terminal.

### Notes
- Sessions are in-memory — members re-login after a bot restart.
- Login is rate-limited (5 failed attempts → 15 min lockout) + per-IP API throttling.
- Non-Discord members have a synthetic identity: claims show their display name, and DMs simply can't be delivered to them (logged, never crashes).

---

## 👑 Admin Tools

### 🔄 Reset Panel
**`admin-reset-menu`** select menu — reset one panel (or **all**) to defaults.

### 👢 Kick User
**`admin-kick-menu`** select menu — remove a user from any claim (floor, room, or event) and open the spot for the next in queue.

### 📤 Reset Logs
**`confirm-resetlogs-yes/no`** — clear the accumulated daily log queue.

### 📅 Reserve Fury / Frenzy (admin-reserve flow)
Multi-step interactive flow:
1. Select **event** (Fury / Frenzy / Both)
2. Select **floors** (MS11 / MS12 / Both)
3. Select **hours** (All or specific slots)
4. **Confirm** — panels refresh with the reservation locked in

Reserved slots are blocked for other users until the reservation passes.

### 👑 Early Claim (`!earlyclaim`)
Text commands (require **Manage Messages**):

| Command | Description |
|---------|-------------|
| `!earlyclaim add @user` | Allow a user to claim Fury/Frenzy **5 minutes before** the window opens |
| `!earlyclaim remove @user` | Remove that permission |
| `!earlyclaim list` | Show all users with early-claim permission |

### 📢 Channel Setup (`!setreminders` / `!setevents` / `!setlogs`)
Text commands (require **Administrator**) — run them in the channel you want the bot to use. They configure the claim system's alert channels and are **always available**, independent of the ranking flag:

| Command | Description |
|---------|-------------|
| `!setreminders` | Boss spawn alerts will be sent to the current channel |
| `!setevents` | Scheduled event alerts (@everyone) will be sent to the current channel |
| `!setlogs` | Daily claim reports (18:00 `.txt` dispatch) will be sent to the current channel |

> ℹ️ `!setadminchannel`, `!enablevalidation` and `!disablevalidation` belong to the ranking/registration system and only work with `RANKING_ENABLED=true`.

---

## ⏰ Automatic Schedules

| Time (Server/Berlin) | Action |
|----------------------|--------|
| **Every 15s** | Panel tick — countdowns, cooldowns, auto-respawn, timeouts, force refresh |
| **5 min before boss spawns** | 🛡️ Boss spawn alerts (world bosses, layer 1/3) |
| **10 min before events** | 🚨 Scheduled event alerts with @everyone (Red Boss, Leader 3, Purgatory, weekly events, etc.) |
| **18:00 daily** | 📤 Daily claim report dispatched (as `.txt` file + summary embed) |

---

## 📋 Claim Panel Channels

Claim panels are **not** tied to fixed categories or channel names anymore. Run the command for a floor in the channel you want — the bot posts that floor's panels and buttons there and keeps them updated:

| Command | Panels posted |
|---------|---------------|
| `!sp7` … `!sp10` | Secret Peak floor |
| `!sp11` | Secret Peak + Goblin |
| `!sp12` | Secret Peak + Random Event + Goblin |
| `!summons` | Summon locations |
| `!ms7` … `!ms10` | Normal floor + Antidemon |
| `!ms11` | Events |
| `!ms12` | Leaders + Events + Antidemon + Goblin |

- Requires **Administrator**.
- Re-running a command moves that floor's panels to the new channel (the old copies are deleted).
- The binding is saved (`database.json`) and restored on every boot — **the bot never creates, deletes or renames channels** (see `src/handlers/text-commands.js`).
- **Orphan cleanup** — runs on every boot (before panel recovery, so stale panels are never re-posted) and on demand with `!cleanpanels` (requires **Administrator**): deletes the messages of panels that no longer belong to any floor command (e.g. the old 11F Leaders/Antidemon/Goblin after `!ms11` was trimmed) and forgets their saved channel.

---

## 📦 Data Files

| File | Contents |
|------|----------|
| `database.json` | Panel state, claims, owners, queues (gitignored) |
| `daily-logs.json` | Accumulated claim log queue + configured channel IDs |
| `punishments.json` | Temporary claim cooldowns after kick/leave |
| `early-claim-users.json` | Users allowed to claim early |
| `dm-optout.json` | Users who disabled DMs |
| `web-accounts.json` | Website accounts (scrypt password hashes) |

All are gitignored.

---

## ⚙️ Setup

### 1. Environment
Create a `.env` file (gitignored) — the bot reads **all** of these from the environment, nothing is hardcoded:
```
TOKEN=your-bot-token
CLIENT_ID=your-application-client-id
DISCORD_SERVER_ID=your-guild-id
```

`DISCORD_SERVER_ID` is defined once in `src/core/config.js` (from `.env`) and re-used by the ranking/registration system (`src/core/ranking-constants.js`), the claim bot, the web server and `deploy-commands.cjs`. Changing guild only requires editing `.env`.

### 🔌 Ranking / registro (feature flag)
The whole ranking/registration system (scraper, sync, registration panels, clan roles, slash commands) is controlled by one flag:
```
RANKING_ENABLED=false   # default — ranking desligado (fórum do jogo indisponível)
RANKING_ENABLED=true    # reativa o sistema completo
```
With the flag off, the bot skips the ranking boot and does not register/answer slash commands (claim uses buttons only). All ranking files stay in the repo, so re-enabling is just the flag. The bot never creates or manages channels in either mode — panels are bound with `!sp7` … `!ms12` and alerts with `!setreminders` / `!setevents` / `!setlogs`.

### 2. Configuration
- **Claim panels** — bound to channels with the `!sp7` … `!ms12` / `!summons` commands ([Claim Panel Channels](#-claim-panel-channels)); no channel IDs to edit
- **Daily logs / boss alerts / event alerts** — set with `!setlogs` / `!setreminders` / `!setevents`, or manually in `daily-logs.json` (`configChannelId`, `bossSpawnChannelId`, `scheduledEventChannelId`)

### 3. Permissions
| Permission | Required For |
|-----------|-------------|
| **Manage Messages** | `!earlyclaim`, reset/kick/reset-logs admin actions |
| **Administrator** | `!sp7` … `!ms12` / `!summons` panel binding, `!setreminders` / `!setevents` / `!setlogs` |

### 4. Run
```
npm install
npm start
```

The claim website starts automatically (see [Claim Website](#-claim-website)).

---

## 🏗️ Project Structure

```
src/
├── index.js                        # Entry point — boots claim, panel recovery, tick
├── core/
│   ├── config.js                   # DISCORD_SERVER_ID, token helpers
│   ├── constants.js                # Status strings, embed colors
│   ├── state.js                    # Module-level state (db, logs, punishments, early claim, DM opt-out)
│   ├── lang.js / lang.json         # Localization (all UI text)
│   ├── time-utils.js               # Time helpers, boss schedules
│   ├── logger.js                   # Structured logger + global error handlers
│   ├── daily-logs.js               # Claim report builder + dispatch
│   └── discord-utils.js            # Shared Discord send helpers
├── handlers/
│   ├── bot.js                      # Claim system initialization + router export
│   ├── claim-handlers.js           # Unified interaction router
│   ├── claim-core*.js              # Claim logic (utils, rooms, options, actions)
│   ├── panel-render.js             # Embed + button rendering
│   ├── render-embed*.js            # Panel embed builders
│   ├── render-buttons.js           # Panel button builders
│   ├── panel-tick.js               # 15s tick (cooldowns, respawn, alerts, dispatch)
│   ├── tick-*.js                   # Per-panel-type tick logic
│   ├── panel-utils.js              # Panel refresh helpers + DM notifications
│   ├── panel-dm.js                 # DM message handling
│   ├── panel-migrations.js         # Data migrations
│   ├── text-commands.js            # !sp7…!ms12 panel binding + !set* alert channels
│   ├── boss-spawn-scheduler.js     # Boss + scheduled event alerts
│   └── early-claim.js              # !earlyclaim admin commands
└── interactions/
    ├── floor-interactions.js       # Floor/peak buttons (claim, cancel, next)
    ├── floor-*.js                  # Floor-specific handlers
    ├── antidemon-interactions*.js  # Antidemon rooms (slide, ticket, queue, password)
    ├── summon-interactions.js      # Summon handlers
    ├── floor-summon.js             # Summon claim flow
    ├── admin-interactions.js       # Admin reset/kick/reset-logs
    └── admin-reserve.js            # Fury/Frenzy reservation flow
```

---

## 🧪 Test Checklist

After any changes, verify:

- [ ] Boot → every bound panel re-posted in its channel (recovery)
- [ ] **Panel binding** — `!ms7` / `!sp7` / `!summons` in a channel post + move the floor panels there
- [ ] **Floor claim** — claim, leave, queue promotion, grace period
- [ ] **Boss killed** → cooldown → auto-respawn → DM reminder
- [ ] **Antidemon rooms** — left/mid/right, combo rooms, password modal
- [ ] **Antidemon queue** — slide / ticket / queue join
- [ ] **Fury/Frenzy fixed events** — claim inside window, reservation blocks
- [ ] **Early claim** — `!earlyclaim add/remove/list` + claiming 5 min early
- [ ] **Admin** — reset panel (single + all), kick user, reset logs
- [ ] **Reserve flow** — reserve Fury/Frenzy slots, panel refresh
- [ ] **🔕 DM opt-out** — toggle disables/re-enables DMs
- [ ] **Daily report** — dispatches at 18:00 with `.txt` attachment
- [ ] **Boss alerts** — 5 min boss spawn + 10 min event alerts
