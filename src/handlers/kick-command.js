// ==========================================
// 👢 KICK TEXT COMMAND (!kick)
// Opens a select menu listing every active claim so an admin can
// remove the current owner. The menu itself is handled by
// handleAdminKickMenu in src/interactions/admin-interactions.js.
// ==========================================

import {
    PermissionFlagsBits,
    ActionRowBuilder,
    StringSelectMenuBuilder
} from 'discord.js';
import { getMsg } from '../core/lang.js';
import { db } from '../core/state.js';
import { getAntidemonRoomKeys, getSummonRoomKeys, getEventGroupKeys } from './claim-core-rooms.js';

// Strip emojis from titles for select menu labels
function stripEmojis(str) {
    return String(str || '').replace(/[\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD00-\uDFFF]/g, '').trim();
}

// Build one select-menu option per currently claimed room/slot.
function buildKickOptions() {
    const options = [];
    for (const key in db) {
        const current = db[key];
        if (!current || key.startsWith('_')) continue;
        const cleanedTitle = stripEmojis(current.title);

        if (current.type === 'event_group') {
            for (const ev of getEventGroupKeys(current)) {
                const evData = current[ev];
                if (evData && evData.ownerId) {
                    options.push({
                        label: `${cleanedTitle} - ${evData.name}`.slice(0, 100),
                        description: `${getMsg('system.kickCurrentLabel')} ${evData.ownerName}`,
                        value: `kick-${key}-${ev}-${evData.ownerId}`
                    });
                }
            }
        } else if (current.type === 'antidemon') {
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

/** Registers the !kick text command listener. @param {import('discord.js').Client} client */
export function initKickCommand(client) {
    client.on('messageCreate', async (message) => {
        if (message.author.bot || !message.content.startsWith('!')) return;

        const args = message.content.slice(1).trim().split(/ +/);
        const command = args.shift().toLowerCase();
        if (command !== 'kick') return;

        if (!message.member?.permissions.has(PermissionFlagsBits.ManageMessages)) {
            return message.reply(getMsg('system.permissionDeniedManageMessages')).catch(() => {});
        }

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
    });
}
