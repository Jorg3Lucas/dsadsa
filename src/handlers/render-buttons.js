import {
    ActionRowBuilder as t,
    ButtonBuilder as n,
    ButtonStyle as a
} from "discord.js";
import { getMsg } from "../core/lang.js";
import { db } from "../core/state.js";
import { STATUS_CLAIMED } from "../core/constants.js";
import { getAntidemonRoomKeys, getSummonRoomKeys, getEventGroupKeys } from "./claim-core.js";

// ==========================================
// 🎛️ BUTTON RENDERING
// ==========================================

/** Build ActionRow components (buttons) for a panel. Includes death-mark, claim, cancel, DM toggle. @param {string} key - Panel key @returns {import('discord.js').ActionRowBuilder[]} */
export function renderButtons(key) {
    const current = db[key],
        componentsList = [];
    if (!current) return componentsList;
    
    if ("event_group" === current.type) {
        const eventKeys = getEventGroupKeys(current);
        const hasNonFixedEvents = eventKeys.some(ev => current[ev] && current[ev].type !== "fixed");
        const schedEvents = eventKeys.filter(ev => current[ev].type === "schedule");
        const fixedEvents = eventKeys.filter(ev => current[ev].type === "fixed");
        const anySummonQueue = eventKeys.some(ev => current[ev].type === "summon" && current[ev].nextId);
        
        const mainRow = new t();
        
        schedEvents.forEach(ev => {
            mainRow.addComponents(new n()
                .setCustomId(`egdeath-${key}-${ev}`)
                .setEmoji("🟥")
                .setStyle(a.Secondary));
        });
        
        fixedEvents.filter(ev => ev !== "randomevent").forEach(ev => {
            const isClaimed = !!current[ev].ownerId;
            const isReserved = !!current[ev].reservedFor && !isClaimed;
            mainRow.addComponents(new n()
                .setCustomId(`egfixclaim-${key}-${ev}`)
                .setLabel(isClaimed ? `👑 ${current[ev].ownerName || "Claimed"}` : isReserved ? `🔒 ${current[ev].name}` : current[ev].name)
                .setDisabled(isClaimed)
                .setStyle(isClaimed ? a.Secondary : isReserved ? a.Secondary : a.Success));
        });
        
        if (hasNonFixedEvents) {
            mainRow.addComponents(new n()
                .setCustomId(`floor-${key}-claim`)
                .setLabel(getMsg("buttons.claimLabel"))
                .setStyle(a.Success));
        }
        if (anySummonQueue) {
            mainRow.addComponents(new n()
                .setCustomId(`floor-${key}-next`)
                .setLabel(getMsg("buttons.nextLabel"))
                .setStyle(a.Primary));
        }
        mainRow.addComponents(new n()
            .setCustomId(`floor-${key}-cancel`)
            .setLabel(getMsg("buttons.cancelLabel"))
            .setStyle(a.Danger));
        
        if (mainRow.components.length > 0) componentsList.push(mainRow);
        
    } else if ("fixed" !== current.type && "antidemon" !== current.type && "summon" !== current.type) {
        const row = new t();
        let hasProperties = false;
        for (const prop in current) {
            if (["title", "timeWindow", "next", "ownerId", "ownerName", "type", "schedules", "_claimTimestamp"].includes(prop)) continue;
            let emojiStr = "🎯";
            if (current[prop].name.includes("Left")) emojiStr = "⬅️";
            else if (current[prop].name.includes("Right")) emojiStr = "➡️";
            else if (current[prop].name.includes("Red")) emojiStr = "🟥";
            else if (current[prop].name.includes("Plant")) emojiStr = "🌱";
            else if (current[prop].name.includes("Ore")) emojiStr = "⛏️";
            else if (current[prop].name.includes("1")) emojiStr = "1️⃣";
            else if (current[prop].name.includes("2")) emojiStr = "2️⃣";
            else if (current[prop].name.includes("3")) emojiStr = "3️⃣";

            row.addComponents(new n()
                .setCustomId(`death-${key}-${prop}`)
                .setEmoji(emojiStr)
                .setStyle(a.Secondary));
            hasProperties = true;
        }
        if (hasProperties) componentsList.push(row);
    }

    // Core action buttons
    const coreRow = new t();
    
    if ("event_group" === current.type) {
        // Already handled above in combined row
    } else if ("antidemon" === current.type || "summon" === current.type) {
        const summonProps = "summon" === current.type ? getSummonRoomKeys(key) : getAntidemonRoomKeys(key);
        const anyClaimed = summonProps.some(p => current[p] && current[p].status === STATUS_CLAIMED);
        coreRow.addComponents(
            new n()
                .setCustomId(`floor-${key}-claim`)
                .setLabel(getMsg("buttons.claimLabel"))
                .setStyle(a.Success),
            ...(anyClaimed ? [new n()
                .setCustomId(`floor-${key}-next`)
                .setLabel(getMsg("buttons.nextLabel"))
                .setStyle(a.Primary)] : []),
            new n()
                .setCustomId(`floor-${key}-cancel`)
                .setLabel(getMsg("buttons.cancelLabel"))
                .setStyle(a.Danger)
        );
    } else {
        coreRow.addComponents(
            new n()
                .setCustomId(`floor-${key}-claim`)
                .setLabel(getMsg("buttons.claimLabel"))
                .setStyle(a.Success),
            new n()
                .setCustomId(`floor-${key}-cancel`)
                .setLabel(getMsg("buttons.cancelLabel"))
                .setStyle(a.Danger)
        );
    }
    
    if (coreRow.components.length > 0) componentsList.push(coreRow);
    
    // ── DM Notification Toggle ──
    const dmRow = new t();
    dmRow.addComponents(
        new n()
            .setCustomId('dmoptout')
            .setEmoji('🔕')
            .setLabel('DM Notifications')
            .setStyle(a.Secondary)
    );
    componentsList.push(dmRow);
    
    return componentsList;
}
