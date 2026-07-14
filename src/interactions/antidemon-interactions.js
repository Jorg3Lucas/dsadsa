// ==========================================
// 👹 ANTIDEMON INTERACTION HANDLERS (Router)
// antislide-, antiticket-, antinextside-, antipwd-
// ==========================================

import { handleAntiSlide, handleAntiTicket } from "./antidemon-interactions-slide.js";
import { handleAntiNextSide } from "./antidemon-interactions-queue.js";
import {
    handleAntiPassword,
    handleAntiPasswordSet,
    handleAntiPasswordCancel,
    handleAntiPasswordModal,
    handleAntiPwdYes,
    handleAntiPwdNo,
    handleAntiPwdModalClaim
} from "./antidemon-interactions-password.js";

/** Check if an interaction customId matches antidemon slide/ticket/next/password handlers. */
export function canHandleAntidemonInteraction(interaction) {
    const cid = interaction.customId;
    return cid.startsWith("antislide-") ||
        cid.startsWith("antiticket-") ||
        cid.startsWith("antinextside-") ||
        cid.startsWith("antipwdset-") ||
        cid.startsWith("antipwdcancel-") ||
        cid.startsWith("antipwd-") ||
        cid.startsWith("antipwdask-yes-") ||
        cid.startsWith("antipwdask-no-");
}

/** Check if a modal submit matches the antidemon password modal. */
export function canHandleAntidemonModal(interaction) {
    return interaction.isModalSubmit() && interaction.customId.startsWith("antipwdmodal-");
}

/** Route an antidemon interaction to the appropriate handler. */
export async function handleAntidemonInteraction(interaction, uid, uName) {
    const cid = interaction.customId;

    if (cid.startsWith("antislide-")) return handleAntiSlide(interaction, uid);
    if (cid.startsWith("antiticket-")) return handleAntiTicket(interaction, uid, uName);
    if (cid.startsWith("antinextside-")) return handleAntiNextSide(interaction, uid, uName);
    if (cid.startsWith("antipwdset-")) return handleAntiPasswordSet(interaction, uid);
    if (cid.startsWith("antipwdcancel-")) return handleAntiPasswordCancel(interaction);
    if (cid.startsWith("antipwd-")) return handleAntiPassword(interaction, uid);
    if (cid.startsWith("antipwdask-yes-")) return handleAntiPwdYes(interaction, uid);
    if (cid.startsWith("antipwdask-no-")) return handleAntiPwdNo(interaction, uid);

    return false;
}

/** Route an antidemon modal submit (password save/update/clear or claim+password). */
export async function handleAntidemonModal(interaction) {
    if (interaction.customId.startsWith("antipwdaskmodal-")) {
        return handleAntiPwdModalClaim(interaction);
    }
    if (interaction.customId.startsWith("antipwdmodal-")) {
        return handleAntiPasswordModal(interaction);
    }
    return false;
}
