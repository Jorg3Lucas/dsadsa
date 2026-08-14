// ==========================================
// 🗺️ PANEL TEXT COMMANDS
// !ms7..!ms12, !sp7..!sp12, !summons / !summon
//
// Posts the panels of a floor/channel into the channel where the command
// was sent. Old panels previously posted in that channel are replaced.
// Used on servers where the channels are created manually (no auto-setup).
// ==========================================

import { PermissionFlagsBits } from 'discord.js';
import { getMsg } from '../core/lang.js';
import { db, lastMessages, saveLocalStorage } from '../core/state.js';
import { renderEmbed, renderButtons } from './panel-render.js';
import { CLAIM_CATEGORIES } from '../core/server-structure.js';

// Build lookup: channel key (ms7, sp10, summons...) -> panel keys to post
const CHANNEL_PANELS = {};
for (const cat of CLAIM_CATEGORIES) {
    for (const chanDef of cat.channels) {
        CHANNEL_PANELS[chanDef.key] = chanDef.panels;
    }
}

/** Resolve the channel key from a command name (e.g. "ms10" -> "ms10", "summons" -> "summons"). @param {string} command @returns {string|null} */
function resolveChannelKey(command) {
    if (command === 'summons' || command === 'summon') return 'summons';
    const m = command.match(/^(ms|sp)(7|8|9|10|11|12)$/);
    if (m) return `${m[1]}${m[2]}`;
    return null;
}

/** Registers the !ms / !sp / !summons text command listener. @param {import('discord.js').Client} client */
export function initPanelCommands(client) {
    client.on('messageCreate', async (message) => {
        if (message.author.bot || !message.content.startsWith('!')) return;

        const args = message.content.slice(1).trim().split(/ +/);
        const command = args.shift().toLowerCase();

        const channelKey = resolveChannelKey(command);
        if (!channelKey) return;

        if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
            return message.reply(getMsg('system.permissionDeniedManageMessages')).catch(() => {});
        }

        const panelKeys = CHANNEL_PANELS[channelKey];
        if (!panelKeys || panelKeys.length === 0) {
            return message.reply(`❌ No panels defined for \`!${command}\`.`).catch(() => {});
        }

        if (!db._panelMapping) db._panelMapping = {};

        // ── Replace old panels previously posted in this channel ──
        for (const panelKey of panelKeys) {
            const mapping = db._panelMapping[panelKey];
            if (mapping && mapping.channelId === message.channel.id && mapping.messageId) {
                try {
                    const oldMsg = await message.channel.messages.fetch(mapping.messageId).catch(() => null);
                    if (oldMsg) await oldMsg.delete().catch(() => {});
                } catch (e) {
                    // Ignore — panel may already be gone
                }
                delete lastMessages[panelKey];
            }
        }

        // ── Post fresh panels and register them for the tick refresh ──
        let posted = 0;
        for (const panelKey of panelKeys) {
            if (!db[panelKey]) {
                message.reply(`⚠️ Panel **${panelKey}** not found in the database.`).catch(() => {});
                continue;
            }
            const sent = await message.channel.send({
                embeds: [renderEmbed(panelKey)],
                components: renderButtons(panelKey)
            }).catch(() => null);
            if (!sent) continue;
            lastMessages[panelKey] = sent;
            db._panelMapping[panelKey] = {
                channelId: message.channel.id,
                messageId: sent.id
            };
            posted++;
        }

        saveLocalStorage();

        // Delete the command message to keep the channel clean
        try { await message.delete(); } catch (e) {}

        if (posted === 0) {
            message.channel.send(`❌ Failed to post panels for \`!${command}\`.`).catch(() => {});
        }
    });
}
