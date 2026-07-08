# MIR4 Ranking Bot

A Discord bot for managing MIR4 clan member registrations, role assignment, and EU ranking synchronization.

## Features

- **Self-registration** via welcome buttons (Owner / Pilot)
- **Admin approval workflow** with permanent or temporary (3-day) registration
- **Automatic EU ranking scraper** — fetches Top 1000 players from the official MIR4 ranking portal
- **Daily synchronization** at 17:00 BRT — syncs nicknames, roles, and ranking validation
- **Temporary registration** with 3-day expiry, auto-conversion to permanent when found in an allied clan
- **24h reminder DM** before temp registration expires
- **Clan expedition weekend grace period** (Fri 00:01 → Sun 17:00 BRT) — no removals during this window
- **Allied Clans system** — configure which clans are allied per world
- **Anti-impersonation security system**
- **Auto-backup** of database files
- **Bulk DM** unregistered members who have the role

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
| `WORLD_IDS` | `{611,612,...}` | EU world IDs mapped to server names |

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
| `/cleandb` | Admin | Remove duplicate nickname entries from database |
| `/manage` | Admin | Bot management panel with user list and actions |
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

Runs at **17:00 BRT** daily (configurable in `ranking-events.js`) and on startup:

| Step | Name | Description |
|------|------|-------------|
| 1 | **Pilot Auto-Link** | Auto-links members with " - Pilot" nickname to their owner |
| 2 | **Anti-Impostor** | Detects members impersonating registered nicknames |
| 2.5 | **Ranking Validation** | *(if enabled)* Removes members not found in any EU ranking |
| 2.75 | **Temp Cleanup** | Converts temps to permanent (if in allied clan) or removes expired temps |
| 3 | **Nickname Sync + Role** | Syncs nicknames and assigns/removes member role |

---

## Allied Clans System

Configure via `/manage` → **⚙️ Allied Clans**:

- Select a world/server
- Add clan names (exactly as they appear in the ranking)
- Remove clans as needed
- Members must be in an **allied clan** visible in the EU ranking to maintain permanent status
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
├── ranking-scraper.js        # MIR4 ranking web scraper
├── ranking-cache.js          # Local ranking cache (read/write)
├── lang.js                   # i18n helper
├── lang.json                 # String translations
├── auto-backup.js            # Automatic database backup
└── package.json
```

---

## Running

```bash
npm start
```

Requires Node.js 18+ with `--experimental-specifier-resolution=node` or ESM support.
