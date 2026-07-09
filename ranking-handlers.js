// ==========================================
// 🖱️ MAIN INTERACTION DISPATCHER
// Routes interactions to specialized modules
// ==========================================

// ── Sub-handler modules ──
import { handleRegistrationInteractions } from './ranking-registration.js';
import { handleConfirmationButtons } from './ranking-confirmations.js';
import { handleManageInteractions } from './ranking-manage.js';
import { handleAdminCommands } from './ranking-cmd-admin.js';

// ==========================================
// 🖱️ MAIN HANDLER
// ==========================================

export async function handleMir4Interactions(interaction, db, saveLocalStorage, logEvent) {
    if (!db.users) db.users = {};

    // ── Registration flow: welcome, modals, approvals, pilots ──
    await handleRegistrationInteractions(interaction, db, saveLocalStorage, logEvent);

    // ── Confirmation buttons ──
    await handleConfirmationButtons(interaction, db, saveLocalStorage, logEvent);

    // ── Manage menu & allied clans ──
    await handleManageInteractions(interaction, db, saveLocalStorage, logEvent);

    // ── Slash commands ──
    if (interaction.isCommand()) {
        await handleAdminCommands(interaction, db, saveLocalStorage, logEvent);
    }
}
