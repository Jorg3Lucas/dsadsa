# MIR4 Ranking Bot

A Discord bot for managing MIR4 clan member registrations, role assignment, and EU ranking synchronization.

## Features

- **Self-registration** via welcome buttons (Owner / Pilot)
- **Admin approval workflow** with permanent or temporary (3-day) registration
- **Automatic EU ranking scraper** — fetches Top 1000 players from the official MIR4 ranking portal
- **Daily synchronization** at 20:00 BRT — syncs nicknames, roles, and ranking validation
- **Temporary registration** with 3-day expiry, auto-conversion to permanent when found in an allied clan
- **24h reminder DM** before temp registration expires
- **Clan expedition weekend grace period** (Fri 00:01 → Sun 17:00 BRT) — no removals during this window
- **72h out-of-allied-clan grace (per person)** — members keep their role for 72h after leaving an allied clan (or the ranking), so temporary clan switches for events don't strip roles before they can rejoin
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
| `/cleandb` | Admin | Remove duplicate nickname entries from database |
| `/manage` | Admin | Bot management panel with user list and actions |
| `/grace [member]` | Admin | Show remaining 72h grace time for members outside allied clans (all members, or a specific one) |
| `/sendpanel` | Admin | Send a fixed registration panel to the current channel |
| `/listunregistered [notify:true/false]` | Admin | List members with role but no registration; optionally DM them with 5s delay |
| `/scanallied <list> [apply]` | Admin | Scan a `Nickname,Username` list copied from an allied server and register the members found in allied clans (dry run unless `apply:true`) |
| `/pilotbulk [owner] [apply]` | Admin | Link the pilots queued by `/scanallied` to their owners (bulk `/manualpilot`); `owner` forces one owner for the whole queue. Ambiguous pilots get an owner picker right in the reply |
| `/pilotmarkers <action> [name] [regex] [owner_group] [position]` | Admin | List, add, remove or reset the pilot markers used by `/scanallied` |

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

Runs at **20:00 BRT** daily (configurable in `ranking-events.js`) and on startup:

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

## Allied List Scan (`/scanallied`)

Bulk registration from a member list copied from another (allied) server — e.g. via the browser table copy.

1. Attach the list as a file (`.csv`/`.txt`, one `Nickname,Username` per line, header optional; quotes, commas, tabs and `;` are handled).
2. Run `/scanallied list:<file>` — **dry run**: it only reports what it would do.
3. Run `/scanallied list:<file> apply:true` to actually register and hand out the member role.

How each line is matched and validated:

- **Match to a member** — by Discord username first (usernames are global, so this is the strongest key; case-insensitive), then by game name (the nickname column with the `[EU11]` tag, clan separators like `•`, pilot markers `(P)` and the `EU021 - ` prefix stripped).
- **Ranking lookup** — the matched name is resolved in the local ranking cache, and by a live forum search when the cache has nothing.
- **Allied check** — the member role is only granted when the resolved clan is one of the allied clans configured in `/manage` → ⚙️ Allied Clans.
- **Already registered + role** — left completely untouched.
- **Registered but without the role** — only the role is re-assigned; the stored nickname is never changed.
- New registrations follow the **normal** flow (no `manualPermanent`), so the daily sync keeps validating them.
- **Resolving the queue** — `/pilotbulk` shows every queued pilot and links those whose owner is unambiguous (exact name, or a single fuzzy candidate ≥ 75%). Ambiguous ones come with a **owner select menu** in the same message: pick the owner and the pair is linked (pilotIds + nickname + role) on the spot; `apply:true` links the unambiguous ones, and `owner:@X` forces a single owner for the whole queue (cap of 4 pilots per owner).

### Pilot markers

The list also tells whether a line belongs to a **pilot** — pilot status is not in the ranking, it is read from the nickname text:

| Marker form | Example | Detected as |
|---|---|---|
| `(P-owner)` / `[P-owner]` | `St • JAY (P-cecilia)` | pilot `St • JAY`, owner `cecilia` |
| `(P)` / `(Pilot)` / `[ᴘ]` (+ owner after it) | `St • Adi (P) Zay` | pilot `St • Adi`, owner `Zay` |
| `Name Pilot Owner` | `St • mєjєrє Pilot OGUN` | pilot `St • mєjєrє`, owner `OGUN` |
| `… - Pilot` (suffix this bot assigns) | `EU031 - Owner - Pilot` | pilot `EU031 - Owner`, owner unknown |

- The name **before** the marker is the character of the line; the name **after** it is the owner.
- **Owner identified** (registered member, allied clan) → the pilot is linked to the owner (`pilotIds` + `<Owner> - Pilot` nickname + member role), capped at 4 pilots per owner.
- **Owner not identified** → the pilot is **renamed right away** to `<Dono sugerido> - Pilot` (server-prefixed when the owner name is in the ranking), registered as a regular member and queued in `db.scanPilotPending`. While the entry is in the queue the daily sync keeps that nickname (and never treats it as impersonation), so it survives until the pair is resolved with `/pilotbulk` or `/manualpilot` — or until the owner registers and the sync auto-links them. Pilots whose list line has no owner name keep their own nickname.
- Markers are configurable per server with `/pilotmarkers`: `add` (optional `owner_group`, `position:first/last`), `remove`, `reset`. Patterns are regexes tried in order — the first one that matches wins. Defaults: `pilot-suffix`, `p-dash`, `p-bracket`, `pilot-word`.

### Reports

Both runs reply with a summary plus a full per-member report attached as a `.txt` file, which includes the **pilot marker found on every list line** (pattern name, matched text, character and owner) and the list entries that have no member in this server.

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
├── ranking-scan.js           # /scanallied — allied list scan + bulk registration
├── ranking-pilot-bulk.js     # /pilotbulk — link the queued pilots to their owners
├── ranking-pilot-patterns.js # /pilotmarkers — configure the pilot markers
└── package.json
```

---

## Running

```bash
npm start
```

Requires Node.js 18+ with `--experimental-specifier-resolution=node` or ESM support.
