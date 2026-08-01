# 🤖 MIR4 Claim Bot

Discord bot for managing **MIR4 Magic Square / Secret Peak claim rotations** — floor claims, antidemon rooms, event groups (Fury/Frenzy), summons, reservations, and daily claim reports.

> The bot is **claim-only**: registration, ranking sync, salary polls, tickets, and temp-voice were removed.

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
- Early claim: see [Early Claim](#-early-claim)

### 🔔 DM Notifications
Claim confirmations, boss respawn reminders, and warnings are sent via **DM**. Each user can toggle DMs with the **🔕** button on any panel.

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

---

## ⏰ Automatic Schedules

| Time (Server/Berlin) | Action |
|----------------------|--------|
| **Every 15s** | Panel tick — countdowns, cooldowns, auto-respawn, timeouts, force refresh |
| **5 min before boss spawns** | 🛡️ Boss spawn alerts (world bosses, layer 1/3) |
| **10 min before events** | 🚨 Scheduled event alerts with @everyone (Red Boss, Leader 3, Purgatory, weekly events, etc.) |
| **18:00 daily** | 📤 Daily claim report dispatched (as `.txt` file + summary embed) |
| **Every 6 hours** | 💾 Automatic database backup (keeps last 7 per file) |

---

## 🏗️ Auto Channel Setup

On boot, `auto-channel-setup.js` **deletes all text channels** in the configured categories and recreates them:

```
7F:  🔸┃sp7  🔹┃ms7
8F:  🔸┃sp8  🔹┃ms8
9F:  🔸┃sp9  🔹┃ms9
10F: 🔸┃sp10 🔹┃ms10
11F: 🔸┃sp11 🔹┃ms11
12F: 🔸┃sp12 🔹┃ms12
Summons: 🌀┃summons
```

Each channel gets its panel embeds + buttons posted automatically.

---

## 📦 Data Files

| File | Contents |
|------|----------|
| `database.json` | Panel state, claims, owners, queues (gitignored) |
| `daily-logs.json` | Accumulated claim log queue + configured channel IDs |
| `punishments.json` | Temporary claim cooldowns after kick/leave |
| `early-claim-users.json` | Users allowed to claim early |
| `dm-optout.json` | Users who disabled DMs |

All are gitignored and backed up automatically.

---

## ⚙️ Setup

### 1. Environment
Create a `.env` file:
```
TOKEN=your-bot-token
```

### 2. Configuration
- **`src/core/config.js`** — `DISCORD_SERVER_ID` (the guild the bot operates on)
- **`src/handlers/auto-channel-setup.js`** — category IDs + channel/panel definitions
- **Daily logs / boss alerts / event alerts** — configured **manually in `daily-logs.json`**: set `configChannelId` (daily claim report), `bossSpawnChannelId` (boss spawn alerts), and `scheduledEventChannelId` (event alerts) to the target channel IDs before boot

### 3. Permissions
| Permission | Required For |
|-----------|-------------|
| **Manage Messages** | `!earlyclaim`, reset/kick/reset-logs admin actions |
| **Manage Channels** | Auto channel setup (delete/recreate channels on boot) |

### 4. Run
```
npm install
npm start
```

---

## 🏗️ Project Structure

```
src/
├── index.js                        # Entry point — boots claim, auto-setup, tick, backups
├── auto-backup.js                  # Backup scheduler (every 6h)
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
│   ├── auto-channel-setup.js       # Channel recreation + panel deployment on boot
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

- [ ] Boot → all floor channels recreated + panels deployed (auto-setup)
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
- [ ] **Auto backup** — `backups/` folder populated after 1 min
