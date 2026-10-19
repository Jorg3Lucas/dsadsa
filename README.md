# MIR4 Ranking Bot

A Discord bot for managing MIR4 clan member registrations, role assignment, and EU ranking synchronization.

## Features

- **Self-registration** via welcome buttons (Owner / Pilot)
- **Admin approval workflow** with permanent or temporary (3-day) registration
- **Automatic EU ranking scraper** — fetches Top 1000 players from the official MIR4 ranking portal
- **Daily synchronization** at 20:00 BRT (once a day, on the cron — a restart does **not** trigger an extra sync) — syncs nicknames, roles, and ranking validation
- **Temporary registration** with 3-day expiry, auto-conversion to permanent when found in an allied clan
- **24h reminder DM** before temp registration expires
- **Clan expedition weekend grace period** (Fri 00:01 → Sun 17:00 BRT) — no removals during this window
- **72h out-of-allied-clan grace (per person)** — members keep their role for 72h after leaving an allied clan (or the ranking), so temporary clan switches for events don't strip roles before they can rejoin
- **Allied Clans system** — configure which clans are allied per world
- **Anti-impersonation security system**
- **Auto-backup** of database files
- **Bulk DM** unregistered members who have the role
- **Gateway watchdog** — logs every Discord connection event and auto-restarts the process when the session dies, so the bot can never be stuck as "process online, bot offline"

---

## Configuration

### Environment Variables

Create a `.env` file:

```
TOKEN=your_discord_bot_token
```

### Constants (`ranking-constants.js`)

| Constant | Value | Description |
|----------|-------|-------------|
| `DISCORD_SERVER_ID` | `1481566364631044119` | Your Discord server ID |
| `MEMBER_ROLE_ID` | `1481568299966926879` | Role assigned to registered members |
| `WORLD_IDS` | `{611, 711, 511, 811, ...}` | All world IDs mapped to server names (EU, SA, NA, ASIA1, ASIA2, ASIA3, INMENA) |
| `WORLD_GROUP_IDS` | `{611:3, 711:5, ...}` | World group ID per region (3=EU1, 5=SA1, 2=NA1, 1=ASIA1, 11=ASIA2, 21=ASIA3, 6=INMENA1) |

---

## Commands

### Slash Commands (`/`)

| Command | Who | Description |
|---------|-----|-------------|
| `/removepilot` | Members | Remove a pilot from your account |
| `/forcesync` | Admin | Force immediate sync with official ranking |
| `/manualregister <member> <nickname>` | Admin | Register a player manually (temp if not in allied clan, perm if in allied clan) |
| `/manualpilot <owner> <pilot>` | Admin | Manually link a pilot to an owner |
| `/manualremove <member>` | Admin | Completely remove a player's registration |
| `/manualremovepilot <owner> <pilot>` | Admin | Manually remove a pilot from an owner |
| `/cleandb [apply]` | Admin | Report duplicate nickname entries (same character on several accounts). Default is a **dry run**; pass `apply:true` to remove them (keeps the manual / most-pilots / oldest profile) |
| `/manage` | Admin | Bot management panel with user list and actions |
| `/grace [member]` | Admin | Show remaining 72h grace time for members outside allied clans (all members, or a specific one) |
| `/sendpanel` | Admin | Send a fixed registration panel to the current channel |
| `/listunregistered [notify:true/false]` | Admin | List members with role but no registration; optionally DM them with 5s delay |

### Manage Panel Actions (`/manage`)

After selecting a user from `/manage`:

| Action | Description |
|--------|-------------|
| 🗑️ **Remove registration** | Permanently delete user's profile (with confirmation) |
| 📋 **View Status** | Show detailed info: type (temp/perm), expiry, ranking status, allied clan |
| 🔁 **Assign member role** | Assign the member role to the user |
| ✈️ **Remove pilot** | Unlink a pilot from this user |
| 🗑️ **Remove Temp** | *(only for temp users)* Remove temporary registration immediately |
| ⚙️ **Allied Clans** | Manage allied clans per world |

### Text Commands (`!`)

| Command | Who | Description |
|---------|-----|-------------|
| `!setadminchannel` | Admin | Set the current channel as the admin approval channel |
| `!setwelcome` | Admin | Set the current channel as the welcome channel |
| `!enablevalidation` | Admin | Enable ranking validation (members not in ranking lose role on next sync) |
| `!disablevalidation` | Admin | Disable ranking validation (grace period for existing members) |

---

## Registration Flow

### Owner Registration
1. New member joins or clicks **👑 Register as Owner** button
2. Submits their in-game character name via modal
3. Bot checks ranking cache — shows if found in ranking + allied clan status
4. Admin sees the request in the admin channel:
   - **✅ Approve** — permanent registration (only shown if in allied clan)
   - **⏳ Approve Temporarily (3 days)** — shown if not in ranking or not in allied clan
   - **❌ Reject** — deny registration
5. User receives DM with result
6. Nickname + member role assigned immediately

### Pilot Registration
1. User clicks **✈️ Register as Pilot** button
2. Enters the owner's in-game nickname
3. Owner receives DM to approve/reject
4. On approval, pilot gets nickname "OwnerName - Pilot" + member role

### Temporary Registration (3 days)
- Used when member is not found in ranking or not in an allied clan
- Sets `tempUntil` field (3 days from approval)
- **24h before expiry**: automatic DM reminder
- **Sync engine (step 2.75)**: checks ranking cache every sync
  - If found in an allied clan → **converted to permanent**
  - If expired and not in allied clan → **role removed + registration deleted**
  - **Weekend grace period** (Fri→Sun 17:00 BRT): no removals during expedition

---

## Synchronization Engine

Runs **once a day at 20:00 BRT** — the schedule is defined in `src/core/sync-schedule.js` (`SYNC_HOUR`/`SYNC_MINUTE`/`SYNC_TIME_ZONE`), which drives both the cron in `ranking-events.js` and the startup check below.

A **restart does not run a sync**: `index.js` only runs one when the daily cycle was missed (the bot was offline at the scheduled time — nothing succeeded since the last scheduled moment), so a crash loop or a `/update` restart never triggers extra full syncs. The catch-up is recorded in `db.config.lastSyncAt`; use `/forcesync` for an on-demand run.

| Step | Name | Description |
|------|------|-------------|
| 1 | **Pilot Auto-Link** | Auto-links members with " - Pilot" nickname to their owner |
| 2 | **Anti-Impostor** | Detects members impersonating registered nicknames |
| 2.5 | **Ranking Validation** | *(if enabled)* Removes member role after 72h not found in any EU ranking (per-person grace) |
| 2.75 | **Temp Cleanup** | Converts temps to permanent (if in allied clan) or removes expired temps |
| 3 | **Nickname Sync + Role** | Syncs nicknames and assigns/removes member role (72h per-person grace before removal) |

---

## Allied Clans System

Configure via `/manage` → **⚙️ Allied Clans**:

- Select a world/server
- Add clan names (exactly as they appear in the ranking)
- Remove clans as needed
- Members must be in an **allied clan** visible in the EU ranking to maintain permanent status
- Role removal for leaving an allied clan (or dropping out of the ranking) waits **72h per person** — the countdown starts on the first sync where the member is found outside an allied clan and resets the moment they return (`db.roleNotify[memberId].outOfAlliedSince`)
- When the 72h countdown starts, the member receives an **automatic DM** warning that their role will be removed unless they rejoin an allied clan in time
- Used by the temp registration conversion check and admin approval display

---

## Data Files

| File | Description |
|------|-------------|
| `database_ranking.json` | Main database — user registrations, config, allied clans |
| `ranking_cache.json` | Cached ranking data from the official website |
| `ranking_logs.txt` | Event log file |
| `backups/` | Auto-generated backups (every 6 hours) |

### User Data Structure

```json
{
  "users": {
    "discord_user_id": {
      "nickname": "xVraeL",
      "registeredAt": "2026-01-15T10:30:00.000Z",
      "pilotIds": ["pilot_discord_id"],
      "tempUntil": "2026-01-18T10:30:00.000Z",
      "tempRegisteredAt": "2026-01-15T10:30:00.000Z",
      "tempNotified24h": true
    }
  },
  "config": {
    "adminChannelId": "channel_id",
    "welcomeChannelId": "channel_id",
    "rankingValidationEnabled": false,
    "alliedClans": {
      "611": ["GearsofWar シ", "ToxicFamily"]
    }
  }
}
```

---

## Project Structure

```
├── index.js                  # Entry point — Discord client setup
├── ranking_sync.js           # Barrel exports
├── ranking-commands.js       # Slash command registration
├── ranking-constants.js      # Constants (IDs, world maps)
├── ranking-handlers.js       # All interaction handlers (commands, modals, buttons)
├── ranking-events.js         # Event listeners + text commands + cron
├── ranking-sync-engine.js    # Daily sync logic (5 steps)
├── sync-schedule.js          # When the daily sync runs (cron + startup catch-up)
├── ranking-scraper.js        # MIR4 ranking web scraper
├── ranking-cache.js          # Local ranking cache (read/write)
├── lang.js                   # i18n helper
├── lang.json                 # String translations
├── auto-backup.js            # Automatic database backup
└── package.json
```

---

## Diagnosing an "offline bot"

The bot runs under PM2, so a dead Discord session used to leave the process alive (green in PM2) with the bot offline and **no logs at all**. The gateway watchdog (`src/core/ranking-gateway-watchdog.js`) closes that gap:

| Log line | Meaning |
|----------|---------|
| `🛰️ [Watchdog] Started` | Watchdog armed right after a successful login |
| `💓 [Watchdog] alive \| uptime … \| gateway OK` | Heartbeat written every 15 min — proof the process is alive (and its memory usage) |
| `⚠️ [Gateway] Shard 0 disconnected — code …` | Why the connection dropped, and whether discord.js will auto-reconnect |
| `⚠️ [Watchdog] Gateway unhealthy: …` | Connection is down; a restart is scheduled in 3 minutes |
| `🛑 [Watchdog] Gateway down for …` | No recovery — DB is saved and the process exits so PM2 restarts it |

Health is evaluated every 60s from the shard statuses and the last acknowledged heartbeat (not from `client.isReady()`, which keeps reporting `Ready` after an unrecoverable close such as 4004/4013/4014). The first 2 minutes after login are a grace period so startup work is never mistaken for an outage.

---

## Running

```bash
npm start
```

Requires Node.js 18+ with `--experimental-specifier-resolution=node` or ESM support.

### PM2

Production runs under PM2 with `ecosystem.config.cjs` in the repo root:

```bash
# apply / re-apply the config (short restart of the bot)
pm2 delete gear && pm2 start ecosystem.config.cjs && pm2 save

pm2 logs gear          # gateway + watchdog lines
pm2 describe gear      # memory in use vs max_memory_restart
```

- The app name must stay **`gear`** — the `/update` command runs `pm2 restart gear` internally.
- `pm2 save` keeps the process alive across reboots (`pm2 startup` must have been run once).
- Editing the config requires `pm2 delete gear && pm2 start ecosystem.config.cjs && pm2 save` again (`pm2 restart` does **not** reload it).

#### Memory guard (shared VPS — 5 bots)

The box runs several bots, so the limits are **computed from the machine's real RAM** when `ecosystem.config.cjs` is loaded — no hand-tuning after a resize:

| Setting | Formula | What it catches |
|---------|---------|-----------------|
| `NODE_OPTIONS=--max-old-space-size=<heap>` | RSS cap − 64MB (min 192) | Heap leaks — Node dies with `FATAL ERROR: Reached heap limit` *before* the Linux OOM killer can SIGKILL the process (that error is not catchable, so PM2 does the restart) |
| `max_memory_restart: '<RSS>M'` | 30% of total RAM, clamped 256M–512M | Memory V8 does not count as heap (buffers, external, native leaks) — PM2 restarts the app |
| `restart_delay: 5000`, `max_restarts: 50`, `min_uptime: 10s` | restart policy | Crash loops without hammering the machine or flagging the app as errored on one bad boot |
| `kill_timeout: 5000` | stop grace | SIGINT → DB saved + log buffer flushed before SIGKILL |

Examples: 1 GB box → `307M` RSS / `243M` heap · 1.8–2 GB box → `512M` RSS / `448M` heap. The config prints the values it picked when you run `pm2 start ecosystem.config.cjs`.

Measured baseline: the 76k-player ranking cache is only ~3.3 MB of JSON (~31 MB of heap for two copies), RSS ≈ 200 MB steady and ≈ 250-350 MB during the 20:00 scrape — so neither limit should ever fire in a healthy run. If one does, read the real peak from the `💓 [Watchdog] alive | … | rss …` line in `ranking_logs.txt` and retune the percentages in `ecosystem.config.cjs`.

The **other bots** should get the same treatment — in each of their PM2 configs add:

```js
max_memory_restart: '256M',          // ~90-120MB typical for a small bot
env: { NODE_OPTIONS: '--max-old-space-size=192' },
```
