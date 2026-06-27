// ==========================================
// 🧭 CLAIM HANDLERS — ROUTER
// Routes text commands and interactions to
// specialized sub-modules. Guild-aware.
// ==========================================

import { handleAdminCommand } from "./commands/admin-commands.js";
import { handlePanelCommand } from "./commands/panel-commands.js";
import { canHandleAdminInteraction, handleAdminInteraction } from "./interactions/admin-interactions.js";
import { canHandleAntidemonInteraction, handleAntidemonInteraction } from "./interactions/antidemon-interactions.js";
import { canHandleSummonInteraction, handleSummonInteraction } from "./interactions/summon-interactions.js";
import { canHandleFloorInteraction, handleFloorInteraction } from "./interactions/floor-interactions.js";

// ==========================================
// 💬 TEXT COMMAND ROUTER
// ==========================================

export async function handleClaimMessages(msg) {
  if (msg.author.bot) return;

  // Try admin commands first
  if (await handleAdminCommand(msg)) return;

  // Try panel commands
  if (await handlePanelCommand(msg)) return;
}

// ==========================================
// 🖱️ INTERACTION ROUTER
// ==========================================

export async function handleClaimInteractions(interaction) {
  const uid = interaction.user.id;
  const uName = interaction.member
    ? interaction.member.displayName
    : interaction.user.username;
  const guildId = interaction.guildId;

  // 1. Admin interactions (reset menu, kick menu, reset logs)
  if (canHandleAdminInteraction(interaction)) {
    return await handleAdminInteraction(interaction, guildId, uid);
  }

  // 2. Antidemon interactions (slide, ticket, queue)
  if (canHandleAntidemonInteraction(interaction)) {
    return await handleAntidemonInteraction(interaction, guildId, uid, uName);
  }

  // 3. Summon interactions (slide, ticket, queue)
  if (canHandleSummonInteraction(interaction)) {
    return await handleSummonInteraction(interaction, guildId, uid, uName);
  }

  // 4. Floor interactions (buttons: death, claim, cancel, summon/antidemon actions)
  if (canHandleFloorInteraction(interaction)) {
    return await handleFloorInteraction(interaction, guildId, uid, uName);
  }
}
