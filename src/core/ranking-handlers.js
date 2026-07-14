import { PermissionFlagsBits } from 'discord.js';
import { getMsg } from './lang.js';
import { CLAN_ROLES } from './ranking-constants.js';

import { noop } from "./config.js";
import { handleConfirmButtons } from './ranking-confirm.js';
import { handleManageNavigation, handleManageUserPage, handleManageAction, handleManagePilot } from './ranking-manage.js';
import { handleRegisterModal } from './ranking-handlers-modal.js';
import {
    handleRegisterCommand,
    handlePilotCommand,
    handleRemovePilotCommand,
    handleForceSyncCommand,
    handleManageCommand,
    handleManualRegisterCommand,
    handleManualPilotCommand,
    handleManualRemovePilotCommand,
    handleManualRemoveCommand,
    handleCleanDbCommand
} from './ranking-handlers-commands.js';


// ==========================================
// 🖱️ RANKING — Main Router
// Slash commands + Modals + Select menus
// Delegates buttons to ranking-confirm.js,
// manage menus to ranking-manage.js
// ==========================================

/** Main router for all MIR4 ranking interactions: slash commands, modals, select menus, confirm buttons. @param {import('discord.js').Interaction} interaction @param {object} db @param {Function} saveLocalStorage @param {Function} logEvent */
export async function handleMir4Interactions(interaction, db, saveLocalStorage, logEvent) {
    if (!db.users) db.users = {};

    // ── Confirm buttons → ranking-confirm.js ──
    if (interaction.isButton() && interaction.customId.startsWith('confirm-')) {
        return handleConfirmButtons(interaction, db, saveLocalStorage, logEvent);
    }

    // ── Manage menu navigation buttons → ranking-manage.js ──
    if (interaction.isButton() && (interaction.customId.startsWith('manage_user_prev_') || interaction.customId.startsWith('manage_user_next_') || interaction.customId === 'manage_back')) {
        return handleManageNavigation(interaction, db);
    }

    // ── Manage user page select → ranking-manage.js ──
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('manage_user_page_')) {
        return handleManageUserPage(interaction, db);
    }

    // ── Manage action select → ranking-manage.js ──
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('manage_action_')) {
        return handleManageAction(interaction, db, saveLocalStorage, logEvent);
    }

    // ── Manage pilot removal → ranking-manage.js ──
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('manage_pilot_')) {
        return handleManagePilot(interaction, db, saveLocalStorage, logEvent);
    }

    // ── REGISTER MODAL → ranking-handlers-modal.js ──
    if (interaction.isModalSubmit() && interaction.customId === 'register_modal') {
        await interaction.deferReply({ flags: 64 });
        return handleRegisterModal(interaction, db, saveLocalStorage, logEvent);
    }

    // ── MANUAL CLAN SELECTION DROPDOWN (ADMIN) ──
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('select_clan_manual_')) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: getMsg('ranking.responses.selectClanMenu.noPermission'), flags: 64 });
        }

        await interaction.deferReply({ flags: 64 });
        const targetId = interaction.customId.replace('select_clan_manual_', '');
        const selectedClan = interaction.values[0];

        if (db.users[targetId]) {
            db.users[targetId].clanManual = selectedClan;
            saveLocalStorage();

            const guild = interaction.guild;
            const member = await guild.members.fetch(targetId).catch(() => null);

            if (member) {
                const normalizedNick = db.users[targetId].nickname.trim().normalize('NFC');
                await member.setNickname(normalizedNick).catch(noop);
                const idealRoleId = CLAN_ROLES[selectedClan];
                for (const rId of Object.values(CLAN_ROLES)) {
                    if (rId === idealRoleId) {await member.roles.add(rId).catch(noop);}
                    else {await member.roles.remove(rId).catch(noop);}
                }
            }
            logEvent(getMsg('ranking.logs.manualLink', { targetId, selectedClan }));
            return interaction.editReply(getMsg('ranking.responses.selectClanMenu.success', { clan: selectedClan }));
        }
        return interaction.editReply(getMsg('ranking.responses.selectClanMenu.error'));
    }

    // ── PILOT REMOVAL HANDLER (user removing their own pilot) ──
    if (interaction.isStringSelectMenu() && interaction.customId === 'select_pilot_to_remove') {
        await interaction.deferUpdate();
        
        const pilotToRemoveId = interaction.values[0];
        const userProfile = db.users[interaction.user.id];

        if (!userProfile || !userProfile.pilotIds || !userProfile.pilotIds.includes(pilotToRemoveId)) {
            return interaction.followUp({ content: getMsg('ranking.responses.removepilot.error'), flags: 64 });
        }

        userProfile.pilotIds = userProfile.pilotIds.filter(id => id !== pilotToRemoveId);
        saveLocalStorage();

        await interaction.webhook.editMessage(interaction.message.id, {
            content: getMsg('ranking.responses.removepilot.success'),
            components: []
        }).catch(noop);

        interaction.guild.members.fetch(pilotToRemoveId)
            .then(async (pilotMember) => {
                if (pilotMember) {
                    for (const roleId of Object.values(CLAN_ROLES)) {
                        if (pilotMember.roles.cache.has(roleId)) {await pilotMember.roles.remove(roleId).catch(noop);}
                    }
                    await pilotMember.setNickname(pilotMember.user.username).catch(noop);
                }
            }).catch(noop);
        return;
    }

    // ── Not a button/select/modal? Must be a slash command ──
    if (!interaction.isCommand()) return;
    const { commandName } = interaction;

    // ── Route slash commands → ranking-handlers-commands.js ──
    if (commandName === 'register') return handleRegisterCommand(interaction);
    if (commandName === 'pilot') return handlePilotCommand(interaction, db, saveLocalStorage);
    if (commandName === 'removepilot') return handleRemovePilotCommand(interaction, db);
    if (commandName === 'forcesync') return handleForceSyncCommand(interaction, db, saveLocalStorage, logEvent);
    if (commandName === 'manage') return handleManageCommand(interaction, db);
    if (commandName === 'manualregister') return handleManualRegisterCommand(interaction, db, saveLocalStorage, logEvent);
    if (commandName === 'manualpilot') return handleManualPilotCommand(interaction, db);
    if (commandName === 'manualremovepilot') return handleManualRemovePilotCommand(interaction, db);
    if (commandName === 'manualremove') return handleManualRemoveCommand(interaction, db);
    if (commandName === 'cleandb') return handleCleanDbCommand(interaction, db, saveLocalStorage, logEvent);
}
