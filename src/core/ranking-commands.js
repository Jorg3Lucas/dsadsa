import { SLASH_COMMANDS } from './commands-definitions.js';
import { getMsg } from './lang.js';

// ==========================================
// 📜 SLASH COMMANDS REGISTRATION
// Uses shared definitions from commands-definitions.js
// Applies i18n at registration time.
// ==========================================

export async function registerMir4SlashCommands(guild) {
    try {
        await guild.commands.set(SLASH_COMMANDS);
        console.log(getMsg('ranking.logs.commandsRegistered'));
    } catch (error) {
        console.error(getMsg('ranking.logs.commandsError'), error);
    }
}
