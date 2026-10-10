# 🤖 MIR4 Claim Bot

Discord bot for managing **MIR4 Magic Square / Secret Peak claim rotations** — floor claims, antidemon rooms, event groups (Fury/Frenzy), summons, reservations, and daily claim reports.

> The bot is **claim-only**: registration, ranking sync, salary polls, and temp-voice were removed. The 🎫 support-ticket system is available (see [Support Tickets](#-support-tickets)).

---

## 📋 Overview

On every boot, the bot **deletes and recreates all floor channels** and deploys fresh claim panels (see [Auto Channel Setup](#-auto-channel-setup)). All claiming is done via **buttons on the panels** — no slash commands needed.

---

## 🧩 Panels

### 🗺️ Magic Square (MS)

| Floor | Panels |
|-------|--------|
| **MS8–MS10** | Normal floor + Antidemon |
| **MS11–MS12** | Leaders, Events, Antidemon, Goblin |

### 🏔️ Secret Peak (SP)

| Floor | Panels |
|-------|--------|
| **SP8–SP10** | Regular Secret Peak |
| **SP11** | Secret Peak + Goblin |
| **SP12** | Secret Peak + Random Event + Goblin |

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
- **Fixed events** (Fury/Frenzy on MS11/MS12, Random Event on SP12) open on a schedule — claims open **10 min before** the event starts and stay open through the 1h window
- **Random Event (SP12)** — limited to **1 claim per person per day**, resetting every day at **13:00 (Brasília time)**
- **Slide events** — claim when the panel slides open

### 🛡️ Immune users

User IDs listed in `IMMUNE_USER_IDS` (`src/core/constants.js`) bypass **every** claim restriction: punishments/cooldowns, the “active claim / active queue” limits, the scheduled-event time windows and the Random Event per-day limit. Add an ID there to grant the same immunity.

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
- Sessions are persisted in `web-sessions.json` (7-day TTL) — members stay logged in across bot restarts.
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

## 🎫 Support Tickets

Members open a private ticket with the **🎫 Open Ticket** button on the ticket panel, pick a category (Support / Report / Doubt), and a private channel is created for them + staff. Staff can **add/remove members** and **close** the ticket; on close a `.txt` transcript (plus saved attachments) is sent to the **📜 ticket-logs** channel inside the ticket category — never to the claim logs channel. The **Remove Member** menu lists only the members that were explicitly added to the ticket (those with their own permission overwrite).

**On boot** the bot ensures the ticket category contains its channels: it creates `🎫 open-ticket` (the panel channel) and `📜 ticket-logs` **only when missing**, keeps every existing channel untouched — including open `ticket-*` rooms — and (re)posts the panel in `🎫 open-ticket`. Nothing in the ticket category is ever deleted by the setup.

| Command | Description |
|---------|-------------|
| `!ticket` (or `!ticketpanel`) | Post/refresh the ticket panel in the current channel (requires **Manage Messages**) |

State lives in `tickets.json`; transcripts are written to `ticket-logs/` (both gitignored). The staff role is read from `STAFF_ROLE_ID` in `.env`.

---

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

## 🏗️ Auto Channel Setup

On boot, `auto-channel-setup.js` **deletes all text channels** in the **two configured categories** and recreates them:

```
🔸 SP            (category 1548033121012813905)
  SP-8F … SP-12F

🔹 MS            (category 1548033184619438162)
  MS-8F … MS-12F
```

The two categories are matched by their explicit **ID** (defined in `src/core/server-structure.js`), so they can be renamed freely — a category matched by ID keeps its current name. Their existing permission overwrites are inherited by the created channels.

Each channel gets its panel embeds + buttons posted automatically.

### 🎫 Ticket category

The ticket category (`TICKET_CATEGORY_ID`) is set up **non-destructively**: the bot only creates the channels it manages when they are missing and otherwise leaves the category untouched (open `ticket-*` rooms included). Defined in `src/core/server-structure.js` as `TICKET_CATEGORY`:

```
🎫 Tickets  (category from TICKET_CATEGORY_ID)
  🎫 open-ticket   ← support-ticket panel (re)posted on boot
  📜 ticket-logs   ← closed-ticket transcripts
```

Existing channels are matched by pretty name, legacy name or key, so renamed/legacy channels are reused instead of duplicated. When the category can't be resolved, the bot falls back to restoring the panel in the channel stored in `tickets.json`.

---

## 📦 Data Files

| File | Contents |
|------|----------|
| `database.json` | Panel state, claims, owners, queues (gitignored) |
| `daily-logs.json` | Accumulated claim log queue + configured channel IDs |
| `punishments.json` | Temporary claim cooldowns after kick/leave |
| `dm-optout.json` | Users who disabled DMs |
| `web-accounts.json` | Website accounts (scrypt password hashes) |
| `web-sessions.json` | Website login sessions (opaque tokens + expiry) |
| `tickets.json` | Ticket panel channel + open tickets (user → channel) |
| `ticket-logs/` | Ticket transcripts and saved attachments |

All are gitignored.

---

## ⚙️ Setup

### 1. Environment
Copy the example file and fill it in (`.env` is gitignored):
```
cp .env.example .env
```
Every value is read from `.env`; each one also has a fallback in code, so a missing variable keeps the current behavior. `.env.example` lists them all:

| Variable | Purpose |
|----------|---------|
| `TOKEN` / `DISCORD_TOKEN` | Bot token (either name works) |
| `CLIENT_ID` | Application ID — used by `node src/deploy-commands.cjs` |
| `DISCORD_SERVER_ID` | Guild the bot operates on (required) |
| `RANKING_ENABLED` | `true` re-enables the ranking/registration system (default `false`) |
| `WEB_ENABLED` | `true` serves the claim website (default `false`) |
| `WEB_HOST` / `WEB_PORT` / `WEB_HTTPS` | Website bind address (default `0.0.0.0:3000`, HTTPS off) |
| `MEMBER_ROLE_ID` | Membership role the bot manages |
| `STAFF_ROLE_ID` | Ticket staff role (empty = Manage Messages only) |
| `ELDER_ROLE_ID` | Elder role (tower-rules / announcements / allied-list) |
| `TICKET_CATEGORY_ID` | Category where ticket channels are created |
| `CLAIM_CATEGORY_SP_SUMMONS_ID` / `CLAIM_CATEGORY_MS_ID` | The two claim categories |
| `WORLD_BOSS_ARENA_CHANNEL_ID` | Channel for the world-boss arena alert |
| `APPROVER_ROLE_IDS` | Comma-separated roles allowed to approve registrations |
| `SUPER_ADMIN_USER_ID` | User allowed to run high-risk commands |
| `REGISTRATION_CHANNEL_ID` | Fallback channel for registration DMs |

`MEMBER_ROLE_ID` is the single membership role the bot manages (granted/revoked by the sync, used for claim-channel permissions). The bot **never creates roles** — create it manually on the server first. When the variable is unset the bot falls back to a hardcoded legacy ID and logs a warning at boot; if that fallback role no longer exists, claim-channel permissions are silently skipped (`reason: 'no-roles'`). Always set it explicitly.

`STAFF_ROLE_ID` is the role treated as staff by the ticket system (added to every ticket, allowed to manage/close it). Leave it empty to rely on the **Manage Messages** permission only.

`DISCORD_SERVER_ID` is defined once in `src/core/config.js` (from `.env`) and re-used by the ranking/registration system (`src/core/ranking-constants.js`), the claim bot, the web server and `deploy-commands.cjs`. Changing guild only requires editing `.env`.

### 🔌 Ranking / registro (feature flag)
The whole ranking/registration system (scraper, sync, registration panels, clan roles, slash commands and claim-channel permissions) is controlled by one flag:
```
RANKING_ENABLED=false   # default — ranking desligado (fórum do jogo indisponível)
RANKING_ENABLED=true    # reativa o sistema completo
```
With the flag off, the bot skips the ranking boot, does not register/answer slash commands (claim uses buttons only) and does not apply clan-role permissions to claim channels. All ranking files stay in the repo, so re-enabling is just the flag.

### 2. Configuration
- **`src/core/server-structure.js`** — channel/panel definitions (category IDs come from `.env`)
- **Daily logs / boss alerts / event alerts** — configured **manually in `daily-logs.json`**: set `configChannelId` (daily claim report), `bossSpawnChannelId` (boss spawn alerts), and `scheduledEventChannelId` (event alerts) to the target channel IDs before boot

### 3. Permissions
| Permission | Required For |
|-----------|-------------|
| **Manage Messages** | `!ticket`, reset/kick/reset-logs admin actions |
| **Manage Channels** | Auto channel setup (delete/recreate channels on boot) |

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
├── index.js                        # Entry point — boots claim, auto-setup, tick
├── core/
│   ├── config.js                   # DISCORD_SERVER_ID, token helpers
│   ├── constants.js                # Status strings, embed colors
│   ├── state.js                    # Module-level state (db, logs, punishments, DM opt-out)
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
│   ├── auto-channel-setup.js       # Channel recreation + panel deployment on boot
│   ├── boss-spawn-scheduler.js     # Boss + scheduled event alerts
│   ├── kick-command.js             # !kick admin command
│   ├── admin-commands.js           # !reset / !reserve admin commands
│   ├── ticket-system.js            # Ticket router + panel bootstrap
│   ├── ticket-core.js              # Ticket state, panel, orphan cleanup
│   ├── ticket-handlers*.js         # Open/close, member add/remove, transcripts
│   └── ticket-command.js           # !ticket admin command (post panel)
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

### Automated (run these first)
```
npm run lint     # ESLint — must end with 0 problems
npm test         # node:test unit tests (ranking-cache helpers)
```
> There is **no integration harness** for the Discord or web flows, so everything below is a manual check against a test guild.

### Boot sequence (`src/index.js`, in this order)
- [ ] Ranking boot runs only with `RANKING_ENABLED=true` (deploy commands, member-role lookup, sync check after 10 s, auto-backup every 6 h)
- [ ] `initClaimSystem` loads the claim DB, builds missing panels and runs migrations — it must send **nothing** to Discord (no refresh, no recovery)
- [ ] Auto-setup deletes every text channel in the two claim categories and recreates them with fresh panels — no duplicate panels are left behind
- [ ] `applyClaimChannelPermissions` restricts claim + member channels to `MEMBER_ROLE_ID` (skipped, with a warning, when the role is missing)
- [ ] The 15 s tick starts, then the panel watchdog (first pass ~60 s after boot)
- [ ] Web server (`WEB_ENABLED=true`) and the `!set*` / `!kick` / `!reset` / `!reserve` / `!ticket` text commands come up last

### Claim flows
- [ ] **Floor claim** — claim, leave, queue promotion, grace period
- [ ] **Boss killed** → cooldown → auto-respawn → DM reminder
- [ ] **Antidemon rooms** — left/mid/right, combo rooms, password modal
- [ ] **Antidemon queue** — slide / ticket / queue join
- [ ] **Fury/Frenzy fixed events** — claim inside window, reservation blocks
- [ ] **Admin** — reset panel (single + all), kick user, reset logs
- [ ] **Reserve flow** — reserve Fury/Frenzy slots, panel refresh
- [ ] **Tickets** — boot creates missing `🎫 open-ticket` / `📜 ticket-logs` and restores the panel without deleting existing channels; `!ticket` posts panel; open → category → channel; add/remove member; close → transcript to the ticket-logs channel
- [ ] **🔕 DM opt-out** — toggle disables/re-enables DMs
- [ ] **Daily report** — dispatches at 18:00 with `.txt` attachment
- [ ] **Boss alerts** — 5 min boss spawn + 10 min event alerts

### Tick & watchdog resilience
- [ ] Tick runs every 15 s and **skips** a pass (no overlap) while the previous one is still awaiting Discord
- [ ] A panel idle >10 min is heartbeat-refreshed; the watchdog itself runs every 5 min
- [ ] A panel that stays stale for >1 h → message re-sent; if that fails → channel deleted, recreated and all its panels re-posted; the super admin gets a DM
- [ ] A panel that keeps failing is not retried more than once per 30 min (recovery cooldown)
- [ ] Watchdog ignores non-claim panels (registration/approval panels stay untouched)

### Web
- [ ] `/api/panels` and `/api/history` are served gzipped when the client accepts it, and the response body is intact (not empty) either way
- [ ] Login survives a bot/PM2 restart (session comes back from `web-sessions.json`)
- [ ] Logout and 7-day expiry both clear the session on disk
