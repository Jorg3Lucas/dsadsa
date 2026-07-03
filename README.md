# Discord MIR4 Bot — Gear

A feature-rich Discord bot for managing MIR4 guild operations, including claim panels, salary polls, ticket systems, boss spawn alerts, and player registration with role synchronization.

## Features

### 📋 Claim Panels
- **Secret Peak floors** (7F–12F) — Boss kill tracking with cooldown-based and schedule-based respawn timers
- **Magic Square floors** (7F–12F) — Leader boss tracking + Antidemon room management
- **Summon Locations** — SP 2F, 4F, 7F + individual Goblin panels (SP11, SP12, MS11, MS12)
- **Event Groups** — Fury/Frenzy fixed events, schedule-based events, goblin summons
- **Random Event (SP12)** — Fixed schedule event
- Queue system with grace periods and DM notifications
- Party password management for antidemon rooms
- 2-level room selection for MS11/MS12 (9 rooms: 3 versions × 3 sides)

### 📊 Salary Poll System
- Weekly salary composition voting (Yellow Stones / Purple Stones / Darksteel)
- Poll opens Monday 12:30 BRT, closes Wednesday 13:00 BRT
- Google Sheets integration for vote export
- Per-server independent states
- Salary report posted Wednesday 16:00 BRT

### 👑 Player Registration & Role Sync
- `/register` — Link Discord account to MIR4 character
- `/pilot` / `/removepilot` — Manage pilot employees (up to 4)
- `/forcesync` — Force role synchronization
- `/manage` — Admin player management menus
- Manual clan assignment for edge cases
- Automatic nickname and role synchronization
- Pilot auto-linking and anti-impostor security

### 🎫 Ticket System
- User-opened support tickets with category selection
- Staff member add/remove functionality
- Ticket logging with message and attachment archiving
- Automatic log dispatch to configured channels

### 🔉 Temp Voice Channels
- Auto-creates private voice channels when users join the source channel
- Clan-role-based access permissions
- Auto-deletes when empty

### 🦁 Boss Spawn Alerts
- Scheduled alerts for L3 bosses across all worlds
- Event alerts for Red Boss, Leader 3, Purgatory, Golden Sphere, etc.
- Weekly event alerts (Krukan, Valley War, Hellbar, Heist, etc.)

### ⚙️ Multi-Server Configuration
- Each in-game server (e.g., EU013, AOEN) has independent configuration
- Per-server categories, channels, clan roles, and ranking URLs
- Channel-based interaction routing via `!setup` menu

## Getting Started

### Prerequisites
- Node.js 18+
- Discord Bot Token
- Discord Server with appropriate permissions

### Installation

```bash
# Clone the repository
git clone <repo-url>
cd gear

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your Discord bot token
```

### Environment Variables

| Variable | Description |
|---|---|
| `TOKEN` or `DISCORD_TOKEN` | Discord bot token |
| `GOOGLE_CREDENTIALS` | (Optional) Google service account JSON for Sheets export |

### Running

```bash
node index.js
```

### Initial Setup

1. Invite the bot to your server with required intents
2. The bot auto-creates `server-config.json` on first run
3. Use `!setup` in a Discord channel to open the configuration menu:
   - Add in-game servers (e.g., AOEN, EU013)
   - Configure Discord categories for each floor
   - Set up channels for logs, salary, boss spawns, etc.
4. Use `!deploy` to register slash commands
5. Place panel messages in their respective category channels (or use auto-setup)

### Auto Channel Setup

If categories are configured via `!setup`, the bot can auto-create channels and deploy panels on boot:
1. Configure all floor categories in `!setup`
2. Restart the bot — channels are created, panels are deployed

## Commands

### Slash Commands (after `!deploy`)

| Command | Description |
|---|---|
| `/register` | Link Discord to MIR4 character |
| `/pilot <member>` | Add a pilot employee (max 4) |
| `/removepilot` | Remove a pilot employee |
| `/forcesync` | Force role sync (admin) |
| `/manualregister` | Manual registration (admin) |
| `/manualpilot` | Manual pilot link (admin) |
| `/manualremove` | Remove registration (admin) |
| `/manualremovepilot` | Remove pilot link (admin) |
| `/manage` | Player management menu (admin) |
| `/cleandb` | Clean duplicate DB entries (admin) |

### Text Commands

| Command | Description |
|---|---|
| `!setup` | Open server configuration menu |
| `!setlogs` | Set this channel as daily logs channel |
| `!setbosschannel` | Set boss spawn alert channel |
| `!seteventchannel` | Set event alert channel |
| `!testevent` | Send test event alert |
| `!logs` | Dispatch daily logs report |
| `!resetlogs` | Clear daily logs queue |
| `!setticket` | Deploy ticket panel in this channel |
| `!kick` | Open claim removal menu (admin) |
| `!reset` | Reset panel data (admin) |
| `!update` | Git pull + restart (admin) |
| `!deploy` | Register slash commands |
| `!status` | Show server configuration status |

## Architecture

### Project Structure

```
├── index.js                    # Bot entry point & event router
├── bot.js                      # Claim system initialization
├── claim-core.js               # Core claim/queue/punishment logic
├── claim-handlers.js           # Interaction & command router
├── claim-resolver.js           # Per-server key resolution
├── panel-render.js             # Embed & button rendering
├── panel-tick.js               # 15s tick loop (timeouts, alerts)
├── panel-utils.js              # Panel refresh, migrations, recovery
├── server-config.js            # Multi-server configuration module
├── ranking-constants.js        # Dynamic constants (CLAN_ROLES, etc.)
├── ranking-sync-engine.js      # Role/nickname sync logic
├── ranking-scraper.js          # MIR4 official ranking scraper
├── ranking-handlers.js         # Ranking command interaction handlers
├── ranking-commands.js         # Slash command definitions
├── ranking-events.js           # Guild member events + cron
├── ranking-cache.js            # Local ranking data cache
├── ranking_sync.js             # Ranking barrel exports
├── salary-poll.js              # Weekly salary voting system
├── ticket-system.js            # Support ticket system
├── temp-voice.js               # Temporary voice channels
├── daily-logs.js               # Daily claim log reports
├── boss-spawn-scheduler.js     # Boss & event spawn alerts
├── auto-channel-setup.js       # Automatic channel creation
├── time-utils.js               # Time formatting & schedule utils
├── constants.js                # Shared status/color constants
├── state.js                    # Module-level state
├── lang.js / lang.json         # Localization system
├── interactions/               # Interaction sub-handlers
│   ├── floor-interactions.js   # Floor claim/death/cancel
│   ├── antidemon-interactions.js
│   ├── summon-interactions.js
│   ├── admin-interactions.js
│   └── salary-interactions.js
└── commands/                   # Text command modules
    ├── admin-commands.js
    ├── panel-commands.js
    ├── salary-commands.js
    └── server-setup.js
```

### Key Concepts

**Per-Server Prefixing:** All panel keys are prefixed with the server ID (e.g., `eu013_7peak`) to support multiple in-game servers within a single Discord server.

**Interaction Routing:** `claim-handlers.js` routes interactions to specialized sub-handlers based on the `customId` prefix.

**Tick Loop:** `panel-tick.js` runs every 15 seconds, handling:
- Timeout expirations for claims and queue slots
- Schedule-based auto-respawns (Red Boss, Leader 3)
- Boss spawn alerts (5 min before)
- Fixed event open/close transitions
- Daily log dispatch at 18:00 Berlin time

### Database Files

Each in-game server has its own set of data files, automatically created on first save:

| File | Pattern | Content |
|---|---|---|
| **`database_<server>.json`** | `database_*.json` | Claim panel data (occupancy, timers, passwords) + panel message IDs |
| **`database_ranking_<server>.json`** | `database_ranking_*.json` | Player registrations, pilot links, clan assignments |
| **`ranking_cache_<server>.json`** | `ranking_cache_*.json` | Cached MIR4 ranking data per server |
| **`ranking_logs_<server>.txt`** | `ranking_logs_*.txt` | Synchronization logs per server |
| **`daily-logs_<server>.json`** | `daily-logs_*.json` | Daily claim activity logs per server |
| **`salary-poll-db_<server>.json`** | `salary-poll-db_*.json` | Salary poll votes and results per server |

On boot, the bot loads per-server files and merges them into memory. When no servers are configured, legacy single-file fallbacks (`database.json`, `database_ranking.json`) are used.

Legacy files are automatically migrated on first startup with servers configured — the old `database.json` is renamed to `claim-database.backup` after migration.

All database files are gitignored via wildcard patterns.

## Configuration

### server-config.json

```json
{
  "discordServerId": "1522269191833387018",
  "servers": {
    "aoen": {
      "id": "aoen",
      "name": "AOEN",
      "enabled": true,
      "rankingUrl": "https://...",
      "clanRoles": { "浪人・AEON・": "123456789" },
      "staffRoleId": "987654321",
      "categories": {
        "7F": "category_id",
        "8F": "category_id"
      },
      "channels": {
        "logs": "channel_id",
        "bossSpawn": "channel_id",
        "event": "channel_id",
        "salaryPoll": "channel_id",
        "ticketCategory": "category_id",
        "tempVoiceSource": "channel_id"
      }
    }
  }
}
```

## Troubleshooting

- **Bot doesn't respond to commands** → Check intents, permissions, and `discordServerId` config
- **Panels not updating** → Run `!reset` or restart the bot
- **Slash commands not appearing** → Use `!deploy`
- **Salary poll not opening** → Check timezone config and server channel IDs
