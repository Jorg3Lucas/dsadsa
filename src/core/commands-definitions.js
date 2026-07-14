// ==========================================
// 📜 SHARED SLASH COMMAND DEFINITIONS
// Single source of truth for all bot commands.
// Imported by:
//   - ranking-commands.js (startup registration)
//   - deploy-commands.cjs  (manual deployment)
// ==========================================

import { PermissionFlagsBits } from 'discord.js';

/**
 * Array of all slash command definitions used by the bot.
 * Each entry is a raw command object compatible with guild.commands.set().
 *
 * IMPORTANT: Descriptions are hardcoded in English for portability
 * (used by both ESM startup and CJS deploy script).
 * The i18n via getMsg() is applied only at runtime registration
 * in ranking-commands.js.
 */
export const SLASH_COMMANDS = [
  // ── Ranking commands ──
  {
    name: 'register',
    description: 'Register your MIR4 character nickname'
  },
  {
    name: 'pilot',
    description: 'Link another Discord member as your pilot',
    options: [{
      type: 6,
      name: 'member',
      description: 'Select the Discord member to link as pilot',
      required: true
    }]
  },
  {
    name: 'removepilot',
    description: 'Remove one of your linked pilots'
  },
  {
    name: 'forcesync',
    description: 'Force a full synchronization of all rankings, nicknames, and roles',
    default_member_permissions: PermissionFlagsBits.Administrator.toString()
  },
  {
    name: 'manualregister',
    description: 'Manually register a member with a specific nickname and clan',
    default_member_permissions: PermissionFlagsBits.Administrator.toString(),
    options: [
      {
        type: 6,
        name: 'member',
        description: 'Select the Discord member to register',
        required: true
      },
      {
        type: 3,
        name: 'nickname',
        description: 'In-game character nickname',
        required: true
      }
    ]
  },
  {
    name: 'manualpilot',
    description: 'Manually link a pilot to an owner',
    default_member_permissions: PermissionFlagsBits.Administrator.toString(),
    options: [
      {
        type: 6,
        name: 'owner',
        description: 'Select the owner member',
        required: true
      },
      {
        type: 6,
        name: 'pilot',
        description: 'Select the pilot member to link',
        required: true
      }
    ]
  },
  {
    name: 'cleandb',
    description: 'Clean duplicate entries from the ranking database',
    default_member_permissions: PermissionFlagsBits.Administrator.toString()
  },
  {
    name: 'manage',
    description: '🛠️ Bot Management Panel — Configure all bot systems'
  },
  {
    name: 'manualremove',
    description: 'Manually unregister a member from the ranking',
    default_member_permissions: PermissionFlagsBits.Administrator.toString(),
    options: [{
      type: 6,
      name: 'member',
      description: 'Select the Discord member to unregister',
      required: true
    }]
  },
  {
    name: 'manualremovepilot',
    description: 'Manually unlink a pilot from an owner',
    default_member_permissions: PermissionFlagsBits.Administrator.toString(),
    options: [
      {
        type: 6,
        name: 'owner',
        description: 'Select the owner member',
        required: true
      },
      {
        type: 6,
        name: 'pilot',
        description: 'Select the pilot member to unlink',
        required: true
      }
    ]
  }
];
