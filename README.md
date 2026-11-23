# 🤖 MIR4 Claim Bot

Discord bot for managing **MIR4 Magic Square / Secret Peak claim rotations** — floor claims, antidemon rooms, event groups (Fury/Frenzy), summons, reservations, and daily claim reports.

> The bot is **claim-only**: MIR4 floor claims, antidemon rooms, event groups, summons and daily claim reports.

---

## 📋 Overview

On every boot, the bot **deletes and recreates all floor channels** and deploys fresh claim panels (see [Auto Channel Setup](#-auto-channel-setup)). All claiming is done via **buttons on the panels** — no slash commands needed.

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

### 🔔 DM Notifications
Claim confirmations, boss respawn reminders, and warnings are sent via **DM**. Each user can toggle DMs with the **🔕** button on any panel.

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

---

### 📢 Channel Setup (`!setreminders` / `!setevents` / `!setlogs`)
Text commands (require **Administrator**) — run them in the channel you want the bot to use. They configure the claim system's alert channels:

| Command | Description |
|---------|-------------|
| `!setreminders` | Boss spawn alerts will be sent to the current channel |
| `!setevents` | Scheduled event alerts (@everyone) will be sent to the current channel |
| `!setlogs` | Daily claim reports (18:00 `.txt` dispatch) will be sent to the current channel |

---

## ⏰ Automatic Schedules

| Time (Server, UTC+2 — no DST) | Action |
|----------------------|--------|
| **Every 15s** | Panel tick — countdowns, cooldowns, auto-respawn, timeouts, force refresh |
| **5 min before boss spawns** | 🛡️ Boss spawn alerts (world bosses, layer 1/3) |
| **10 min before events** | 🚨 Scheduled event alerts with @everyone (Red Boss, Leader 3, Purgatory, weekly events, etc.) |
| **18:00 daily** | 📤 Daily claim report dispatched (as `.txt` file + summary embed) |

---

## 🏗️ Auto Channel Setup

On boot, `auto-channel-setup.js` **deletes all text channels** in the **two configured categories** and recreates them:

```
🔸 SP & Summons  (category 1548033121012813905)
  SP-7F … SP-12F  +  🌀 Summons

🔹 MS            (category 1548033184619438162)
  MS-7F … MS-12F
```

The two categories are matched by their explicit **ID** (defined in `src/core/server-structure.js`), so they can be renamed freely — a category matched by ID keeps its current name. Their existing permission overwrites are inherited by the created channels.

Each channel gets its panel embeds + buttons posted automatically.

---

## 📦 Data Files

| File | Contents |
|------|----------|
| `database.json` | Panel state, claims, owners, queues (gitignored) |
| `daily-logs.json` | Accumulated claim log queue + configured channel IDs |
| `punishments.json` | Temporary claim cooldowns after kick/leave |
| `dm-optout.json` | Users who disabled DMs |

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
| `DISCORD_SERVER_ID` | Guild the bot operates on (required) |
| `MEMBER_ROLE_ID` | Membership role used for claim-channel permissions |
| `ELDER_ROLE_ID` | Elder role (tower-rules / announcements / allied-list) |
| `SUPER_ADMIN_USER_ID` | User who receives panel-recovery alerts |
| `CLAIM_CATEGORY_SP_SUMMONS_ID` / `CLAIM_CATEGORY_MS_ID` | The two claim categories |
| `WORLD_BOSS_ARENA_CHANNEL_ID` | Channel for the world-boss arena alert |

`MEMBER_ROLE_ID` is the membership role used for claim-channel permissions. The bot **never creates roles** — create it manually on the server first. When the variable is unset the bot falls back to a hardcoded legacy ID; set it explicitly in production.

`DISCORD_SERVER_ID` is defined once in `src/core/config.js` (from `.env`) and re-used by the claim bot. Changing guild only requires editing `.env`.

### 2. Configuration
- **`src/core/server-structure.js`** — channel/panel definitions (category IDs come from `.env`)
- **Daily logs / boss alerts / event alerts** — configured **manually in `daily-logs.json`**: set `configChannelId` (daily claim report), `bossSpawnChannelId` (boss spawn alerts), and `scheduledEventChannelId` (event alerts) to the target channel IDs before boot

### 3. Permissions
| Permission | Required For |
|-----------|-------------|
| **Manage Messages** | reset/kick/reset-logs admin actions |
| **Manage Channels** | Auto channel setup (delete/recreate channels on boot) |

### 4. Run
```
npm install
npm start
```

The bot connects to Discord and publishes the claim panels automatically.

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
npm test         # node:test unit tests
```
> There is **no integration harness** for the Discord flows, so everything below is a manual check against a test guild.

### Boot sequence (`src/index.js`, in this order)
- [ ] `initClaimSystem` loads the claim DB, builds missing panels and runs migrations — it must send **nothing** to Discord (no refresh, no recovery)
- [ ] Auto-setup deletes every text channel in the two claim categories and recreates them with fresh panels — no duplicate panels are left behind
- [ ] The 15 s tick starts, then the panel watchdog (first pass ~60 s after boot)
- [ ] The `!set*` / `!kick` / `!reset` / `!reserve` text commands come up last

### Claim flows
- [ ] **Floor claim** — claim, leave, queue promotion, grace period
- [ ] **Boss killed** → cooldown → auto-respawn → DM reminder
- [ ] **Antidemon rooms** — left/mid/right, combo rooms, password modal
- [ ] **Antidemon queue** — slide / ticket / queue join
- [ ] **Fury/Frenzy fixed events** — claim inside window, reservation blocks
- [ ] **Admin** — reset panel (single + all), kick user, reset logs
- [ ] **Reserve flow** — reserve Fury/Frenzy slots, panel refresh
- [ ] **🔕 DM opt-out** — toggle disables/re-enables DMs
- [ ] **Daily report** — dispatches at 18:00 with `.txt` attachment
- [ ] **Boss alerts** — 5 min boss spawn + 10 min event alerts

### Tick & watchdog resilience
- [ ] Tick runs every 15 s and **skips** a pass (no overlap) while the previous one is still awaiting Discord
- [ ] A panel idle >10 min is heartbeat-refreshed; the watchdog itself runs every 5 min
- [ ] A panel that stays stale for >1 h → message re-sent; if that fails → channel deleted, recreated and all its panels re-posted; the super admin gets a DM
- [ ] A panel that keeps failing is not retried more than once per 30 min (recovery cooldown)
- [ ] Watchdog ignores non-claim panels
