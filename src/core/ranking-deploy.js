import { PermissionFlagsBits } from 'discord.js';

// ==========================================
// 🚀 SLASH COMMAND REGISTRATION
// ==========================================

export async function registerMir4SlashCommands(guild) {
    try {
        await guild.commands.set([
            { name: 'removepilot', description: 'Remove a specific pilot assigned to your account.' },
            {
                name: 'forcesync',
                description: '⚡ [Admin] Force an immediate synchronization with the official ranking portal.',
                default_member_permissions: PermissionFlagsBits.Administrator.toString()
            },
            {
                name: 'manualregister',
                description: '👑 [Admin] Register a player via cache lookup.',
                default_member_permissions: PermissionFlagsBits.Administrator.toString(),
                options: [
                    { type: 6, name: 'member', description: 'Discord member.', required: true },
                    { type: 3, name: 'nickname', description: 'In-game character name.', required: true }
                ]
            },
            {
                name: 'manualforce',
                description: '👑 [Admin] Force register a member as permanent — no fuzzy/ranking checks.',
                default_member_permissions: PermissionFlagsBits.Administrator.toString(),
                options: [
                    { type: 6, name: 'member', description: 'Discord member to register.', required: true },
                    { type: 3, name: 'nickname', description: 'In-game character name (exact as typed).', required: true }
                ]
            },
            {
                name: 'manualpilot',
                description: '👑 [Admin] Manually link a pilot to a character owner.',
                default_member_permissions: PermissionFlagsBits.Administrator.toString(),
                options: [
                    { type: 6, name: 'owner', description: 'Select the primary character owner.', required: true },
                    { type: 6, name: 'pilot', description: 'Select the Discord user acting as pilot.', required: true }
                ]
            },
            {
                name: 'cleandb',
                description: '👑 [Admin] Remove all duplicate nickname entries from the database.',
                default_member_permissions: PermissionFlagsBits.Administrator.toString()
            },
            { name: 'manage', description: '🛠️ Bot Management Panel' },
            {
                name: 'manualremove',
                description: '👑 [Admin] Completely remove a player\'s registration and profile.',
                default_member_permissions: PermissionFlagsBits.Administrator.toString(),
                options: [{ type: 6, name: 'member', description: 'Discord member to clear.', required: true }]
            },
            {
                name: 'manualremovepilot',
                description: '👑 [Admin] Manually remove a pilot from a character owner.',
                default_member_permissions: PermissionFlagsBits.Administrator.toString(),
                options: [
                    { type: 6, name: 'owner', description: 'Select the character owner.', required: true },
                    { type: 6, name: 'pilot', description: 'Select the pilot to remove.', required: true }
                ]
            },
            {
                name: 'sendpanel',
                description: '📋 [Admin] Send a fixed registration panel to this channel.',
                default_member_permissions: PermissionFlagsBits.Administrator.toString()
            },
            {
                name: 'listunregistered',
                description: '📋 [Admin] List members with role but no registration, optionally DM them.',
                default_member_permissions: PermissionFlagsBits.Administrator.toString(),
                options: [
                    { type: 5, name: 'notify', description: 'Send a DM to each unregistered member asking them to register (5s delay each)' }
                ]
            },
            {
                name: 'pending',
                description: '⏳ [Admin] List all pending registration requests with time remaining.',
                default_member_permissions: PermissionFlagsBits.Administrator.toString()
            },
            {
                name: 'scanimport',
                description: '📥 Scan another server and pre-register members by nickname',
                default_member_permissions: PermissionFlagsBits.Administrator.toString(),
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
                description: '🔍 [Admin] Auto-correct a member\'s nickname via fuzzy ranking match.',
                default_member_permissions: PermissionFlagsBits.Administrator.toString(),
                options: [
                    { type: 6, name: 'member', description: 'The member whose nickname needs fixing.', required: true },
                    { type: 3, name: 'nickname', description: 'Optional: the correct nickname. If omitted, auto-detect from ranking.', required: false }
                ]
            },
            { name: 'elderguide', description: '📋 Guide: how to approve/reject owner registrations' },
            { name: 'stats', description: '📊 Show bot statistics (registrations, sync status, allied clans)' },
            {
                name: 'notify',
                description: '📧 [Admin] Send notifications to server members',
                default_member_permissions: PermissionFlagsBits.Administrator.toString()
            },
            {
                name: 'refreshnames',
                description: '🔄 [Admin] Reapply server prefix to all registered members nicknames immediately.',
                default_member_permissions: PermissionFlagsBits.Administrator.toString()
            },
        ]);
        console.log('✅ Slash commands registered successfully.');
    } catch (error) {
        console.error('❌ Error registering slash commands:', error);
    }
}
