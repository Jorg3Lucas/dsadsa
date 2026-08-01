// ==========================================
// 🔗 REGISTRATION — Router (public API facade)
// The registration system was split into focused modules:
//   • registration-shared.js   → state, persistence, regEmbed, constants, cleanup
//   • registration-embed.js    → embed & button builders
//   • registration-deploy.js   → panel/welcome deployment
//   • registration-actions.js  → interaction handlers (buttons, modals, approvals)
// This file keeps the original public API (same named exports) so that
// consumers (index.js, ranking-events.js, ranking-handlers.js) are untouched.
// ==========================================

// ── State, persistence & shared helpers ──
export {
    pilotRequests,
    pendingOwnerRegistrations,
    saveRegistrationRequests,
    loadRegistrationRequests,
    regEmbed,
    REG_PANEL_CUSTOM_ID,
    BUTTON_IDS,
    WELCOME_EMBED_TITLE,
    REG_PANEL_EMBED_TITLE,
    REQUEST_EXPIRY_MS,
    CONFIRM_EXPIRY_MS,
    cleanupExpiredPilotRequests,
    cleanupExpiredOwnerRegistrations
} from './registration-shared.js';

// ── Embed & button builders ──
export {
    buildRegPanelEmbed,
    buildWelcomeEmbed,
    buildRegPanelButtons
} from './registration-embed.js';

// ── Panel & welcome deployment ──
export {
    deployRegistrationPanel,
    refreshRegPanel,
    deployWelcomeMessage,
    setWelcomeChannel,
    setRegistrationChannel,
    getRegPanelChannelId
} from './registration-deploy.js';

// ── Interaction handlers ──
export {
    handleRegPanelButtons,
    handleReRegisterConfirm,
    handleRegModalSubmit
} from './registration-actions.js';

export {
    handleRegPilotModal,
    handleRegPilotApprove,
    handleRegPilotReject,
    handleRegPilotRevoke
} from './registration-pilot.js';

export {
    handleRegElderApproveOwner,
    handleRegElderRejectOwner,
    handleRegElderApprovePilot,
    handleRegElderRejectPilot
} from './registration-approvals-elder.js';

export {
    handleRegRemovePilotSelect,
    handleRegSyncConfirm
} from './registration-settings.js';
