import { PermissionFlagsBits } from 'discord.js';
import { getMsg } from './lang.js';
import { CLAN_ROLES } from './ranking-constants.js';

import { noop } from "./config.js";
import { handleConfirmButtons } from './ranking-confirm.js';
import { handleManageNavigation, handleManageUserPage, handleManageAction, handleManagePilot } from './ranking-manage.js';
import {
    handleForceSyncCommand,
    handleManageCommand,
    handleManualRegisterCommand,
    handleManualPilotCommand,
    handleManualRemovePilotCommand,
    handleManualRemoveCommand,
    handleCleanDbCommand
} from './ranking-handlers-commands.js';
import {
    handleRegPanelButtons,
    handleRegModalSubmit,
    handleRegRemovePilotSelect,
    handleReRegisterConfirm,
    handleRegSyncConfirm,
    handleRegPilotModal,
    handleRegPilotApprove,
    handleRegPilotReject,
    handleRegElderApproveOwner,
    handleRegElderRejectOwner,
    handleRegElderApprovePilot,
    handleRegElderRejectPilot,
    handleRegPilotRevoke
} from '../handlers/registration-panel.js';


// ==========================================
// 🖱️ RANKING — Main Router
// Slash commands + Modals + Select menus
// Delegates buttons to ranking-confirm.js,
// manage menus to ranking-manage.js
// ==========================================

/** Main router for all MIR4 ranking interactions: slash commands, modals, select menus, confirm buttons. @param {import('discord.js').Interaction} interaction @param {object} db @param {Function} saveLocalStorage @param {Function} logEvent */
export async function handleMir4Interactions(interaction, db, saveLocalStorage, logEvent) {
    if (!db.users) db.users = {};

    // ── Registration Panel Buttons (reg_ prefix) ──
    if (interaction.isButton() && interaction.customId.startsWith('reg_')) {
        // ── Pilot approve/reject from DM (must be first before other reg_ checks) ──
        if (interaction.customId.startsWith('reg_pilot_approve_')) {
            return handleRegPilotApprove(interaction, db, saveLocalStorage, logEvent);
        }
        if (interaction.customId.startsWith('reg_pilot_reject_')) {
            return handleRegPilotReject(interaction, db, saveLocalStorage, logEvent);
        }

        // ── Pilot revoke from DM ──
        if (interaction.customId.startsWith('reg_pilot_revoke_')) {
            return handleRegPilotRevoke(interaction, db, saveLocalStorage, logEvent);
        }

        // Reregister / sync confirmations
        if (interaction.customId === 'reg_confirm_reregister') {
            return handleReRegisterConfirm(interaction, db, saveLocalStorage, logEvent);
        }
        if (interaction.customId === 'reg_cancel_reregister') {
            return interaction.update({ content: '❌ Re-registration cancelled.', components: [] }).catch(noop);
        }
        if (interaction.customId === 'reg_confirm_sync') {
            return handleRegSyncConfirm(interaction, db, saveLocalStorage, logEvent);
        }
        if (interaction.customId === 'reg_cancel_sync') {
            return interaction.update({ content: '❌ Sync cancelled.', components: [] }).catch(noop);
        }
        if (interaction.customId === 'reg_cancel_pilot_remove') {
            return interaction.update({ content: '❌ Pilot removal cancelled.', components: [] }).catch(noop);
        }

        // ── Elder/Admin approval buttons ──
        if (interaction.customId.startsWith('reg_elder_approve_owner_')) {
            return handleRegElderApproveOwner(interaction, db, saveLocalStorage, logEvent);
        }
        if (interaction.customId.startsWith('reg_elder_reject_owner_')) {
            return handleRegElderRejectOwner(interaction, db, saveLocalStorage, logEvent);
        }
        if (interaction.customId.startsWith('reg_elder_approve_pilot_')) {
            return handleRegElderApprovePilot(interaction, db, saveLocalStorage, logEvent);
        }
        if (interaction.customId.startsWith('reg_elder_reject_pilot_')) {
            return handleRegElderRejectPilot(interaction, db, saveLocalStorage, logEvent);
        }

        // Standard panel buttons
        return handleRegPanelButtons(interaction, db, saveLocalStorage, logEvent);
    }

    // ── Registration Panel Select Menus ──
    if (interaction.isStringSelectMenu() && interaction.customId === 'reg_select_pilot_remove') {
        await interaction.deferUpdate();
        return handleRegRemovePilotSelect(interaction, db, saveLocalStorage);
    }

    // ── Registration Modal ──
    if (interaction.isModalSubmit() && interaction.customId === 'reg_modal') {
        await interaction.deferReply({ flags: 64 });
        return handleRegModalSubmit(interaction, db, saveLocalStorage, logEvent);
    }

    // ── Pilot Registration Modal ──
    if (interaction.isModalSubmit() && interaction.customId === 'reg_pilot_modal') {
        await interaction.deferReply({ flags: 64 });
        return handleRegPilotModal(interaction, db, saveLocalStorage, logEvent);
    }

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

    // ── Not a button/select/modal? Must be a slash command ──
    if (!interaction.isCommand()) return;
    const { commandName } = interaction;

    // ── Route slash commands → ranking-handlers-commands.js ──
    if (commandName === 'forcesync') return handleForceSyncCommand(interaction, db, saveLocalStorage, logEvent);
    if (commandName === 'manage') return handleManageCommand(interaction, db);
    if (commandName === 'manualregister') return handleManualRegisterCommand(interaction, db, saveLocalStorage, logEvent);
    if (commandName === 'manualpilot') return handleManualPilotCommand(interaction, db);
    if (commandName === 'manualremovepilot') return handleManualRemovePilotCommand(interaction, db);
    if (commandName === 'manualremove') return handleManualRemoveCommand(interaction, db);
    if (commandName === 'cleandb') return handleCleanDbCommand(interaction, db, saveLocalStorage, logEvent);
}
