// ==========================================
// 🚀 FORCE DEPLOY ALL SLASH COMMANDS
// Run: node deploy-commands.cjs
// ==========================================
const { REST, Routes, PermissionFlagsBits } = require('discord.js');
const fs = require('fs');
const path = require('path');

// Load .env if it exists
try {
  require('dotenv/config');
} catch (e) {
  // dotenv not available, try reading .env manually
  try {
    const envPath = path.join(__dirname, '..', '.env');
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf8');
      envContent.split('\n').forEach(line => {
        const [key, ...vals] = line.split('=');
        if (key && vals.length) {
          process.env[key.trim()] = vals.join('=').trim();
        }
      });
    }
  } catch (e2) {}
}

const TOKEN = process.env.TOKEN || process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.DISCORD_SERVER_ID || '1481566364631044119';
const CLIENT_ID = process.env.CLIENT_ID;

if (!TOKEN) {
  console.error('❌ No token found. Create a .env file with:');
  console.error('   TOKEN=your_bot_token');
  console.error('   CLIENT_ID=your_client_id');
  console.error('   DISCORD_SERVER_ID=your_guild_id');
  process.exit(1);
}

if (!CLIENT_ID) {
  console.error('❌ No CLIENT_ID found. Set it in .env or pass it inline.');
  process.exit(1);
}

console.log('🚀 Force deploying commands...');
console.log(`   Guild ID: ${GUILD_ID}`);

// ── All commands ──
const commands = [
  {
    name: 'removepilot',
    description: 'Remove a specific pilot assigned to your account.'
  },
  { 
    name: 'forcesync', 
    description: '⚡ [Admin] Force an immediate synchronization with the official ranking portal.',
    default_member_permissions: PermissionFlagsBits.Administrator.toString()
  },
  {
    name: 'manualregister',
    description: '👑 [Admin] Register a player via cache lookup.',
    default_member_permissions: PermissionFlagsBits.Administrator.toString(),
    options: [
      { type: 6, name: 'member', description: 'Discord member.', required: true },
      { type: 3, name: 'nickname', description: 'In-game character name.', required: true }
    ]
  },
  {
    name: 'manualforce',
    description: '👑 [Admin] Force register a member as permanent — no fuzzy/ranking checks.',
    default_member_permissions: PermissionFlagsBits.Administrator.toString(),
    options: [
      { type: 6, name: 'member', description: 'Discord member to register.', required: true },
      { type: 3, name: 'nickname', description: 'In-game character name (exact as typed).', required: true }
    ]
  },
  {
    name: 'manualpilot',
    description: '👑 [Admin] Manually link a pilot to a character owner.',
    default_member_permissions: PermissionFlagsBits.Administrator.toString(),
    options: [
      { type: 6, name: 'owner', description: 'Select the primary character owner.', required: true },
      { type: 6, name: 'pilot', description: 'Select the Discord user acting as pilot.', required: true }
    ]
  },
  {
    name: 'cleandb',
    description: '👑 [Admin] Remove all duplicate nickname entries from the database.',
    default_member_permissions: PermissionFlagsBits.Administrator.toString()
  },
  {
    name: 'manage',
    description: '🛠️ Bot Management Panel'
  },
  {
    name: 'manualremove',
    description: '👑 [Admin] Completely remove a player\'s registration and profile.',
    default_member_permissions: PermissionFlagsBits.Administrator.toString(),
    options: [{ type: 6, name: 'member', description: 'Discord member to clear.', required: true }]
  },
  {
    name: 'manualremovepilot',
    description: '👑 [Admin] Manually remove a pilot from a character owner.',
    default_member_permissions: PermissionFlagsBits.Administrator.toString(),
    options: [
      { type: 6, name: 'owner', description: 'Select the character owner.', required: true },
      { type: 6, name: 'pilot', description: 'Select the pilot to remove.', required: true }
    ]
  },
  {
    name: 'sendpanel',
    description: '📋 [Admin] Send a fixed registration panel to this channel.',
    default_member_permissions: PermissionFlagsBits.Administrator.toString()
  },
  {
    name: 'listunregistered',
    description: '📋 [Admin] List members with role but no registration, optionally DM them.',
    default_member_permissions: PermissionFlagsBits.Administrator.toString(),
    options: [
      { type: 5, name: 'notify', description: 'Send a DM to each unregistered member asking them to register (5s delay each)' }
    ]
  },
  {
    name: 'pending',
    description: '⏳ [Admin] List all pending registration requests with time remaining.',
    default_member_permissions: PermissionFlagsBits.Administrator.toString()
  },
  {
    name: 'scanimport',
    description: '📥 Scan another server and pre-register members by nickname',
    default_member_permissions: PermissionFlagsBits.Administrator.toString(),
    options: [
      { type: 5, name: 'reset', description: '🧹 Clear all existing registrations from scan servers before re-importing' }
    ]
  },
  {
    name: 'scanimport_status',
    description: '📊 Show pre-registration status and auto-convert eligible members',
    default_member_permissions: PermissionFlagsBits.Administrator.toString()
  },
  {
    name: 'fixnick',
    description: '🔍 [Admin] Auto-correct a member\'s nickname via fuzzy ranking match.',
    default_member_permissions: PermissionFlagsBits.Administrator.toString(),
    options: [
      { type: 6, name: 'member', description: 'The member whose nickname needs fixing.', required: true },
      { type: 3, name: 'nickname', description: 'Optional: the correct nickname. If omitted, auto-detect from ranking.', required: false }
    ]
  },
  {
    name: 'elderguide',
    description: '📋 Guide: how to approve/reject owner registrations'
  },
];

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
  try {
    console.log(`📤 Registering ${commands.length} commands...`);
    
    const result = await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands }
    );
    
    console.log(`✅ ${result.length} commands deployed successfully!`);
    console.log('');
    console.log('📋 Commands deployed:');
    commands.forEach(c => console.log(`   /${c.name} — ${c.description}`));
    console.log('');
    console.log('🔄 Discord may take a few seconds to update the command list.');
  } catch (error) {
    console.error('❌ Deploy failed:', error.message);
    if (error.code === 50001) {
      console.error('   Missing access — check if the bot is in the guild with applications.commands scope.');
    }
    if (error.code === 40001) {
      console.error('   Invalid token — check your TOKEN in .env');
    }
  }
})();
