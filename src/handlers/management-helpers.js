// ==========================================
// ⏰ TIMED CONFIRMATION HELPER
// Shared by management sub-modules
// ==========================================

import {
    ActionRowBuilder as t,
    ButtonBuilder as n
} from "discord.js";
import { getMsg } from "../core/lang.js";
import { noop } from "../core/config.js";

export const confirmTimeouts = new Map();

/** Send a confirmation prompt with a timeout. Disables buttons after expiry. @param {import('discord.js').Interaction} interaction @param {string} content @param {import('discord.js').ActionRowBuilder[]} buttons @param {number} [timeoutMs=30000] */
export async function sendTimedConfirm(interaction, content, buttons, timeoutMs = 30000) {
    await interaction.update({ content, components: buttons, flags: 64 }).catch(noop);

    const key = interaction.id;
    const timeout = setTimeout(async () => {
        try {
            const reply = await interaction.fetchReply();
            const disabledRows = reply.components.map(row =>
                new t().addComponents(
                    ...row.components.map(btn =>
                        n.from(btn).setDisabled(true)
                    )
                )
            );
            await interaction.editReply({
                content: content + "\n\n" + getMsg("management.promptExpired"),
                components: disabledRows
            }).catch(noop);
        } catch (e) {
            // Silently ignored — non-critical operation
        }
        confirmTimeouts.delete(key);
    }, timeoutMs);

    confirmTimeouts.set(key, timeout);
}

/** Clear a timed confirmation's timeout. @param {import('discord.js').Interaction} interaction */
export function clearConfirmTimeout(interaction) {
    const key = interaction.message?.interaction?.id || interaction.id;
    if (confirmTimeouts.has(key)) {
        clearTimeout(confirmTimeouts.get(key));
        confirmTimeouts.delete(key);
    }
}
