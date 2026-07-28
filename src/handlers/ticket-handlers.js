// ==========================================
// 🎫 TICKET SYSTEM — Handlers (Router)
// Delegates to sub-modules
// ==========================================

import {
    handleOpenTicket,
    handleTicketCategory,
    handleCloseTicket,
    handleCloseConfirm,
    handleCloseCancel
} from "./ticket-handlers-core.js";
import { handleAddMember, handleAddMemberSelect, handleRemoveMember, handleRemoveMemberSelect } from "./ticket-handlers-members.js";

// ── Handler dispatch map ──
const ticketHandlers = {
    "ticket_open": handleOpenTicket,
    "ticket_category": handleTicketCategory,
    "ticket_add": handleAddMember,
    "ticket_add_select": handleAddMemberSelect,
    "ticket_remove": handleRemoveMember,
    "ticket_remove_select": handleRemoveMemberSelect,
    "ticket_close": handleCloseTicket,
    "ticket_close_confirm": handleCloseConfirm,
    "ticket_close_cancel": handleCloseCancel,
};

/** Route a ticket interaction to its handler by customId. @returns {Promise<boolean>} Whether a handler was found */
export async function dispatchTicketHandler(interaction, cid) {
    const handler = ticketHandlers[cid];
    if (handler) {
        await handler(interaction);
        return true;
    }
    return false;
}
