// ==========================================
// 🎫 TICKET SYSTEM — Router
// Dispatches to ticket-core.js + ticket-handlers.js
// ==========================================

import { dispatchTicketHandler } from "./ticket-handlers.js";

export { initTicketSystem, setupTicketPanel } from "./ticket-core.js";
export { dispatchTicketHandler }

const ticketCustomIds = [
    "ticket_open", "ticket_category", "ticket_add", "ticket_add_select",
    "ticket_remove", "ticket_remove_select", "ticket_close",
    "ticket_close_confirm", "ticket_close_cancel"
];

/** Check if an interaction customId belongs to this ticket system. @param {object} interaction @returns {boolean} */
export function canHandleTicketInteraction(interaction) {
    return ticketCustomIds.includes(interaction.customId);
}

/** Route an interaction to the ticket handler dispatch. @returns {Promise<boolean>} */
export async function handleTicketInteraction(interaction) {
    return dispatchTicketHandler(interaction, interaction.customId);
}
