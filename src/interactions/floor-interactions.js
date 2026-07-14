// ==========================================
// 🏗️ FLOOR INTERACTION ROUTER
// Death mark, Claim (normal/peak/fixed),
// Cancel, Next queue, Fixed type (Fury/Frenzy)
//
// Delegates all handlers to extracted sub-modules:
//   floor-death.js, floor-eventgroup.js,
//   floor-antidemon.js, floor-summon.js, floor-claim.js
// ==========================================

import { db } from "../core/state.js";

import {
    handleDeathMark,
    handleDeathConfirm,
    handleDeathCancel,
    handleEGDeathMark,
    handleEGDeathConfirm,
    handleEGDeathCancel
} from "./floor-death.js";

import {
    handleEventGroupClaim,
    handleEventGroupNext,
    handleEventGroupCancel,
    handleEGFixClaim,
    handleEGSlide,
    handleEGNextSide,
    handleEGTicket
} from "./floor-eventgroup.js";

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

/** Check if an interaction customId matches floor/event-group/antidemon/death/summon handlers. @param {import('discord.js').Interaction} interaction @returns {boolean} */
export function canHandleFloorInteraction(interaction) {
    const cid = interaction.customId;
    
    // Event group slide menus (select menus, not buttons)
    if (interaction.isStringSelectMenu()) {
        if (cid.startsWith("egslide-") || cid.startsWith("egticket-") || cid.startsWith("egnextside-")) return true;
        // Antidemon 2-level menu: version selection first
        if (cid.startsWith("antiversion-")) return true;
        return false;
    }
    
    // Individual fixed-event claim buttons (Fury/Frenzy/Random Event)
    if (cid.startsWith("egfixclaim-")) return true;
    
    if (!interaction.isButton()) return false;

    const parts = cid.split("-");
    const actionPrefix = parts[0];

    // Event group death marks: egdeath-{key}-{event}
    if ("egdeath" === actionPrefix) return true;
    if ("egdeathconfirm" === actionPrefix || "egdeathcancel" === actionPrefix) return true;
    if ("egticket" === actionPrefix) return true;

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
    // Handle String Select Menus for event group and antidemon versions
    if (interaction.isStringSelectMenu()) {
        const cid = interaction.customId;
        if (cid.startsWith("egslide-")) return handleEGSlide(interaction, uid, uName);
        if (cid.startsWith("egticket-")) return handleEGTicket(interaction, uid, uName);
        if (cid.startsWith("egnextside-")) return handleEGNextSide(interaction, uid, uName);
        if (cid.startsWith("antiversion-")) return handleAntiVersionSlide(interaction, uid, uName);
        return false;
    }
    
    if (!interaction.isButton()) return false;

    // Individual fixed-event claim buttons (Fury/Frenzy/Random Event)
    if (interaction.customId.startsWith("egfixclaim-")) {
        return handleEGFixClaim(interaction, uid, uName);
    }

    const [actionPrefix, panelKey, specificProp] = interaction.customId.split("-");
    const targetObj = db[panelKey];

    if (!targetObj) return false;

    // 💀 DEATH MARK
    if ("death" === actionPrefix) {
        return handleDeathMark(interaction, uid, uName, targetObj, panelKey, specificProp);
    }
    
    // 💀 EVENT GROUP DEATH MARK (egdeath-{key}-{event})
    if ("egdeath" === actionPrefix) {
        return handleEGDeathMark(interaction, uid, uName, targetObj, panelKey, specificProp);
    }

    // ✅ DEATH CONFIRM / CANCEL (update existing death time)
    if ("deathconfirm" === actionPrefix) {
        return handleDeathConfirm(interaction, uid, uName, targetObj, panelKey, specificProp);
    }
    if ("deathcancel" === actionPrefix) {
        return handleDeathCancel(interaction, uid, uName, targetObj, panelKey, specificProp);
    }
    
    // ✅ EVENT GROUP DEATH CONFIRM / CANCEL
    if ("egdeathconfirm" === actionPrefix) {
        return handleEGDeathConfirm(interaction, uid, uName, targetObj, panelKey, specificProp);
    }
    if ("egdeathcancel" === actionPrefix) {
        return handleEGDeathCancel(interaction, uid, uName, targetObj, panelKey, specificProp);
    }

    // ── All floor-level actions below ──

    // 🎯 EVENT GROUP ACTIONS (claim, next, cancel)
    if ("event_group" === targetObj.type) {
        if ("claim" === specificProp) {
            return handleEventGroupClaim(interaction, uid, uName, targetObj, panelKey);
        }
        if ("next" === specificProp) {
            return handleEventGroupNext(interaction, uid, uName, targetObj, panelKey);
        }
        if ("cancel" === specificProp) {
            return handleEventGroupCancel(interaction, uid, uName, targetObj, panelKey);
        }
    }

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
