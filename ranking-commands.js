import { PermissionFlagsBits } from 'discord.js';
import { getMsg } from './lang.js';

// ==========================================
// 📜 SLASH COMMANDS REGISTRATION
// ==========================================

export async function registerMir4SlashCommands(guild) {
    try {
        await guild.commands.set([
            // ── Ranking commands ──
            {
                name: 'register',
                description: getMsg('ranking.commands.register.description')
            },
            {
                name: 'pilot',
                description: getMsg('ranking.commands.pilot.description'),
                options: [{ type: 6, name: 'member', description: getMsg('ranking.commands.pilot.options.member'), required: true }]
            },
            {
                name: 'removepilot',
                description: getMsg('ranking.commands.removepilot.description')
            },
            { 
                name: 'forcesync', 
                description: getMsg('ranking.commands.forcesync.description'),
                default_member_permissions: PermissionFlagsBits.Administrator.toString()
            },
            {
                name: 'manualregister',
                description: getMsg('ranking.commands.manualregister.description'),
                default_member_permissions: PermissionFlagsBits.Administrator.toString(),
                options: [
                    { type: 6, name: 'member', description: getMsg('ranking.commands.manualregister.options.member'), required: true },
                    { type: 3, name: 'nickname', description: getMsg('ranking.commands.manualregister.options.nickname'), required: true }
                ]
            },
            {
                name: 'manualpilot',
                description: getMsg('ranking.commands.manualpilot.description'),
                default_member_permissions: PermissionFlagsBits.Administrator.toString(),
                options: [
                    { type: 6, name: 'owner', description: getMsg('ranking.commands.manualpilot.options.owner'), required: true },
                    { type: 6, name: 'pilot', description: getMsg('ranking.commands.manualpilot.options.pilot'), required: true }
                ]
            },
            {
                name: 'cleandb',
                description: getMsg('ranking.commands.cleandb.description'),
                default_member_permissions: PermissionFlagsBits.Administrator.toString()
            },
            {
                name: 'manage',
                description: '🛠️ Bot Management Panel — Configure all bot systems'
            },
            {
                name: 'manualremove',
                description: getMsg('ranking.commands.manualremove.description'),
                default_member_permissions: PermissionFlagsBits.Administrator.toString(),
                options: [{ type: 6, name: 'member', description: getMsg('ranking.commands.manualremove.options.member'), required: true }]
            },
            {
                name: 'manualremovepilot',
                description: getMsg('ranking.commands.manualremovepilot.description'),
                default_member_permissions: PermissionFlagsBits.Administrator.toString(),
                options: [
                    { type: 6, name: 'owner', description: getMsg('ranking.commands.manualremovepilot.options.owner'), required: true },
                    { type: 6, name: 'pilot', description: getMsg('ranking.commands.manualremovepilot.options.pilot'), required: true }
                ]
            },

        ]);
        console.log(getMsg('ranking.logs.commandsRegistered'));
    } catch (error) { console.error(getMsg('ranking.logs.commandsError'), error); }
}
