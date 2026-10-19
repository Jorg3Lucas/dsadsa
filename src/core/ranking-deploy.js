import fs from 'node:fs';

// ==========================================
// 🚀 SLASH COMMAND REGISTRATION
// ==========================================
// The command list lives in src/commands.json — a SINGLE source of truth shared
// with the manual deployer (src/deploy-commands.cjs). Both paths use
// set()/put(), which REPLACES all guild commands, so a command missing from the
// JSON disappears on the next start. Keeping two hand-maintained copies used to
// let the runtime list and the deploy list drift apart.
//
// The file is read as JSON (not imported) on purpose: deploy-commands.cjs is
// CommonJS and cannot `import` an ES module.

const COMMANDS_PATH = new URL('../commands.json', import.meta.url);

/** Every slash command payload, in the exact shape Discord expects. */
export const SLASH_COMMANDS = JSON.parse(fs.readFileSync(COMMANDS_PATH, 'utf8'));

export async function registerMir4SlashCommands(guild) {
    try {
        await guild.commands.set(SLASH_COMMANDS);
        console.log('✅ Slash commands registered successfully.');
    } catch (error) {
        console.error('❌ Error registering slash commands:', error);
    }
}
