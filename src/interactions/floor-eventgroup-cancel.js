// ==========================================
// 🎯 FLOOR — Event Group Cancel
// Extracted from floor-eventgroup.js
// ==========================================

import { getMsg } from "../core/lang.js";
import { saveLocalStorage } from "../core/state.js";
import { refreshVisualPanel, notifyUserDM } from "../handlers/panel-utils.js";
import { pushToDailyLogs } from "../core/daily-logs.js";
import {
    applyFiveMinCooldown,
    getEventGroupKeys
} from "../handlers/claim-core.js";
import { getFormattedTime12h, getLocalTime } from "../core/time-utils.js";
import { STATUS_AVAILABLE, STATUS_OPEN } from "../core/constants.js";
import { noop } from "../core/config.js";

/** Cancel user's claim/queue for an event_group panel event. Applies 5min cooldown for non-mod users. @param {import('discord.js').ButtonInteraction|import('discord.js').StringSelectMenuInteraction} interaction @param {string} uid @param {string} uName @param {object} targetObj @param {string} panelKey @returns {Promise<void>} */
export async function handleEventGroupCancel(interaction, uid, uName, targetObj, panelKey) {
    const isMod = interaction.member.permissions.has("ManageMessages");
    const eventKeys = getEventGroupKeys(targetObj);
    const isOwner = eventKeys.some(ev => targetObj[ev] && targetObj[ev].ownerId === uid);
    const isInQueue = eventKeys.some(ev => targetObj[ev] && targetObj[ev].nextId === uid);

    if (isOwner || isInQueue || isMod) {
        let penalized = false;
        let anyAction = false;

        for (const ev of eventKeys) {
            const evData = targetObj[ev];
            if (evData.ownerId === uid) {
                anyAction = true;
                const currentLoggedName = evData.ownerName || uName;
                pushToDailyLogs("CANCEL", currentLoggedName, `${targetObj.title} - ${evData.name}`, isMod ? getMsg("logs.staffCancel") : getMsg("logs.userCancel"));
                notifyUserDM(evData.ownerId, getMsg("rooms.dmRemovedNotice", {
                    title: `${targetObj.title} - ${evData.name}`,
                    reason: isMod ? getMsg("logs.staffCancel") : getMsg("logs.userCancel")
                }));

                if (evData.type === "summon") {
                    evData.status = STATUS_AVAILABLE;
                    evData.ownerId = null;
                    evData.ownerName = null;
                    evData.time = "";
                    evData.timeWindow = "";
                    if (evData.nextId) {
                        const nid = evData.nextId,
                            nname = evData.nextName;
                        evData.nextId = null;
                        evData.nextName = null;
                        evData.formattedTimeNext = "";
                        evData.ownerId = nid;
                        evData.ownerName = nname;
                        const grace = new Date(getLocalTime().getTime() + 3e5);
                        evData.timeWindow = `${getFormattedTime12h(new Date())} ~ ${getFormattedTime12h(grace)}`;
                        evData.status = STATUS_OPEN;
                        notifyUserDM(nid, getMsg("rooms.summonTurnArrivedDM", {
                            roomKey: evData.name,
                            title: targetObj.title
                        })).catch(noop);
                    }
                } else {
                    evData.ownerId = null;
                    evData.ownerName = null;
                    evData.timeWindow = "";
                    if (evData._claimTimestamp) delete evData._claimTimestamp;
                }

                if (!isMod && !penalized) {
                    applyFiveMinCooldown(uid);
                    penalized = true;
                }
            }
            if (evData.nextId === uid) {
                anyAction = true;
                const currentLoggedName = evData.nextName || uName;
                pushToDailyLogs("CANCEL", currentLoggedName, `${targetObj.title} - ${evData.name} (Next Queue)`, isMod ? getMsg("logs.staffQueueCancel") : getMsg("logs.userQueueCancel"));
                notifyUserDM(evData.nextId, getMsg("rooms.dmRemovedNotice", {
                    title: `${targetObj.title} - ${evData.name} (Queue)`,
                    reason: isMod ? getMsg("logs.staffQueueCancel") : getMsg("logs.userQueueCancel")
                }));
                evData.nextId = null;
                evData.nextName = null;
                evData.endLimit = null;
                evData.formattedTimeNext = "";
            }
        }

        saveLocalStorage();
        await refreshVisualPanel(panelKey);
        return await interaction.reply({
            content: anyAction
                ? (penalized ? getMsg("cooldowns.canceledClaimFeedback") : getMsg("rooms.actionsCanceledFeedback"))
                : getMsg("rooms.noActiveClaimsFeedback"),
            flags: 64
        }).catch(noop);
    }
    return await interaction.reply({ content: getMsg("rooms.noActiveClaimsFeedback"), flags: 64 }).catch(noop);
}
