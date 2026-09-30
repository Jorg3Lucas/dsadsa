// ==========================================
// 🚀 FORCE DEPLOY ALL SLASH COMMANDS
// Run: node src/deploy-commands.cjs
// ==========================================
const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

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
  } catch { /* .env is optional — ignore */ }
}

const TOKEN = process.env.TOKEN || process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.DISCORD_SERVER_ID;
const CLIENT_ID = process.env.CLIENT_ID;
const RANKING_ENABLED = String(process.env.RANKING_ENABLED ?? 'false').toLowerCase() === 'true';

// Todos os comandos deste script pertencem ao sistema de ranking/registro.
if (!RANKING_ENABLED) {
  console.log('🚫 Ranking desabilitado (RANKING_ENABLED=false) — nenhum comando de ranking será publicado.');
  process.exit(0);
}

if (!TOKEN) {
  console.error('❌ No token found. Create a .env file with:');
  console.error('   TOKEN=your_bot_token');
  console.error('   CLIENT_ID=your_client_id');
  console.error('   DISCORD_SERVER_ID=your_guild_id');
  process.exit(1);
}

if (!GUILD_ID) {
  console.error('❌ No DISCORD_SERVER_ID found. Set it in .env or pass it inline.');
  process.exit(1);
}

if (!CLIENT_ID) {
  console.error('❌ No CLIENT_ID found. Set it in .env or pass it inline.');
  process.exit(1);
}

console.log('🚀 Force deploying commands...');
console.log(`   Guild ID: ${GUILD_ID}`);

// ── Command list ──
// Reuse the runtime registration list (src/core/ranking-deploy.js) instead of
// keeping a second copy here: a duplicated list silently drifts and this script
// would then DELETE commands the bot relies on (e.g. /stats).
const DEPLOY_MODULE = pathToFileURL(path.join(__dirname, 'core', 'ranking-deploy.js')).href;

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
  let commands;
  try {
    ({ MIR4_COMMANDS: commands } = await import(DEPLOY_MODULE));
  } catch (error) {
    console.error('❌ Failed to load the command list from src/core/ranking-deploy.js:', error.message);
    process.exit(1);
  }

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
