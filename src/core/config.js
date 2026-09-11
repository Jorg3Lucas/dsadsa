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
 * Feature flag — ranking / registration system (scraper, sync, registration
 * panels, clan roles, slash commands).
 * Disabled by default while the game's ranking forum is down.
 * Set RANKING_ENABLED=true in .env to re-enable the whole system.
 */
export const RANKING_ENABLED = String(process.env.RANKING_ENABLED ?? 'false').toLowerCase() === 'true';

/**
 * Feature flag — claim website (browser claim site + JSON API).
 * Disabled by default; set WEB_ENABLED=true in .env to serve it again.
 */
export const WEB_ENABLED = String(process.env.WEB_ENABLED ?? 'false').toLowerCase() === 'true';

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
