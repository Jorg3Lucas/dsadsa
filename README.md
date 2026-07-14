# 🤖 MIR4 Discord Bot

Multi-functional Discord bot for managing MIR4 guild operations, including claim systems, ranking synchronization, salary polls, and more.

---

## 📋 Overview

All management features are accessible through the **`/manage`** slash command, which opens an interactive button panel. No text commands are needed — everything is done via buttons, menus, and modals.

---

## 🖱️ Main Commands

### 👤 Player Commands
| Command | Description |
|---------|-------------|
| `/register` | Link your Discord account to your MIR4 character (fuzzy auto-correct included) |
| `/pilot @user` | Add a pilot to your account (max 4) |
| `/removepilot` | Remove a pilot from your account |

### 👑 Admin Commands
| Command | Description |
|---------|-------------|
| `/manage` | Open the **Management Panel** — the central hub for all bot controls |
| `/forcesync` | Force immediate sync with official MIR4 ranking |
| `/manualregister @user nickname` | Manually register a user |
| `/manualpilot @owner @pilot` | Manually link a pilot |
| `/manualremove @user` | Remove a user's registration |
| `/manualremovepilot @owner @pilot` | Remove a pilot link |
| `/cleandb` | Remove duplicate entries from the database |

---

## 🛠️ Management Panel (`/manage`)

The management panel is the **central hub** for all bot controls. Organized into **8 categories**, each with interactive buttons and select menus.

### 🏗️ Panels
| Button | Description |
|--------|-------------|
| **🔄 Reset Panel** | Reset any panel to defaults (or select **Reset All**) |
| **👢 Kick User** | Remove a user from their claim — select from a list of active claims |
| **📋 Deploy Panels** | Deploy MS, SP, Summon panels in the current channel |

**Deploy Panels options:**
- **MS7–MS10** — Normal floor + Antidemon (2 panels each)
- **MS11–MS12** — Leaders, Events, Antidemon, Goblin (4 panels each)
- **SP7–10** — All regular Secret Peaks (4 panels)
- **SP11** — SP11 + Goblin (2 panels)
- **SP12** — SP12 + Random Event + Goblin (3 panels)
- **ALL** — Deploy all 26 panels at once

### 🔒 Reservations
| Button | Description |
|--------|-------------|
| **➕ Reserve** | Start a multi-step interactive flow to reserve Fury/Frenzy slots |
| **🔓 Open Event** | Clear reservations for Fury, Frenzy, or Both |
| **🗑️ Clear All** | Remove ALL reservations at once |

**➕ Reserve flow:**
1. Click **➕ Reserve** → modal asks **"Who is this for?"**
2. Enter the player's nickname → Submit
3. Select **Fury** or **Frenzy**
4. Select **MS11**, **MS12**, or both floors
5. Select **All hours** or specific time slots
6. Review and **Confirm** ✅
7. Panels are automatically updated

**🔓 Open Event:**
- Select **Fury**, **Frenzy**, or **Both** to clear all reservations for that event
- All affected panels are refreshed automatically

### 📢 Channels
| Button | Description |
|--------|-------------|
| **📜 Set Logs Channel** | Configure daily report channel (uses current channel) |
| **🚨 Set Boss Channel** | Configure boss spawn alerts |
| **📅 Set Events Channel** | Configure event notifications |

### 👥 Players
| Button | Description |
|--------|-------------|
| **📝 Register** | Opens the same register modal as `/register` |
| **👤 Pilot** | Info about adding pilots |
| **🗑️ Remove Pilot** | Info about removing pilots |
| **🔄 Force Sync** | Trigger full ranking sync (with timed confirmation) |

### 📋 Logs
| Button | Description |
|--------|-------------|
| **📤 Dispatch Now** | Send daily activity report to the configured log channel |

### 💰 Salary
| Button | Description |
|--------|-------------|
| **📢 Set Channel** | Configure salary poll channel (uses current channel) |
| **📈 Set Spreadsheet** | Link Google Spreadsheet ID (modal input) |
| **📤 Export** | Force-export votes to spreadsheet |
| **📊 Post Report** | Post salary report to configured channel (cleans old bot messages first) |

### 🎫 Tickets
Create a ticket panel in the current channel — users can open support tickets.

### 🔄 Update
**Update Bot** — Git pull + npm install + pm2 restart (with timed confirmation, 30s timeout)

---

## 📊 Salary Poll System

The salary poll runs automatically on a weekly schedule:

| Day | Time (BRT) | Event |
|-----|-----------|-------|
| **Monday** | 12:30 | 🟢 Poll opens — channel is cleaned (old bot msgs deleted), fresh poll sent with @everyone |
| **Monday–Wednesday** | — | 🗳️ Members vote on salary composition |
| **Wednesday** | 13:00 | 🔴 Poll closes — votes exported to Google Sheets |
| **Wednesday** | 16:00 | 📊 Salary report posted — @everyone with "Check Your Salary" button |
| **Friday** | 13:00 | 🔄 Votes reset to 100% Darksteel default |

### Voting
1. Click **🗳️ Vote / Change Vote** on the poll message
2. Select **% of Yellow Stones** and **% of Purple Stones**
3. Darksteel % is automatically calculated as remainder
4. Click **✅ Confirm Vote**

> Pilots vote on behalf of their owner. The vote is recorded under the owner's name.

### Salary Check
After Wednesday's report, click **🔍 Check Your Salary** to see your personal breakdown:
- ⚪ Darksteel % and quantity
- 🎨 Yellow Stones % and pts
- 🟣 Purple Stones % and pts

---

## 🔍 Fuzzy Auto-Correct

The bot includes fuzzy matching (Levenshtein distance) to handle common typos:

### `/register`
- If you type a name close to one in the ranking cache, it **auto-corrects** and shows `✏️ Auto-corrected from "X" → "Y"`
- If the corrected name conflicts with another registered user, the registration is **blocked** with a clear error message
- Detects conflicts if your name is very similar (>70%) to another registered user

### `/manualregister`
- If exact match fails, tries **fuzzy match** against the ranking cache
- Shows 3 buttons: **✅ Use suggestion**, **✍️ Register as typed**, **❌ Cancel**

---

## 🔑 Antidemon Password Flow

After claiming an antidemon room, you can set a party password:

1. Click **🔒 Set PT LEFT** (or **🎮 PT LEFT** if already set)
2. If no password: bot asks **"Did you create a private party?"**
   - **✅ Yes** → Modal opens to enter the password
   - **❌ No** → "No problem! Party hidden by default."
3. If already set: modal opens **directly** with the current password pre-filled
4. You can update or clear the password at any time

---

## ⏰ Automatic Schedules

| Time (BRT) | Action |
|-----------|--------|
| **Daily 17:00** | Ranking sync — updates nicknames, roles, and pilot links |
| **Monday 12:30** | Salary poll opens (channel cleaned first — old bot msgs deleted) |
| **Wednesday 13:00** | Salary poll closes + exports to spreadsheet |
| **Wednesday 16:00** | Salary report posted |
| **Friday 13:00** | Salary votes reset to default |
| **Every 6 hours** | Automatic database backup |

---

## ⚙️ Setup

### Initial Configuration
1. Use `/manage` to open the management panel
2. Go to **📢 Channels** to configure log/boss/event channels
3. Go to **💰 Salary** → **Set Channel** to configure salary poll
4. Use **📋 Deploy Panels** in **🏗️ Panels** to deploy MS/SP/Summon panels

### Salary Spreadsheet
1. Go to **💰 Salary** → **Set Spreadsheet**
2. Enter the Google Spreadsheet ID
3. The sheet must have a **PLAYERS** tab with names in column B (starting row 7)

---

## 🔐 Permissions

| Permission | Required For |
|-----------|-------------|
| **Manage Messages** | Access to `/manage` panel and all admin features |
| **Manage Guild** | Configuring channels (logs, boss, events, salary) |

---

## 🏗️ Project Structure

```
├── index.js                     # Bot entry point & interaction router
├── state.js                     # Module-level state (db, client, configs)
├── bot.js                       # Claim system initialization
├── claim-core.js                # Core claim logic
├── claim-handlers.js            # Interaction router
├── management-menu.js           # /manage button panel (all management UI)
├── panel-render.js              # Embed & button rendering
├── panel-utils.js               # Panel utilities
├── panel-tick.js                # Real-time panel updates
├── salary-poll.js               # Salary poll system
│
├── interactions/
│   ├── antidemon-interactions.js # Antidemon room handlers (password, slide, ticket, queue)
│   ├── summon-interactions.js    # Summon location handlers
│   ├── floor-interactions.js     # Regular floor handlers
│   ├── admin-interactions.js     # Admin interaction handlers (reset, kick, reserve flow)
│   └── salary-interactions.js    # Salary vote handlers
│
├── ranking-handlers.js          # Ranking (MIR4) slash command handlers
├── ranking-commands.js          # Slash command registration
├── ranking-sync-engine.js       # Ranking sync logic
├── ranking-scraper.js           # MIR4 ranking web scraper
├── ranking-cache.js             # Ranking cache + fuzzy matching
├── ranking-events.js            # Discord events (welcome, leave, cron)
├── ranking-constants.js         # Constants (clan roles, server IDs)
│
├── lang.js / lang.json          # Localization
├── time-utils.js                # Time utilities
├── constants.js                 # Bot constants
├── auto-backup.js               # Automatic backup system
├── daily-logs.js                # Daily activity logs
├── ticket-system.js             # Ticket support system
├── temp-voice.js                # Temporary voice channels
├── salary-poll.js               # Salary poll system
└── auto-channel-setup.js        # Auto channel setup
```

---

## 🧪 Test Checklist

After any changes, verify these flows:

- [ ] `/manage` opens the management panel with all buttons
- [ ] **Panels → Deploy Panels** — MS7, MS11, ALL deploy correctly
- [ ] **Reservations → Reserve** — full multi-step flow works (Fury/Frenzy, MS11/MS12, All hours/specific slots)
- [ ] **Reservations → Open Event** — clears Fury/Frenzy/Both, panels refresh
- [ ] **Reservations → Clear All** — removes all reservations
- [ ] **Channels → Set Logs/Boss/Events** — saves channel ID
- [ ] **Salary → Post Report** — cleans old bot messages, sends report
- [ ] **Salary → Export** — exports votes to spreadsheet
- [ ] **Update Bot** — timed confirm, git pull, npm install, restart
- [ ] **🔒 Password flow** — set, update, clear password on antidemon rooms
- [ ] **Fuzzy auto-correct** — typo in `/register` auto-corrects; duplicate detection blocks conflicts
