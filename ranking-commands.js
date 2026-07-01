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
                description: getMsg('ranking.commands.manage.description'),
                default_member_permissions: PermissionFlagsBits.Administrator.toString()
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
            // ── Gold Shop commands ──
            {
                name: 'shop',
                description: '🛒 Ver a loja de Gold do MIR4'
            },
            {
                name: 'orders',
                description: '📋 Ver seus pedidos de Gold'
            },
            {
                name: 'order',
                description: '🔍 Ver detalhes de um pedido',
                options: [{ type: 3, name: 'id', description: 'ID do pedido (ex: GOLD-000001)', required: true }]
            },
            {
                name: 'goldshop',
                description: '🏪 [Admin] Criar painel fixo da Gold Shop neste canal',
                default_member_permissions: PermissionFlagsBits.ManageMessages.toString()
            },
            {
                name: 'goldadmin',
                description: '👑 [Admin] Gerenciar loja de gold',
                default_member_permissions: PermissionFlagsBits.ManageMessages.toString(),
                options: [
                    { type: 1, name: 'stats', description: 'Ver estatísticas da loja' },
                    { type: 1, name: 'pedidos', description: 'Ver pedidos pendentes de entrega' },
                    { type: 1, name: 'entregar', description: 'Marcar um pedido como entregue', options: [{ type: 3, name: 'id', description: 'ID do pedido', required: true }] },
                    { type: 1, name: 'cancelar', description: 'Cancelar um pedido', options: [{ type: 3, name: 'id', description: 'ID do pedido', required: true }, { type: 3, name: 'motivo', description: 'Motivo do cancelamento', required: false }] }
                ]
            }
        ]);
        console.log(getMsg('ranking.logs.commandsRegistered'));
    } catch (error) { console.error(getMsg('ranking.logs.commandsError'), error); }
}
