// ==========================================
// ⚙️ CENTRALIZED CONFIG / ENV HELPERS
// ==========================================

// Load .env BEFORE anything reads env vars, and OVERRIDE any existing
// process-level variables so the .env file is always the source of truth
// (dotenv does not overwrite by default). This guarantees the bot uses
// ONLY the values from .env.
import dotenv from 'dotenv';
dotenv.config({ override: true });

/**
 * No-op function for silencing promise rejections.
 * Use as: `.catch(noop)` instead of `.catch(noop)`
 */
export const noop = () => {};

/**
 * The guild (server) ID the bot operates on — read ONLY from the .env file
 * (DISCORD_SERVER_ID). No hardcoded fallback: if the variable is missing,
 * the value is undefined and the boot logs a clear "Invalid Server ID" error.
 */
export const DISCORD_SERVER_ID = process.env.DISCORD_SERVER_ID;

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
