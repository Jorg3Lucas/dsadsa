// ==========================================
// 📤 SLASH COMMANDS DEPLOYMENT SCRIPT
// Run with: node src/deploy-commands.cjs
// Registers commands for a specific guild (instant).
// Uses dynamic import() to load shared definitions
// from commands-definitions.js (no duplication).
// ==========================================

const { REST, Routes } = require('discord.js');
require('dotenv').config();

const DISCORD_SERVER_ID = '1432320162278670440';

// ── Deploy ──

(async () => {
  try {
    // Dynamic imports from shared ESM modules
    const { getBotToken } = await import('./core/config.js');
    const { SLASH_COMMANDS } = await import('./core/commands-definitions.js');

    const token = getBotToken();
    const rest = new REST({ version: '10' }).setToken(token);

    console.log(`🔄 Registering ${SLASH_COMMANDS.length} slash command(s)...`);

    if (DISCORD_SERVER_ID) {
      await rest.put(
        Routes.applicationGuildCommands(process.env.CLIENT_ID, DISCORD_SERVER_ID),
        { body: SLASH_COMMANDS }
      );
      console.log(`✅ Commands registered for guild ${DISCORD_SERVER_ID}`);
    } else {
      await rest.put(
        Routes.applicationCommands(process.env.CLIENT_ID),
        { body: SLASH_COMMANDS }
      );
      console.log('✅ Commands registered globally');
    }
  } catch (error) {
    console.error('❌ Failed to register commands:', error.message);
    process.exit(1);
  }
})();
