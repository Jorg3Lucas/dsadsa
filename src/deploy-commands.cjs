// ==========================================
// 🚀 FORCE DEPLOY ALL SLASH COMMANDS
// Run: node src/deploy-commands.cjs
// ==========================================
const { REST, Routes } = require('discord.js');
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
// SINGLE source of truth, shared with src/core/ranking-deploy.js (the list the
// bot registers on startup). Never hardcode commands here again: both deploy
// paths replace the whole guild command list, so a divergence silently deletes
// commands in production.
const commands = JSON.parse(fs.readFileSync(path.join(__dirname, 'commands.json'), 'utf8'));

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
