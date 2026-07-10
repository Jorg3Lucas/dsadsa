import { PermissionFlagsBits, REST, Routes } from 'discord.js';
import { getMsg } from './lang.js';
import { SUPER_ADMIN_USER_ID } from './ranking-constants.js';

// ==========================================
// 📜 SLASH COMMANDS REGISTRATION
// ==========================================

export async function registerMir4SlashCommands(guild) {
    try {
        const registeredCommands = await guild.commands.set([
            // ── Ranking commands (registration via welcome buttons only) ──
            {
                name: 'removepilot',
                description: getMsg('ranking.commands.removepilot.description')
            },
            { 
                name: 'forcesync', 
                description: getMsg('ranking.commands.forcesync.description'),
                default_member_permissions: '0'
            },
            {
                name: 'manualregister',
                description: getMsg('ranking.commands.manualregister.description'),
                default_member_permissions: '0',
                options: [
                    { type: 6, name: 'member', description: getMsg('ranking.commands.manualregister.options.member'), required: true },
                    { type: 3, name: 'nickname', description: getMsg('ranking.commands.manualregister.options.nickname'), required: true }
                ]
            },
            {
                name: 'manualforce',
                description: '👑 [Admin] Force register a member as permanent — no fuzzy/ranking checks.',
                default_member_permissions: '0',
                options: [
                    { type: 6, name: 'member', description: 'Discord member to register.', required: true },
                    { type: 3, name: 'nickname', description: 'In-game character name (exact as typed).', required: true }
                ]
            },
            {
                name: 'manualpilot',
                description: getMsg('ranking.commands.manualpilot.description'),
                default_member_permissions: '0',
                options: [
                    { type: 6, name: 'owner', description: getMsg('ranking.commands.manualpilot.options.owner'), required: true },
                    { type: 6, name: 'pilot', description: getMsg('ranking.commands.manualpilot.options.pilot'), required: true }
                ]
            },
            {
                name: 'cleandb',
                description: getMsg('ranking.commands.cleandb.description'),
                default_member_permissions: '0'
            },
            {
                name: 'manage',
                description: '🛠️ Bot Management Panel'
            },
            {
                name: 'manualremove',
                description: getMsg('ranking.commands.manualremove.description'),
                default_member_permissions: '0',
                options: [{ type: 6, name: 'member', description: getMsg('ranking.commands.manualremove.options.member'), required: true }]
            },
            {
                name: 'manualremovepilot',
                description: getMsg('ranking.commands.manualremovepilot.description'),
                default_member_permissions: '0',
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
                default_member_permissions: '0',
                options: [
                    { type: 5, name: 'reset', description: '🧹 Clear all existing registrations from scan servers before re-importing' }
                ]
            },
            {
                name: 'scanimport_status',
                description: '📊 Show pre-registration status and auto-convert eligible members',
                default_member_permissions: PermissionFlagsBits.Administrator.toString()
            },
            {
                name: 'fixnick',
                description: getMsg('ranking.commands.fixnick.description'),
                default_member_permissions: PermissionFlagsBits.Administrator.toString(),
                options: [
                    { type: 6, name: 'member', description: getMsg('ranking.commands.fixnick.options.member'), required: true },
                    { type: 3, name: 'nickname', description: getMsg('ranking.commands.fixnick.options.nickname'), required: false }
                ]
            },
            {
                name: 'elderguide',
                description: '📋 Guide: how to approve/reject owner registrations'
            },
        ]);

        // ── Set command permissions so only super-admin can see/use high-risk commands ──
        const restrictedCommands = ['forcesync', 'manualregister', 'manualforce', 'manualpilot', 'manualremove', 'manualremovepilot', 'cleandb', 'scanimport'];
        const clientId = guild.client.user.id;
        const token = process.env.TOKEN || process.env.DISCORD_TOKEN;

        if (token) {
            const rest = new REST({ version: '10' }).setToken(token);

            for (const cmd of registeredCommands.values()) {
                if (restrictedCommands.includes(cmd.name)) {
                    try {
                        await rest.put(
                            Routes.applicationCommandPermissions(clientId, guild.id, cmd.id),
                            {
                                body: {
                                    permissions: [
                                        {
                                            id: SUPER_ADMIN_USER_ID,
                                            type: 2, // USER
                                            permission: true
                                        }
                                    ]
                                }
                            }
                        );
                        console.log(`🔒 /${cmd.name} — hidden from everyone except <@${SUPER_ADMIN_USER_ID}>`);
                    } catch (permErr) {
                        console.error(`⚠️ Failed to set permissions for /${cmd.name}: ${permErr.message}`);
                    }
                }
            }
        }

        console.log(getMsg('ranking.logs.commandsRegistered'));
    } catch (error) { console.error(getMsg('ranking.logs.commandsError'), error); }
}
