# 🤖 MIR4 Bot — Claim + Ranking

Discord bot for MIR4 clans combining two systems:
- **🎮 Claim system** — Magic Square / Secret Peak claim rotations: floor claims, antidemon rooms, event groups (Fury/Frenzy), summons, reservations, and boss/event alerts
- **👑 Ranking / Registration system** — member registration (owners + pilots), approvals, official-ranking sync, clan roles, management and notify panels

> Salary polls, support tickets, and temp-voice were removed.

---

## 📋 Overview

The bot does **not** create or delete claim channels automatically. You create the floor channels manually on your server and post the panels into each one with a simple `!` command (see [Panel Commands](#-panel-commands)). On every boot, the bot **re-posts the panels into the channels where they were last posted** (replacing the old messages with fresh ones). Claiming is done via **buttons on the panels**; registration/ranking is done via **slash commands**.

---

## 👑 Ranking / Registration System

### 📝 Registration
- **Welcome panel** — members click **Register as Owner** (main account) or **Register as Pilot** (play for someone else)
- **Approvals** — admins approve/reject registrations; temporary registrations expire if not validated in the official ranking
- **Pilots** — each owner can link up to **4 pilots**; pilots get the owner's nickname/role

### 🔄 Ranking Sync
- Daily automatic synchronization with the **official MIR4 ranking portal** (NA42)
- Nickname + clan role validation — members not found in an allied clan lose their role
- Clan roles are auto-discovered and applied to claim channels (view-only permissions)

### ⚡ Slash Commands (registered automatically at boot)

| Command | Description |
|---------|-------------|
| `/removepilot` | Remove a pilot from your account |
| `/forcesync` | [Admin] Force an immediate ranking sync |
| `/manualregister` / `/manualforce` | [Admin] Register a member manually |
| `/manualpilot` / `/manualremovepilot` | [Admin] Link / unlink a pilot manually |
| `/manualremove` | [Admin] Completely remove a registration |
| `/cleandb` | [Admin] Remove duplicate nickname entries |
| `/manage` | Bot management panel (users, pilots, allied clans) |
| `/sendpanel` | [Admin] Send the registration panel to this channel |
| `/pending` | [Admin] List pending registration requests |
| `/notify` | [Admin] DM members with no roles to register |
| `/elderguide`, `/stats` | Guides and bot statistics |

### 🤝 Clan Roles & Channel Permissions
One role per allied clan is **created automatically during the daily sync**. Members registered in an allied clan receive their clan role, and the claim channels are restricted to clan-role holders (+ GoW Kids temp role). Claim-channel permissions are re-applied at every boot from the roles stored in the DB.

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
Opened with **`!reset`** — reset one panel (or **all**) to defaults.

### 👢 Kick User
Opened with **`!kick`** — remove a user from any claim (floor, room, or event) and open the spot for the next in queue.

### 📅 Reserve Fury / Frenzy
Opened with **`!reserve @user`** — multi-step interactive flow:
1. Select **event** (Fury / Frenzy)
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

## 📜 Text Commands (`!`)

All text commands require **Manage Messages**. The bot never deletes/creates channels — it only posts panels and menus in the channel where the command is typed.

### 🗺️ Panel Commands
Post the panels of a floor into the current channel, replacing any previously posted ones for that floor in that channel:

| Command | Panels posted |
|---------|---------------|
| `!ms7` … `!ms10` | Magic Square normal + Antidemon |
| `!ms11` … `!ms12` | MS Leaders + Events + Antidemon + Goblin |
| `!sp7` … `!sp10` | Secret Peak |
| `!sp11` | Secret Peak + Goblin |
| `!sp12` | Secret Peak + Random Event + Goblin |
| `!summons` (or `!summon`) | Summon locations |

### 👑 Admin Commands

| Command | Description |
|---------|-------------|
| `!reset` | Open the panel reset menu (single panel or **all**) |
| `!reset <key>` | Reset one panel directly (e.g. `!reset 10squarenormal`) |
| `!reset all` | Reset all panels to defaults |
| `!kick` | Open the kick menu — remove a user from any claim and open the spot for the next in queue |
| `!reserve @user` | Start the Fury/Frenzy reservation flow for that user |
| `!reminders` | Set this channel as the **boss alert** channel (or `!reminders #channel`) |
| `!events` | Set this channel as the **event alert** channel (or `!events #channel`) |

---

## ⏰ Automatic Schedules

| Time (Server/NA — fixed UTC-4, never changes) | Action |
|----------------------|--------|
| **Every 15s** | Panel tick — countdowns, cooldowns, auto-respawn, timeouts, force refresh |
| **5 min before boss spawns** | 🛡️ Boss spawn alerts (world bosses, layer 1/3) |
| **10 min before events** | 🚨 Scheduled event alerts with @everyone (Red Boss, Leader 3, Purgatory, weekly events, etc.) |

---

## 🏗️ Channel & Panel Deployment

The bot never creates or deletes channels. Deployment is fully manual:

1. **Create the channels** you want on your server (e.g. `🔹 MS-10F`, `🔸 SP-10F`, `🌀 Summons`)
2. In each channel, type the matching command (e.g. `!ms10` in the MS-10 channel) — the bot posts the panels there
3. On every **restart**, the bot automatically re-posts the panels into the channels where they were last posted (old messages are replaced by fresh ones)

The channel/panel mapping lives in **`src/core/server-structure.js`** (`CLAIM_CATEGORIES`).

---

## 📦 Data Files

| File | Contents |
|------|----------|
| `database.json` | Panel state, claims, owners, queues (gitignored) |
| `daily-logs.json` | Alert channel IDs: `bossSpawnChannelId` (boss alerts), `scheduledEventChannelId` (event alerts) |
| `punishments.json` | Temporary claim cooldowns after kick/leave |
| `early-claim-users.json` | Users allowed to claim early |
| `dm-optout.json` | Users who disabled DMs |
| `database_ranking.json` | Ranking DB — registrations, pilots, clan roles, allied clans (gitignored) |
| `ranking_cache.json` | Synced ranking cache (gitignored) |
| `ranking_logs.txt` | Ranking event log (gitignored) |
| `backups/` | Automatic backups of the ranking files (gitignored) |

All are gitignored.

---

## ⚙️ Setup

### 1. Environment
Create a `.env` file:
```
TOKEN=your-bot-token
```

### 2. Configuration
- **`src/core/config.js`** — `DISCORD_SERVER_ID` (the guild the bot operates on)
- **`src/core/server-structure.js`** — `CLAIM_CATEGORIES` (category/channel/panel definitions)
- **Boss / event alerts** — run **`!reminders`** in the channel that should receive boss spawn alerts and **`!events`** in the channel that should receive scheduled event alerts (both require Manage Messages). This writes `bossSpawnChannelId` / `scheduledEventChannelId` to `daily-logs.json`. Alternatively, edit those IDs manually, or just create channels named `⏰ reminders` / `📅 events` — the bot falls back to them by name.
- **Ranking sync** — configured in `src/core/ranking-constants.js` (sync worlds) and `database_ranking.json` (allied clans, clan roles, channel IDs)

### 3. Permissions
| Permission | Required For |
|-----------|-------------|
| **Manage Messages** | All `!` commands: panels (`!ms`/`!sp`/`!summons`), `!earlyclaim`, `!reset`, `!kick`, `!reserve` |
| **Administrator** | Ranking slash commands (`/forcesync`, `/manage`, `/sendpanel`, etc.) |

### 4. Run
```
npm install
npm start
```

---

## 🏗️ Project Structure

```
src/
├── index.js                        # Entry point — boots claim + ranking systems, text commands, tick
├── auto-backup.js                  # Automatic backups of ranking data files
├── deploy-commands.cjs             # Manual slash-command deployment script
├── core/
│   ├── config.js                   # DISCORD_SERVER_ID, token helpers
│   ├── constants.js                # Status strings, embed colors
│   ├── state.js                    # Module-level state (db, punishments, early claim, DM opt-out)
│   ├── lang.js / lang.json         # Localization (all UI text)
│   ├── time-utils.js               # Time helpers, boss schedules
│   ├── logger.js                   # Structured logger + global error handlers
│   ├── daily-logs.js               # Alert channel resolver + config persistence
│   ├── discord-utils.js            # Shared Discord send helpers
│   ├── server-structure.js         # Claim category/channel definitions + alert channel names
│   ├── clan-roles.js               # Clan role discovery + claim-channel permissions
│   └── ranking-*.js                # Ranking system: cache, constants, deploy, events, handlers,
│                                   #   logger, scraper, service, storage, sync-engine, utils
├── handlers/
│   ├── bot.js                      # Claim system initialization + router export
│   ├── claim-handlers.js           # Unified interaction router (claim first, then ranking)
│   ├── claim-core*.js              # Claim logic (utils, rooms, options, actions)
│   ├── panel-render.js             # Embed + button rendering
│   ├── render-embed*.js            # Panel embed builders
│   ├── render-buttons.js           # Panel button builders
│   ├── panel-tick.js               # 15s tick (cooldowns, respawn, alerts)
│   ├── tick-*.js                   # Per-panel-type tick logic
│   ├── panel-utils.js              # Panel refresh helpers + DM notifications
│   ├── panel-dm.js                 # DM message handling
│   ├── panel-migrations.js         # Data migrations
│   ├── panel-commands.js           # !ms / !sp / !summons — post panels into the channel
│   ├── admin-commands.js           # !reset / !kick / !reserve — open admin menus
│   ├── boss-spawn-scheduler.js     # Boss + scheduled event alerts
│   ├── early-claim.js              # !earlyclaim admin commands
│   └── ranking-*.js                # Registration, approvals, commands, confirmations, management,
│                                   #   notify, pilot, welcome
└── interactions/
    ├── floor-interactions.js       # Floor/peak buttons (claim, cancel, next)
    ├── floor-*.js                  # Floor-specific handlers
    ├── antidemon-interactions*.js  # Antidemon rooms (slide, ticket, queue, password)
    ├── summon-interactions.js      # Summon handlers
    ├── floor-summon.js             # Summon claim flow
    ├── admin-interactions.js       # Admin reset/kick
    └── admin-reserve.js            # Fury/Frenzy reservation flow
```

---

## 🧪 Test Checklist

After any changes, verify:

- [ ] Boot → both systems start; slash commands registered; panels re-posted in their last-known channels
- [ ] **Ranking registration** — welcome panel, owner/pilot registration, approvals
- [ ] **Ranking sync** — `/forcesync`, clan roles created from allied clans, claim-channel permissions applied
- [ ] **Ranking manage** — `/manage`, `/notify`, `/pending`
- [ ] **Floor claim** — claim, leave, queue promotion, grace period
- [ ] **Boss killed** → cooldown → auto-respawn → DM reminder
- [ ] **Antidemon rooms** — left/mid/right, combo rooms, password modal
- [ ] **Antidemon queue** — slide / ticket / queue join
- [ ] **Fury/Frenzy fixed events** — claim inside window, reservation blocks
- [ ] **Panel commands** — `!ms10` / `!sp10` / `!summons` post the right panels in the channel, replace old ones on re-run
- [ ] **Early claim** — `!earlyclaim add/remove/list` + claiming 5 min early
- [ ] **Admin** — `!reset` (menu + direct), `!kick`, `!reserve @user`
- [ ] **Reserve flow** — reserve Fury/Frenzy slots, panel refresh
- [ ] **🔕 DM opt-out** — toggle disables/re-enables DMs
- [ ] **Boss alerts** — 5 min boss spawn + 10 min event alerts
