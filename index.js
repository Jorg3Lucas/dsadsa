// ==========================================
// 🚀 INDEX — MULTI-SERVER ENTRY POINT
// Supports multiple Discord servers (guilds),
// each with its own isolated data and config.
// Only the Claim system is loaded here.
// ==========================================

import { Client, GatewayIntentBits } from "discord.js";
import "dotenv/config";

import { initGuildState, getGuildState } from "./state.js";
import {
  initClaimSystem,
  handleClaimMessages,
  handleClaimInteractions,
} from "./bot.js";
import { startAutoBackup } from "./auto-backup.js";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

// ==========================================
// 🚀 READY EVENT
// ==========================================
client.once("ready", async () => {
  console.log(`\n🤖 Bot connected successfully as: ${client.user.tag}\n`);
  console.log(
    `🌍 Bot is in ${client.guilds.cache.size} guild(s):`,
    client.guilds.cache.map((g) => `${g.name} (${g.id})`).join(", "),
  );

  // ── Initialize each guild independently ──
  for (const [, guild] of client.guilds.cache) {
    const guildId = guild.id;
    console.log(`\n🔧 Initializing guild: ${guild.name} (${guildId})`);

    const guildState = initGuildState(guildId, {
      client,
      timezone: "Europe/Berlin", // Configurable per guild in the future
    });

    // Initialize the claim system for this guild
    initClaimSystem(guildId);
  }

  // ── Start global services ──
  startAutoBackup(6);

  console.log("\n✅ All guilds initialized. Bot is fully operational.\n");
});

// ==========================================
// ✉️ MESSAGE CREATE EVENT
// ==========================================
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!message.guildId) return;

  try {
    const guildState = getGuildState(message.guildId);
    if (!guildState) return;
    await handleClaimMessages(message);
  } catch (error) {
    console.error(`❌ [${message.guildId}] MessageCreate Error:`, error);
  }
});

// ==========================================
// 🖱️ INTERACTION CREATE EVENT
// ==========================================
client.on("interactionCreate", async (interaction) => {
  if (!interaction.guildId) return;

  try {
    const guildState = getGuildState(interaction.guildId);
    if (!guildState) return;

    await handleClaimInteractions(interaction);
  } catch (error) {
    console.error(`❌ [${interaction.guildId}] Interaction Error:`, error);
    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction
          .reply({
            content: "❌ An unexpected error occurred. Please try again.",
            flags: 64,
          })
          .catch(() => {});
      }
    } catch (_) {}
  }
});

client.login(process.env.TOKEN || process.env.DISCORD_TOKEN);
