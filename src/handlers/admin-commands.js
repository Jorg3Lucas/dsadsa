// ==========================================
// 👑 ADMIN TEXT COMMANDS
// !reset [key|all] — open reset menu / reset a panel directly
// !kick           — open kick menu (remove a user from a claim)
// ==========================================

import {
    PermissionFlagsBits,
    ActionRowBuilder,
    StringSelectMenuBuilder
} from 'discord.js';
import { getMsg } from '../core/lang.js';
import { db } from '../core/state.js';
import { refreshVisualPanel, resetPanelData } from './panel-utils.js';
import { getAntidemonRoomKeys, getSummonRoomKeys } from './claim-core.js';

// Strip emojis from titles for select menu labels
function stripEmojis(str) {
    return String(str || '').replace(/[\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD00-\uDFFF]/g, '').trim();
}

function hasManageMessages(msg) {
    return msg.member && msg.member.permissions.has(PermissionFlagsBits.ManageMessages);
}

// ==========================================
// 👢 !KICK — build and post the kick menu
// ==========================================

function buildKickOptions() {
    const options = [];
    for (const key in db) {
        const current = db[key];
        if (!current || key.startsWith('_')) continue;
        const cleanedTitle = stripEmojis(current.title);

        if (current.type === 'antidemon') {
            for (const room of getAntidemonRoomKeys(key)) {
                const rData = current[room];
                if (rData && rData.ownerId) {
                    options.push({
                        label: `${cleanedTitle} - ${rData.name || room.toUpperCase()}`.slice(0, 100),
                        description: `${getMsg('system.kickCurrentLabel')} ${rData.ownerName}`,
                        value: `kick-${key}-${room}-${rData.ownerId}`
                    });
                }
            }
        } else if (current.type === 'summon') {
            for (const loc of getSummonRoomKeys(key)) {
                const lData = current[loc];
                if (lData && lData.ownerId) {
                    options.push({
                        label: `${cleanedTitle} - ${lData.name}`.slice(0, 100),
                        description: `${getMsg('system.kickCurrentLabel')} ${lData.ownerName}`,
                        value: `kick-${key}-${loc}-${lData.ownerId}`
                    });
                }
            }
        } else {
            if (current.ownerId) {
                options.push({
                    label: cleanedTitle.slice(0, 100),
                    description: `${getMsg('system.kickCurrentLabel')} ${current.ownerName}`,
                    value: `kick-${key}-floor-${current.ownerId}`
                });
            }
        }
    }
    return options;
}

// ==========================================
// 🔄 !RESET — build and post the reset menu
// ==========================================

function buildResetOptions() {
    const options = [];
    for (const key in db) {
        const current = db[key];
        if (!current || key.startsWith('_')) continue;
        options.push({
            label: stripEmojis(current.title).slice(0, 100),
            description: `Key: ${key}`,
            value: key
        });
    }
    if (options.length > 1) {
        options.unshift({ label: '🔄 Reset ALL Panels', description: 'Reset all panels to defaults', value: '__all__' });
    }
    return options;
}

async function handleResetDirect(msg, resetKey) {
    if ('all' === resetKey) {
        let count = 0;
        for (const key in db) {
            if (!db[key] || key.startsWith('_')) continue;
            resetPanelData(key);
            await refreshVisualPanel(key);
            count++;
        }
        return msg.reply(`✅ Reset ${count} panels to defaults.`).catch(() => {});
    }

    if (!db[resetKey]) {
        return msg.reply(getMsg('system.resetPanelNotFound', { key: resetKey })).catch(() => {});
    }
    resetPanelData(resetKey);
    await refreshVisualPanel(resetKey);
    return msg.reply(getMsg('system.resetPanelSuccess', { key: resetKey })).catch(() => {});
}

// ==========================================
// 🎯 MAIN DISPATCH
// ==========================================

/** Registers the !reset / !kick text command listener. @param {import('discord.js').Client} client */
export function initAdminCommands(client) {
    client.on('messageCreate', async (message) => {
        if (message.author.bot || !message.content.startsWith('!')) return;

        const args = message.content.slice(1).trim().split(/ +/);
        const command = args.shift().toLowerCase();

        if (!['reset', 'kick'].includes(command)) return;

        if (!hasManageMessages(message)) {
            return message.reply(getMsg('system.permissionDeniedManageMessages')).catch(() => {});
        }

        // ── !reset [key|all] ──
        if (command === 'reset') {
            const target = args[0];
            if (target) {
                return handleResetDirect(message, target.toLowerCase());
            }
            const options = buildResetOptions();
            if (options.length === 0) {
                return message.reply(getMsg('system.resetNoPanels')).catch(() => {});
            }
            await message.reply({
                content: getMsg('system.resetMenuTitle'),
                components: [new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('admin-reset-menu')
                        .setPlaceholder(getMsg('system.resetMenuPlaceholder'))
                        .addOptions(options.slice(0, 25))
                )]
            }).catch(() => {});
            try { await message.delete(); } catch (e) {}
            return;
        }

        // ── !kick ──
        if (command === 'kick') {
            const options = buildKickOptions();
            if (options.length === 0) {
                return message.reply(getMsg('system.kickNoClaims')).catch(() => {});
            }
            await message.reply({
                content: getMsg('system.kickPanelTitle'),
                components: [new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('admin-kick-menu')
                        .setPlaceholder(getMsg('system.kickPanelPlaceholder'))
                        .addOptions(options.slice(0, 25))
                )]
            }).catch(() => {});
            try { await message.delete(); } catch (e) {}
            return;
        }
    });
}
