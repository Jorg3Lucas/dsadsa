// ==========================================
// 🏗️ FLOOR INTERACTION ROUTER
// Death mark, Claim (normal/peak/fixed),
// Cancel, Next queue, Summon, Antidemon
//
// Delegates all handlers to extracted sub-modules:
//   floor-death.js, floor-antidemon.js,
//   floor-summon.js, floor-claim.js
// ==========================================

import { db } from "../core/state.js";

import {
    handleDeathMark,
    handleDeathConfirm,
    handleDeathCancel
} from "./floor-death.js";

import {
    handleAntiClaim,
    handleAntiNext,
    handleAntiCancel,
    handleAntiVersionSlide
} from "./floor-antidemon.js";

import {
    handleSummonClaim,
    handleSummonNext,
    handleSummonCancel
} from "./floor-summon.js";

import {
    handleFloorCancel,
    handleFixedClaim,
    handleGeneralClaim,
    handleGeneralNext
} from "./floor-claim.js";

// ==========================================
// 🎯 MAIN DISPATCH
// ==========================================

/** Check if an interaction customId matches floor/antidemon/death/summon handlers. @param {import('discord.js').Interaction} interaction @returns {boolean} */
export function canHandleFloorInteraction(interaction) {
    const cid = interaction.customId;
    
    // Antidemon 2-level menu: version selection first
    if (interaction.isStringSelectMenu()) {
        if (cid.startsWith("antiversion-")) return true;
        return false;
    }
    
    if (!interaction.isButton()) return false;

    const parts = cid.split("-");
    const actionPrefix = parts[0];

    // Death mark: death-{key}-{prop}
    if ("death" === actionPrefix) return true;

    // Death confirm/cancel: deathconfirm-{key}-{prop}, deathcancel-{key}-{prop}
    if ("deathconfirm" === actionPrefix || "deathcancel" === actionPrefix) return true;

    // Floor actions: floor-{key}-{claim|next|cancel}
    if ("floor" === actionPrefix) return true;

    return false;
}

/** Route a floor interaction to the appropriate handler (death mark, claim, next, cancel) based on action prefix and panel type. @param {import('discord.js').Interaction} interaction @param {string} uid @param {string} uName @returns {Promise<boolean>} */
export async function handleFloorInteraction(interaction, uid, uName) {
    // Handle String Select Menus for antidemon versions
    if (interaction.isStringSelectMenu()) {
        const cid = interaction.customId;
        if (cid.startsWith("antiversion-")) return handleAntiVersionSlide(interaction, uid, uName);
        return false;
    }
    
    if (!interaction.isButton()) return false;

    const [actionPrefix, panelKey, specificProp] = interaction.customId.split("-");
    const targetObj = db[panelKey];

    if (!targetObj) return false;

    // 💀 DEATH MARK
    if ("death" === actionPrefix) {
        return handleDeathMark(interaction, uid, uName, targetObj, panelKey, specificProp);
    }

    // ✅ DEATH CONFIRM / CANCEL (update existing death time)
    if ("deathconfirm" === actionPrefix) {
        return handleDeathConfirm(interaction, uid, uName, targetObj, panelKey, specificProp);
    }
    if ("deathcancel" === actionPrefix) {
        return handleDeathCancel(interaction, uid, uName, targetObj, panelKey, specificProp);
    }

    // ── All floor-level actions below ──

    // 🌀 SUMMON SPECIFIC ACTIONS (claim, next, cancel)
    if ("summon" === targetObj.type) {
        if ("claim" === specificProp) {
            return handleSummonClaim(interaction, uid, uName, targetObj, panelKey);
        }
        if ("next" === specificProp) {
            return handleSummonNext(interaction, uid, uName, targetObj, panelKey);
        }
        if ("cancel" === specificProp) {
            return handleSummonCancel(interaction, uid, uName, targetObj, panelKey);
        }
    }

    // 👹 ANTIDEMON SPECIFIC ACTIONS (claim, next, cancel)
    if ("antidemon" === targetObj.type) {
        if ("claim" === specificProp) {
            return handleAntiClaim(interaction, uid, uName, targetObj, panelKey);
        }
        if ("next" === specificProp) {
            return handleAntiNext(interaction, uid, uName, targetObj, panelKey);
        }
        if ("cancel" === specificProp) {
            return handleAntiCancel(interaction, uid, uName, targetObj, panelKey);
        }
    }

    // ❌ CANCEL (floor-level: normal/peak/fixed)
    if ("cancel" === specificProp) {
        return handleFloorCancel(interaction, uid, uName, targetObj, panelKey);
    }

    // 🔑 CLAIM (floor-level: normal/peak/fixed)
    if ("claim" === specificProp) {
        if ("fixed" === targetObj.type) {
            return handleFixedClaim(interaction, uid, uName, targetObj, panelKey);
        }
        return handleGeneralClaim(interaction, uid, uName, targetObj, panelKey);
    }

    // ⏭️ NEXT QUEUE (normal/peak)
    if ("next" === specificProp) {
        return handleGeneralNext(interaction, uid, uName, targetObj, panelKey);
    }

    return false;
}
