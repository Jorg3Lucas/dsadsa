// ==========================================
// ⚙️ CENTRALIZED CONFIG / ENV HELPERS
// ==========================================

/**
 * No-op function for silencing promise rejections.
 * Use as: `.catch(noop)` instead of `.catch(noop)`
 */
export const noop = () => {};

/**
 * The guild (server) ID the claim bot operates on.
 * Read from the DISCORD_SERVER_ID env var (.env) — never hardcoded.
 * @returns {string}
 * @throws {Error} If DISCORD_SERVER_ID is not set
 */
export function getServerId() {
    const id = process.env.DISCORD_SERVER_ID?.trim();
    if (!id) throw new Error("No server ID found — set DISCORD_SERVER_ID env var");
    return id;
}

/** The guild (server) ID the claim bot operates on, from .env. */
export const DISCORD_SERVER_ID = getServerId();

/**
 * Membership role used for claim-channel permissions.
 * The bot never creates roles — it must already exist on the server.
 */
export const MEMBER_ROLE_ID = process.env.MEMBER_ROLE_ID?.trim() || '1503933709756141620';

/** User who receives high-risk / panel-recovery alerts. */
export const SUPER_ADMIN_USER_ID = process.env.SUPER_ADMIN_USER_ID?.trim() || '864108100880171009';

/**
 * Returns the bot token from environment variables.
 * Supports both TOKEN and DISCORD_TOKEN env vars.
 * @returns {string}
 * @throws {Error} If no token is found
 */
export function getBotToken() {
    const token = process.env.TOKEN || process.env.DISCORD_TOKEN;
    if (!token) throw new Error("No bot token found — set TOKEN or DISCORD_TOKEN env var");
    return token;
}
