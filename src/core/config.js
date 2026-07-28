// ==========================================
// ⚙️ CENTRALIZED CONFIG / ENV HELPERS
// ==========================================

/**
 * No-op function for silencing promise rejections.
 * Use as: `.catch(noop)` instead of `.catch(noop)`
 */
export const noop = () => {};

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
