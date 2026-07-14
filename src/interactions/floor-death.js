// ==========================================
// 💀 FLOOR — Death Mark Handlers
// Extracted from floor-interactions.js
// ==========================================

import {
    ActionRowBuilder as t,
    ButtonBuilder as n,
    ButtonStyle as a
} from "discord.js";
import { getMsg } from "../core/lang.js";
import { saveLocalStorage } from "../core/state.js";
import { refreshVisualPanel } from "../handlers/panel-utils.js";
import { pushToDailyLogs } from "../core/daily-logs.js";
import { getFormattedTime12h, getLocalTime } from "../core/time-utils.js";
import { STATUS_KILLED, STATUS_KILLED_PREFIX } from "../core/constants.js";
import { noop } from "../core/config.js";

// ⏳ Track death confirmation timeouts so they can be cancelled on button click
const deathConfirmTimeouts = new Map();

// ==========================================
// 💀 DEATH MARK
// ==========================================

/** Mark a boss as killed (normal/peak panels). If already marked, shows confirmation prompt to update the time. @param {import('discord.js').ButtonInteraction} interaction @param {string} uid @param {string} uName @param {object} targetObj @param {string} panelKey @param {string} specificProp @returns {Promise<void>} */
export async function handleDeathMark(interaction, uid, uName, targetObj, panelKey, specificProp) {
    const currTimeStr = getFormattedTime12h(getLocalTime());
    const nowTs = getLocalTime().getTime();

    if (targetObj[specificProp].status.startsWith(STATUS_KILLED)) {
        const oldTimeStr = targetObj[specificProp].status.replace(STATUS_KILLED_PREFIX, "").trim();
        const timeoutKey = `death-${panelKey}-${specificProp}`;

        if (deathConfirmTimeouts.has(timeoutKey)) {
            clearTimeout(deathConfirmTimeouts.get(timeoutKey));
            deathConfirmTimeouts.delete(timeoutKey);
        }

        await interaction.reply({
            content: getMsg("rooms.deathUpdateConfirm", { oldTime: oldTimeStr, newTime: currTimeStr }),
            components: [
                new t().addComponents(
                    new n()
                        .setCustomId(`deathconfirm-${panelKey}-${specificProp}`)
                        .setLabel("✅ Update")
                        .setStyle(a.Success),
                    new n()
                        .setCustomId(`deathcancel-${panelKey}-${specificProp}`)
                        .setLabel("❌ Cancel")
                        .setStyle(a.Secondary)
                )
            ],
            flags: 64
        }).catch(noop);

        const timeoutId = setTimeout(async () => {
            try {
                await interaction.editReply({
                    content: getMsg("rooms.deathUpdateExpired"),
                    components: []
                });
            } catch (e) {
                // Silently ignored — non-critical operation
            }
            deathConfirmTimeouts.delete(timeoutKey);
        }, 30000);

        deathConfirmTimeouts.set(timeoutKey, timeoutId);
        return;
    }

    targetObj[specificProp].status = `${STATUS_KILLED_PREFIX}${currTimeStr}`;
    targetObj[specificProp]._lastKilledAt = nowTs;
    pushToDailyLogs("DEATH_MARK", uName, `${targetObj.title} - ${targetObj[specificProp].name}`, `Killed at ${currTimeStr}`);
    saveLocalStorage();
    await refreshVisualPanel(panelKey);
    return await interaction.reply({ content: getMsg("rooms.deathLogged"), flags: 64 }).catch(noop);
}

// ==========================================
// ✅ DEATH CONFIRM
// ==========================================

/** Confirm and update an existing death mark time. @param {import('discord.js').ButtonInteraction} interaction @param {string} uid @param {string} uName @param {object} targetObj @param {string} panelKey @param {string} specificProp @returns {Promise<boolean>} */
export async function handleDeathConfirm(interaction, uid, uName, targetObj, panelKey, specificProp) {
    const timeoutKey = `death-${panelKey}-${specificProp}`;
    if (deathConfirmTimeouts.has(timeoutKey)) {
        clearTimeout(deathConfirmTimeouts.get(timeoutKey));
        deathConfirmTimeouts.delete(timeoutKey);
    }

    const currTimeStr = getFormattedTime12h(getLocalTime());
    const nowTs = getLocalTime().getTime();

    targetObj[specificProp].status = `${STATUS_KILLED_PREFIX}${currTimeStr}`;
    targetObj[specificProp]._lastKilledAt = nowTs;
    pushToDailyLogs("DEATH_MARK", uName, `${targetObj.title} - ${targetObj[specificProp].name}`, `Killed at ${currTimeStr} (updated)`);
    saveLocalStorage();
    await refreshVisualPanel(panelKey);
    return await interaction.update({
        content: getMsg("rooms.deathUpdateConfirmed", { newTime: currTimeStr }),
        components: [],
        flags: 64
    }).catch(noop);
}

// ==========================================
// ❌ DEATH CANCEL
// ==========================================

/** Cancel an existing death mark update request. @param {import('discord.js').ButtonInteraction} interaction @param {string} uid @param {string} uName @param {object} targetObj @param {string} panelKey @param {string} specificProp @returns {Promise<boolean>} */
export async function handleDeathCancel(interaction, uid, uName, targetObj, panelKey, specificProp) {
    const timeoutKey = `death-${panelKey}-${specificProp}`;
    if (deathConfirmTimeouts.has(timeoutKey)) {
        clearTimeout(deathConfirmTimeouts.get(timeoutKey));
        deathConfirmTimeouts.delete(timeoutKey);
    }

    return await interaction.update({
        content: getMsg("rooms.deathUpdateCancelled"),
        components: [],
        flags: 64
    }).catch(noop);
}

// ==========================================
// 💀 EVENT GROUP DEATH MARK
// ==========================================

/** Mark a schedule-type event (Red Boss in event_group) as killed. If already marked, shows confirmation prompt. @param {import('discord.js').ButtonInteraction} interaction @param {string} uid @param {string} uName @param {object} targetObj @param {string} panelKey @param {string} specificProp @returns {Promise<void>} */
export async function handleEGDeathMark(interaction, uid, uName, targetObj, panelKey, specificProp) {
    const evData = targetObj[specificProp];
    if (!evData) {return await interaction.reply({ content: getMsg("rooms.noActiveClaimsFeedback"), flags: 64 }).catch(noop);}

    const currTimeStr = getFormattedTime12h(getLocalTime());
    const nowTs = getLocalTime().getTime();

    if (evData.status && evData.status.startsWith(STATUS_KILLED)) {
        const oldTimeStr = evData.status.replace(STATUS_KILLED_PREFIX, "").trim();
        await interaction.reply({
            content: getMsg("rooms.deathUpdateConfirm", { oldTime: oldTimeStr, newTime: currTimeStr }),
            components: [
                new t().addComponents(
                    new n().setCustomId(`egdeathconfirm-${panelKey}-${specificProp}`).setLabel("✅ Update").setStyle(a.Success),
                    new n().setCustomId(`egdeathcancel-${panelKey}-${specificProp}`).setLabel("❌ Cancel").setStyle(a.Secondary)
                )
            ],
            flags: 64
        }).catch(noop);
        return;
    }

    evData.status = `${STATUS_KILLED_PREFIX}${currTimeStr}`;
    evData._lastKilledAt = nowTs;
    pushToDailyLogs("DEATH_MARK", uName, `${targetObj.title} - ${evData.name}`, `Killed at ${currTimeStr}`);
    saveLocalStorage();
    await refreshVisualPanel(panelKey);
    return await interaction.reply({ content: getMsg("rooms.deathLogged"), flags: 64 }).catch(noop);
}

// ==========================================
// ✅ EVENT GROUP DEATH CONFIRM
// ==========================================

/** Confirm and update an existing event group death mark time. @param {import('discord.js').ButtonInteraction} interaction @param {string} uid @param {string} uName @param {object} targetObj @param {string} panelKey @param {string} specificProp @returns {Promise<boolean>} */
export async function handleEGDeathConfirm(interaction, uid, uName, targetObj, panelKey, specificProp) {
    const evData = targetObj[specificProp];
    if (!evData) {return await interaction.update({ content: getMsg("rooms.noActiveClaimsFeedback"), components: [], flags: 64 }).catch(noop);}

    const currTimeStr = getFormattedTime12h(getLocalTime());
    const nowTs = getLocalTime().getTime();

    evData.status = `${STATUS_KILLED_PREFIX}${currTimeStr}`;
    evData._lastKilledAt = nowTs;
    pushToDailyLogs("DEATH_MARK", uName, `${targetObj.title} - ${evData.name}`, `Killed at ${currTimeStr} (updated)`);
    saveLocalStorage();
    await refreshVisualPanel(panelKey);
    return await interaction.update({
        content: getMsg("rooms.deathUpdateConfirmed", { newTime: currTimeStr }),
        components: [], flags: 64
    }).catch(noop);
}

// ==========================================
// ❌ EVENT GROUP DEATH CANCEL
// ==========================================

/** Cancel an existing event group death mark update request. @param {import('discord.js').ButtonInteraction} interaction @param {string} uid @param {string} uName @param {object} targetObj @param {string} panelKey @param {string} specificProp @returns {Promise<boolean>} */
export async function handleEGDeathCancel(interaction, _uid, _uName, _targetObj, _panelKey, _specificProp) {
    return await interaction.update({
        content: getMsg("rooms.deathUpdateCancelled"),
        components: [], flags: 64
    }).catch(noop);
}
