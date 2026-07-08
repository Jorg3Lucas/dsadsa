import { PermissionFlagsBits } from 'discord.js';
import { getMsg } from './lang.js';

// ==========================================
// 📜 SLASH COMMANDS REGISTRATION
// ==========================================

export async function registerMir4SlashCommands(guild) {
    try {
        await guild.commands.set([
            // ── Ranking commands (registration via welcome buttons only) ──
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
                description: '🛠️ Bot Management Panel'
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
            {
                name: 'sendpanel',
                description: getMsg('ranking.commands.sendpanel.description'),
                default_member_permissions: PermissionFlagsBits.Administrator.toString()
            },
            {
                name: 'listunregistered',
                description: getMsg('ranking.commands.listunregistered.description'),
                default_member_permissions: PermissionFlagsBits.Administrator.toString(),
                options: [
                    { type: 5, name: 'notify', description: 'Send a DM to each unregistered member asking them to register (5s delay each)' }
                ]
            },
            {
                name: 'pending',
                description: getMsg('ranking.commands.pending.description'),
                default_member_permissions: PermissionFlagsBits.Administrator.toString()
            },
            {
                name: 'scanimport',
                description: '📥 Scan another server and pre-register members by nickname',
                default_member_permissions: PermissionFlagsBits.Administrator.toString()
            },
        ]);
        console.log(getMsg('ranking.logs.commandsRegistered'));
    } catch (error) { console.error(getMsg('ranking.logs.commandsError'), error); }
}
