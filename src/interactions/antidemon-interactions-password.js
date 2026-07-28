// ==========================================
// 👹 ANTIDEMON — Password Handlers
// Extracted from antidemon-interactions.js
// ==========================================

import { getMsg } from "../core/lang.js";
import { db, antiDemonSelectionCache, saveLocalStorage } from "../core/state.js";
import { refreshVisualPanel, notifyUserDM } from "../handlers/panel-utils.js";
import { pushToDailyLogs } from "../core/daily-logs.js";
import { getFormattedTime12h } from "../core/time-utils.js";
import { STATUS_CLAIMED } from "../core/constants.js";
import {
    ActionRowBuilder as t,
    ModalBuilder as m,
    TextInputBuilder as ti,
    TextInputStyle as tis,
    ButtonBuilder as n,
    ButtonStyle as a
} from "discord.js";
import { noop } from "../core/config.js";

/** Ask if user created a PT (party), show modal if already has password. @param {import('discord.js').ButtonInteraction} interaction @param {string} uid @returns {Promise<boolean>} */
export async function handleAntiPassword(interaction, uid) {
    if (!interaction.isButton()) return false;

    const [_, panelKey, room] = interaction.customId.split("-");
    const targetFloor = db[panelKey];

    if (!targetFloor || !targetFloor[room]) {
        return await interaction.reply({ content: getMsg("rooms.antidemonPasswordNotFound"), flags: 64 }).catch(noop);
    }
    if (targetFloor[room].ownerId !== uid) {
        return await interaction.reply({ content: getMsg("rooms.antidemonPasswordNotOwner"), flags: 64 }).catch(noop);
    }

    if (targetFloor[room].password) {
        const modal = new m()
            .setCustomId(`antipwdmodal-${panelKey}-${room}`)
            .setTitle(`🎮 Party Password — ${room.toUpperCase()}`)
            .addComponents(
                new t().addComponents(
                    new ti()
                        .setCustomId("password")
                        .setLabel(getMsg("rooms.antidemonPasswordInputLabel"))
                        .setStyle(tis.Short)
                        .setPlaceholder(getMsg("rooms.antidemonPasswordInputPlaceholder"))
                        .setRequired(false)
                        .setValue(targetFloor[room].password || "")
                )
            );
        return await interaction.showModal(modal).catch(noop);
    }

    return await interaction.reply({
        content: `🎮 **Party Password — ${room.toUpperCase()}**\n\nDid you create a **private party** for other members to find the room more easily?\n\nClick **Yes** to leave the password, or **No** if you didn't create one.`,
        components: [
            new t().addComponents(
                new n().setCustomId(`antipwdset-${panelKey}-${room}`).setLabel("✅ Yes, leave password").setStyle(a.Success),
                new n().setCustomId(`antipwdcancel-${panelKey}-${room}`).setLabel("❌ No").setStyle(a.Secondary)
            )
        ],
        flags: 64
    }).catch(noop);
}

/** Show the password modal to set a party password. @param {import('discord.js').ButtonInteraction} interaction @param {string} uid @returns {Promise<boolean>} */
export async function handleAntiPasswordSet(interaction, uid) {
    if (!interaction.isButton()) return false;

    const [_, panelKey, room] = interaction.customId.split("-");
    const targetFloor = db[panelKey];

    if (!targetFloor || !targetFloor[room]) {
        return await interaction.update({ content: getMsg("rooms.antidemonPasswordNotFound"), components: [] }).catch(noop);
    }
    if (targetFloor[room].ownerId !== uid) {
        return await interaction.update({ content: getMsg("rooms.antidemonPasswordNotOwner"), components: [] }).catch(noop);
    }

    const modal = new m()
        .setCustomId(`antipwdmodal-${panelKey}-${room}`)
        .setTitle(`🎮 Party Password — ${room.toUpperCase()}`)
        .addComponents(
            new t().addComponents(
                new ti()
                    .setCustomId("password")
                    .setLabel(getMsg("rooms.antidemonPasswordInputLabel"))
                    .setStyle(tis.Short)
                    .setPlaceholder(getMsg("rooms.antidemonPasswordInputPlaceholder"))
                    .setRequired(false)
            )
        );

    return await interaction.showModal(modal).catch(noop);
}

/** Handle user clicking "No" when asked about party password. @param {import('discord.js').ButtonInteraction} interaction @returns {Promise<boolean>} */
export async function handleAntiPasswordCancel(interaction) {
    if (!interaction.isButton()) return false;

    return await interaction.update({
        content: "👌 No problem! The party will be hidden by default. Members can find the room through the in-game party finder.",
        components: []
    }).catch(noop);
}

/** Handle the password modal submission — save, update, or clear password. @param {import('discord.js').ModalSubmitInteraction} interaction @returns {Promise<boolean>} */
export async function handleAntiPasswordModal(interaction) {
    const cid = interaction.customId;
    const parts = cid.split("-");
    const panelKey = parts[1];
    const room = parts[2];
    const targetFloor = db[panelKey];

    if (!targetFloor || !targetFloor[room]) {
        return await interaction.reply({ content: getMsg("rooms.antidemonPasswordNotFound"), flags: 64 }).catch(noop);
    }
    if (targetFloor[room].ownerId !== interaction.user.id) {
        return await interaction.reply({ content: getMsg("rooms.antidemonPasswordNotOwner"), flags: 64 }).catch(noop);
    }

    const newPassword = interaction.fields.getTextInputValue("password").trim();
    const oldPassword = targetFloor[room].password;

    if (newPassword) {
        targetFloor[room].password = newPassword;
        saveLocalStorage();
        await refreshVisualPanel(panelKey);
        return await interaction.reply({ content: getMsg("rooms.antidemonPasswordSet", { room: room.toUpperCase(), password: newPassword }), flags: 64 }).catch(noop);
    } else if (oldPassword) {
        targetFloor[room].password = "";
        saveLocalStorage();
        await refreshVisualPanel(panelKey);
        return await interaction.reply({ content: getMsg("rooms.antidemonPasswordCleared", { room: room.toUpperCase() }), flags: 64 }).catch(noop);
    } else {
        return await interaction.reply({ content: getMsg("rooms.antidemonPasswordNoChange"), flags: 64 }).catch(noop);
    }
}

// ==========================================
// 🆕 CLAIM + PASSWORD FLOW
// Called after ticket selection: asks about PT password
// ==========================================

/** Helper: apply the pending claim from cache with an optional password. @param {string} uid @param {string} pKey @param {string} [password] @returns {Promise<boolean>} Whether the claim was successfully applied */
async function applyClaimFromCache(uid, pKey, password) {
    const cache = antiDemonSelectionCache[uid];
    if (!cache || cache.panelId !== pKey) return false;

    const targetFloor = db[pKey];
    if (!targetFloor) return false;

    const { roomsToClaim, rangeStr, startTime, endTime, uName, calcMinutes, roomConfig } = cache;

    // Re-check race condition before applying
    for (const roomKey of roomsToClaim) {
        if (targetFloor[roomKey] && targetFloor[roomKey].ownerId && targetFloor[roomKey].ownerId !== uid) {
            delete antiDemonSelectionCache[uid];
            return false;
        }
    }

    for (const roomKey of roomsToClaim) {
        if (targetFloor[roomKey].nextId === uid) {
            targetFloor[roomKey].nextId = null;
            targetFloor[roomKey].nextName = null;
            targetFloor[roomKey].endLimit = null;
        }
        targetFloor[roomKey].status = STATUS_CLAIMED;
        targetFloor[roomKey].ownerId = uid;
        targetFloor[roomKey].ownerName = uName;
        targetFloor[roomKey].time = `${getFormattedTime12h(startTime)}\nto  ${getFormattedTime12h(endTime)}`;
        targetFloor[roomKey].timeWindow = rangeStr;
        if (password) targetFloor[roomKey].password = password;
    }

    const configLabel = (roomConfig || "").toUpperCase();
    pushToDailyLogs("CLAIM_START", uName, `${targetFloor.title} - Config: ${configLabel}${password ? " 🔑" : ""}`, `Total Ticket: ${calcMinutes} min until ${getFormattedTime12h(endTime)}`);
    notifyUserDM(uid, getMsg("rooms.dmClaimStartedNotice", {
        title: `${targetFloor.title} (${configLabel})${password ? ` 🔑 ${password}` : ""}`,
        window: rangeStr
    }));

    delete antiDemonSelectionCache[uid];
    saveLocalStorage();
    await refreshVisualPanel(pKey);
    return true;
}

/** Handle user clicking "Yes" on password prompt — shows modal to input the PT password. @param {import('discord.js').ButtonInteraction} interaction @param {string} uid @returns {Promise<void>} */
export async function handleAntiPwdYes(interaction, uid) {
    const pKey = interaction.customId.replace("antipwdask-yes-", "");

    if (!antiDemonSelectionCache[uid] || antiDemonSelectionCache[uid].panelId !== pKey) {
        return await interaction.update({
            content: getMsg("rooms.antidemonTimeoutCache"),
            components: [], flags: 64
        }).catch(noop);
    }

    const modal = new m()
        .setCustomId(`antipwdaskmodal-${pKey}`)
        .setTitle("🔑 Party Password")
        .addComponents(
            new t().addComponents(
                new ti()
                    .setCustomId("password")
                    .setLabel("Enter the PT password for others to join:")
                    .setStyle(tis.Short)
                    .setPlaceholder("e.g. 1234")
                    .setRequired(true)
                    .setMinLength(1)
                    .setMaxLength(20)
            )
        );

    return await interaction.showModal(modal).catch(noop);
}

/** Handle user clicking "No" on password prompt — applies claim without password. @param {import('discord.js').ButtonInteraction} interaction @param {string} uid @returns {Promise<void>} */
export async function handleAntiPwdNo(interaction, uid) {
    const pKey = interaction.customId.replace("antipwdask-no-", "");

    const applied = await applyClaimFromCache(uid, pKey);
    if (applied) {
        return await interaction.update({
            content: getMsg("rooms.antidemonClaimSuccessEphemeral"),
            components: [], flags: 64
        }).catch(noop);
    }

    return await interaction.update({
        content: getMsg("rooms.antidemonTimeoutCache"),
        components: [], flags: 64
    }).catch(noop);
}

/** Handle the password modal from the claim flow — saves password and applies claim. @param {import('discord.js').ModalSubmitInteraction} interaction @returns {Promise<void>} */
export async function handleAntiPwdModalClaim(interaction) {
    const cid = interaction.customId;
    const pKey = cid.replace("antipwdaskmodal-", "");
    const password = interaction.fields.getTextInputValue("password").trim();

    const applied = await applyClaimFromCache(interaction.user.id, pKey, password || null);
    if (applied) {
        let msg = getMsg("rooms.antidemonClaimSuccessEphemeral");
        if (password) msg += `\n🔑 **Password set:** ${password}`;
        return await interaction.reply({ content: msg, flags: 64 }).catch(noop);
    }

    return await interaction.reply({
        content: getMsg("rooms.antidemonTimeoutCache"),
        flags: 64
    }).catch(noop);
}
