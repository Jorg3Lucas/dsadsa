// ==========================================
// ⚙️ SERVER SETUP COMMAND
// Interactive system for configuring
// in-game servers (EU013, EU021) via
// Discord menus and buttons.
// ==========================================

import {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} from 'discord.js';
import * as serverConfig from '../server-config.js';
import { getMsg } from '../lang.js';

// ==========================================
// 🔤 PREFIXES for interaction routing
// ==========================================

export const SETUP_PREFIXES = [
    'setup-main',
    'setup-add',
    'setup-remove-',
    'setup-remove-confirm-',
    'setup-configure-',
    'setup-config-',
    'setup-category-',
    'setup-channel-',
    'setup-role-',
    'setup-rankurl-',
    'setup-staffrole-',
    'setup-back',
    'setup-menu-'
];

export function canHandleSetupInteraction(interaction) {
    const cid = interaction.customId;
    return SETUP_PREFIXES.some(prefix => cid.startsWith(prefix));
}

// ==========================================
// 🏠 MAIN SETUP MENU
// ==========================================

export async function handleSetupCommand(msg) {
    if (!msg.member || !msg.member.permissions.has('ManageMessages')) {
        return msg.reply({ content: '❌ You need the **Manage Messages** permission to use this.' }).catch(() => {});
    }

    const embed = buildMainMenuEmbed();
    const components = buildMainMenuButtons();

    await msg.reply({ embeds: [embed], components }).catch(() => {});
}

function buildMainMenuEmbed() {
    const servers = serverConfig.getServerList();
    const activeIds = serverConfig.getActiveServerIds();
    const guildId = serverConfig.getDiscordServerId() || 'Not configured';

    let desc = '### ⚙️ Server Configuration Menu\n\n';
    desc += `**Discord Server ID:** \`${guildId}\`\n\n`;
    desc += `**Configured In-Game Servers:** ${servers.length}\n`;

    if (servers.length === 0) {
        desc += '\n*No servers configured yet. Use **➕ Add Server** to begin.*';
    } else {
        desc += '\n';
        for (const srv of servers) {
            const srvData = serverConfig.getServer(srv.id);
            const hasRankUrl = srvData?.rankingUrl ? '✅' : '❌';
            const hasRoles = srvData?.clanRoles && Object.keys(srvData.clanRoles).length > 0 ? '✅' : '❌';
            const hasCats = srvData?.categories && Object.values(srvData.categories).some(v => v) ? '✅' : '❌';
            desc += `\n**${srv.name}** (\`${srv.id}\`)`;
            desc += `\n┗ 🔗 URL: ${hasRankUrl} | 👑 Roles: ${hasRoles} | 📁 Cats: ${hasCats}`;
        }
    }

    return new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('⚙️ Server Setup')
        .setDescription(desc)
        .setFooter({ text: 'Configure in-game servers for claims, ranking & salary' })
        .setTimestamp();
}

function buildMainMenuButtons() {
    const servers = serverConfig.getServerList();

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('setup-add')
            .setLabel('➕ Add Server')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId('setup-main-refresh')
            .setLabel('🔄 Refresh')
            .setStyle(ButtonStyle.Secondary)
    );

    const components = [row1];

    if (servers.length > 0) {
        const row2 = new ActionRowBuilder();

        if (servers.length <= 5) {
            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('setup-menu-configure')
                .setPlaceholder('⚙️ Configure a server...')
                .addOptions(
                    servers.map(srv =>
                        new StringSelectMenuOptionBuilder()
                            .setLabel(srv.name)
                            .setDescription(`Configure ${srv.name}`)
                            .setValue(srv.id)
                    )
                );
            row2.addComponents(selectMenu);
        }

        const row3 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('setup-menu-remove')
                .setLabel('🗑️ Remove Server')
                .setStyle(ButtonStyle.Danger)
        );

        if (row2.components.length > 0) components.push(row2);
        components.push(row3);
    }

    return components;
}

// ==========================================
// 🖱️ INTERACTION HANDLER
// ==========================================

export async function handleSetupInteraction(interaction) {
    const cid = interaction.customId;

    // ── Refresh main menu ──
    if (cid === 'setup-main-refresh') {
        const embed = buildMainMenuEmbed();
        const components = buildMainMenuButtons();
        return await interaction.update({ embeds: [embed], components }).catch(() => {});
    }

    // ── Add server ──
    if (cid === 'setup-add') {
        return await handleAddServer(interaction);
    }

    // ── Configure server (from select menu) ──
    if (cid === 'setup-menu-configure') {
        const serverId = interaction.values[0];
        return await showServerConfig(interaction, serverId);
    }

    // ── Remove server menu ──
    if (cid === 'setup-menu-remove') {
        return await handleRemoveServerMenu(interaction);
    }

    // ── Remove server select ──
    if (cid === 'setup-menu-remove-select') {
        return await handleRemoveServerSelect(interaction);
    }

    // ── Remove server confirm ──
    if (cid.startsWith('setup-remove-confirm-')) {
        const serverId = cid.replace('setup-remove-confirm-', '');
        return await handleRemoveServerConfirm(interaction, serverId);
    }

    // ── Back to main menu ──
    if (cid === 'setup-back') {
        const embed = buildMainMenuEmbed();
        const components = buildMainMenuButtons();
        return await interaction.update({ embeds: [embed], components }).catch(() => {});
    }

    // ── Back to server config ──
    if (cid.startsWith('setup-category-back-')) {
        return await showServerConfig(interaction, cid.replace('setup-category-back-', ''));
    }
    if (cid.startsWith('setup-channel-back-')) {
        return await showServerConfig(interaction, cid.replace('setup-channel-back-', ''));
    }
    if (cid.startsWith('setup-role-back-')) {
        return await showServerConfig(interaction, cid.replace('setup-role-back-', ''));
    }

    // ── Server config sub-menu ──
    if (cid.startsWith('setup-config-')) {
        const serverId = cid.replace('setup-config-', '');
        const action = interaction.values?.[0];

        if (action === 'rankurl') return await handleSetRankUrl(interaction, serverId);
        if (action === 'staffrole') return await handleSetStaffRole(interaction, serverId);
        if (action === 'categories') return await showCategoryConfig(interaction, serverId);
        if (action === 'channels') return await showChannelConfig(interaction, serverId);
        if (action === 'clanroles') return await showClanRolesConfig(interaction, serverId);
        if (action === 'rename') return await handleRenameServer(interaction, serverId);

        return await showServerConfig(interaction, serverId);
    }

    // ── Set category ──
    if (cid.startsWith('setup-category-')) {
        const serverId = cid.replace('setup-category-', '');
        return await handleSetCategory(interaction, serverId);
    }

    // ── Set channel ──
    if (cid.startsWith('setup-channel-')) {
        const serverId = cid.replace('setup-channel-', '');
        return await handleSetChannel(interaction, serverId);
    }

    // ── Set clan role ──
    if (cid.startsWith('setup-role-select-')) {
        // Select menu for choosing clan roles configuration action (add/remove)
        const srvId = cid.replace('setup-role-select-', '');
        const action = interaction.values?.[0];
        if (action === 'add') return await handleAddClanRole(interaction, srvId);
        if (action === 'remove') return await handleRemoveClanRole(interaction, srvId);
        return await showClanRolesConfig(interaction, srvId);
    }
    if (cid.startsWith('setup-role-remove-select-')) {
        // Select menu for choosing which clan role to remove
        const srvId = cid.replace('setup-role-remove-select-', '');
        return await handleRemoveClanRoleSelect(interaction, srvId);
    }



    return false;
}

// ==========================================
// ➕ ADD SERVER
// ==========================================

async function handleAddServer(interaction) {
    const modal = new ModalBuilder()
        .setCustomId('setup-modal-add-server')
        .setTitle('➕ Add In-Game Server');

    const idInput = new TextInputBuilder()
        .setCustomId('setup-server-id')
        .setLabel('Server ID (e.g., eu013, eu021)')
        .setPlaceholder('e.g., eu013')
        .setStyle(TextInputStyle.Short)
        .setMinLength(2)
        .setMaxLength(20)
        .setRequired(true);

    const nameInput = new TextInputBuilder()
        .setCustomId('setup-server-name')
        .setLabel('Display Name (e.g., EU013)')
        .setPlaceholder('e.g., EU013')
        .setStyle(TextInputStyle.Short)
        .setMinLength(1)
        .setMaxLength(30)
        .setRequired(true);

    modal.addComponents(
        new ActionRowBuilder().addComponents(idInput),
        new ActionRowBuilder().addComponents(nameInput)
    );

    await interaction.showModal(modal);
}

export async function handleAddServerModal(interaction) {
    const serverId = interaction.fields.getTextInputValue('setup-server-id').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
    const serverName = interaction.fields.getTextInputValue('setup-server-name').trim();

    if (!serverId) {
        return await interaction.reply({ content: '❌ Invalid server ID.', flags: 64 }).catch(() => {});
    }

    const result = serverConfig.addServer(serverId, serverName);

    await interaction.reply({ content: result.message, flags: 64 }).catch(() => {});

    if (result.success) {
        // Return to main menu
        const embed = buildMainMenuEmbed();
        const components = buildMainMenuButtons();
        await interaction.followUp({ embeds: [embed], components, flags: 64 }).catch(() => {});
    }
}

// ==========================================
// 🗑️ REMOVE SERVER
// ==========================================

async function handleRemoveServerMenu(interaction) {
    const servers = serverConfig.getServerList();
    if (servers.length === 0) {
        return await interaction.reply({ content: '📭 No servers to remove.', flags: 64 }).catch(() => {});
    }

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('setup-menu-remove')
        .setPlaceholder('Select a server to remove...')
        .addOptions(
            servers.map(srv =>
                new StringSelectMenuOptionBuilder()
                    .setLabel(srv.name)
                    .setDescription(`Remove ${srv.name}`)
                    .setValue(srv.id)
            )
        );

    const row = new ActionRowBuilder().addComponents(selectMenu);

    // Override: the select menu handler needs a different customId for the selection
    // Actually let me use a unique customId for the select menu
    const menuWithConfirm = new StringSelectMenuBuilder()
        .setCustomId('setup-menu-remove-select')
        .setPlaceholder('Select a server to remove...')
        .addOptions(
            servers.map(srv =>
                new StringSelectMenuOptionBuilder()
                    .setLabel(srv.name)
                    .setDescription(`⚠️ This will remove ${srv.name}`)
                    .setValue(srv.id)
            )
        );

    const newRow = new ActionRowBuilder().addComponents(menuWithConfirm);

    return await interaction.reply({
        content: '⚠️ **Select a server to remove:**',
        components: [newRow],
        flags: 64
    }).catch(() => {});
}

export async function handleRemoveServerSelect(interaction) {
    const serverId = interaction.values[0];
    const server = serverConfig.getServer(serverId);
    if (!server) {
        return await interaction.update({
            content: '❌ Server not found.',
            components: [],
            flags: 64
        }).catch(() => {});
    }

    const confirmRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`setup-remove-confirm-${serverId}`)
            .setLabel('✅ Yes, remove')
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId('setup-back')
            .setLabel('❌ Cancel')
            .setStyle(ButtonStyle.Secondary)
    );

    return await interaction.update({
        content: `⚠️ **Are you sure you want to remove \`${server.name}\`?**\nThis will delete its configuration but NOT its data files.`,
        components: [confirmRow],
        flags: 64
    }).catch(() => {});
}

async function handleRemoveServerConfirm(interaction, serverId) {
    const result = serverConfig.removeServer(serverId);

    await interaction.update({
        content: result.message,
        components: [],
        flags: 64
    }).catch(() => {});

    // Show updated main menu
    const embed = buildMainMenuEmbed();
    const components = buildMainMenuButtons();
    await interaction.followUp({ embeds: [embed], components, flags: 64 }).catch(() => {});
}

// ==========================================
// ⚙️ SERVER CONFIGURATION MENU
// ==========================================

async function showServerConfig(interaction, serverId) {
    const server = serverConfig.getServer(serverId);
    if (!server) {
        return await interaction.reply({ content: '❌ Server not found.', flags: 64 }).catch(() => {});
    }

    const embed = buildServerConfigEmbed(server);
    const components = buildServerConfigButtons(serverId);

    if (interaction.isButton() || interaction.isStringSelectMenu()) {
        return await interaction.update({ embeds: [embed], components }).catch(() => {});
    }
    return await interaction.reply({ embeds: [embed], components, flags: 64 }).catch(() => {});
}

function buildServerConfigEmbed(server) {
    const catCount = Object.values(server.categories).filter(v => v).length;
    const totalCats = Object.keys(server.categories).length;
    const chanCount = Object.values(server.channels).filter(v => v).length;
    const totalChans = Object.keys(server.channels).length;
    const roleCount = Object.keys(server.clanRoles).length;

    let desc = `### ⚙️ ${server.name} (\`${server.id}\`)\n\n`;

    desc += `**🔗 Ranking URL:** ${server.rankingUrl ? `\`${server.rankingUrl}\`` : '❌ Not set'}\n`;
    desc += `**🏷️ Staff Role:** ${server.staffRoleId ? `<@&${server.staffRoleId}>` : '❌ Not set'}\n`;
    desc += `**👑 Clan Roles:** ${roleCount} role(s)\n`;
    desc += `**📁 Categories:** ${catCount}/${totalCats} configured\n`;
    desc += `**📺 Channels:** ${chanCount}/${totalChans} configured\n`;
    desc += `**🎯 Power Role:** ${server.clanPowerRole ? `<@&${server.clanPowerRole}>` : '❌ Not set'}\n`;
    desc += `**⚡ Power Threshold:** ${server.clanPowerThreshold?.toLocaleString() || '400,000'}\n`;

    return new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle(`⚙️ ${server.name}`)
        .setDescription(desc)
        .setTimestamp();
}

function buildServerConfigButtons(serverId) {
    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`setup-config-${serverId}`)
        .setPlaceholder('Select what to configure...')
        .addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel('🔗 Ranking URL')
                .setDescription('Set the MIR4 ranking URL for this server')
                .setValue('rankurl')
                .setEmoji('🔗'),
            new StringSelectMenuOptionBuilder()
                .setLabel('🏷️ Staff Role')
                .setDescription('Set the staff/admin role for this server')
                .setValue('staffrole')
                .setEmoji('🏷️'),
            new StringSelectMenuOptionBuilder()
                .setLabel('📁 Categories')
                .setDescription('Configure Discord categories for claim panels')
                .setValue('categories')
                .setEmoji('📁'),
            new StringSelectMenuOptionBuilder()
                .setLabel('📺 Channels')
                .setDescription('Configure channels (salary, logs, etc.)')
                .setValue('channels')
                .setEmoji('📺'),
            new StringSelectMenuOptionBuilder()
                .setLabel('👑 Clan Roles')
                .setDescription('Add/remove clan roles for role sync')
                .setValue('clanroles')
                .setEmoji('👑'),
            new StringSelectMenuOptionBuilder()
                .setLabel('✏️ Rename')
                .setDescription('Change display name')
                .setValue('rename')
                .setEmoji('✏️')
        );

    const backRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('setup-back')
            .setLabel('🔙 Back to Main Menu')
            .setStyle(ButtonStyle.Secondary)
    );

    return [new ActionRowBuilder().addComponents(selectMenu), backRow];
}

// ==========================================
// 🔗 RANKING URL
// ==========================================

async function handleSetRankUrl(interaction, serverId) {
    const modal = new ModalBuilder()
        .setCustomId(`setup-modal-rankurl-${serverId}`)
        .setTitle('🔗 Ranking URL');

    const urlInput = new TextInputBuilder()
        .setCustomId('setup-rankurl-value')
        .setLabel('MIR4 Official Ranking URL')
        .setPlaceholder('https://example.com/ranking?server=eu013')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(urlInput));
    await interaction.showModal(modal);
}

export async function handleRankUrlModal(interaction) {
    const serverId = interaction.customId.replace('setup-modal-rankurl-', '');
    const url = interaction.fields.getTextInputValue('setup-rankurl-value').trim();

    const result = serverConfig.setServerConfig(serverId, 'rankingUrl', url);

    await interaction.reply({ content: result.message, flags: 64 }).catch(() => {});

    // Return to server config
    await showServerConfig(interaction, serverId);
}

// ==========================================
// 🏷️ STAFF ROLE
// ==========================================

async function handleSetStaffRole(interaction, serverId) {
    const modal = new ModalBuilder()
        .setCustomId(`setup-modal-staffrole-${serverId}`)
        .setTitle('🏷️ Staff Role ID');

    const roleInput = new TextInputBuilder()
        .setCustomId('setup-staffrole-value')
        .setLabel('Discord Role ID for staff')
        .setPlaceholder('Paste the role ID (e.g., 123456789)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(roleInput));
    await interaction.showModal(modal);
}

export async function handleStaffRoleModal(interaction) {
    const serverId = interaction.customId.replace('setup-modal-staffrole-', '');
    const roleId = interaction.fields.getTextInputValue('setup-staffrole-value').trim();

    const result = serverConfig.setServerConfig(serverId, 'staffRoleId', roleId);

    await interaction.reply({ content: result.message, flags: 64 }).catch(() => {});
    await showServerConfig(interaction, serverId);
}

// ==========================================
// ✏️ RENAME SERVER
// ==========================================

async function handleRenameServer(interaction, serverId) {
    const modal = new ModalBuilder()
        .setCustomId(`setup-modal-rename-${serverId}`)
        .setTitle('✏️ Rename Server');

    const nameInput = new TextInputBuilder()
        .setCustomId('setup-rename-value')
        .setLabel('New display name')
        .setPlaceholder('e.g., EU013')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(nameInput));
    await interaction.showModal(modal);
}

export async function handleRenameModal(interaction) {
    const serverId = interaction.customId.replace('setup-modal-rename-', '');
    const name = interaction.fields.getTextInputValue('setup-rename-value').trim();

    const result = serverConfig.setServerConfig(serverId, 'name', name);
    await interaction.reply({ content: result.message, flags: 64 }).catch(() => {});
    await showServerConfig(interaction, serverId);
}

// ==========================================
// 📁 CATEGORIES
// ==========================================

async function showCategoryConfig(interaction, serverId) {
    const server = serverConfig.getServer(serverId);
    if (!server) return;

    const embed = new EmbedBuilder()
        .setColor(0xFEE75C)
        .setTitle(`📁 Categories — ${server.name}`)
        .setDescription('Select a category to configure:\n\n' +
            Object.entries(server.categories).map(([key, val]) => {
                const status = val ? `<#${val}>` : '❌ Not set';
                return `**${key}**: ${status}`;
            }).join('\n')
        )
        .setTimestamp();

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`setup-category-${serverId}`)
        .setPlaceholder('Select a category...')
        .addOptions(
            Object.keys(server.categories).map(key =>
                new StringSelectMenuOptionBuilder()
                    .setLabel(key)
                    .setDescription(server.categories[key] ? `ID: ${server.categories[key]}` : 'Not configured')
                    .setValue(key)
            )
        );

    const backRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('setup-category-back-' + serverId)
            .setLabel('🔙 Back to Server Config')
            .setStyle(ButtonStyle.Secondary)
    );

    return await interaction.update({
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(selectMenu), backRow]
    }).catch(() => {});
}

async function handleSetCategory(interaction, serverId) {
    const categoryKey = interaction.values[0];

    const modal = new ModalBuilder()
        .setCustomId(`setup-modal-category-${serverId}-${categoryKey}`)
        .setTitle(`📁 ${categoryKey} Category ID`);

    const catInput = new TextInputBuilder()
        .setCustomId('setup-category-value')
        .setLabel(`Discord Category ID for ${categoryKey}`)
        .setPlaceholder('Paste the category ID')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(catInput));
    await interaction.showModal(modal);
}

export async function handleCategoryModal(interaction) {
    const cid = interaction.customId;
    // Extract categoryKey from the end: setup-modal-category-{serverId}-{categoryKey}
    // Use lastIndexOf to find the last dash for the categoryKey
    const prefix = 'setup-modal-category-';
    const after = cid.slice(prefix.length);
    const lastDash = after.lastIndexOf('-');
    const serverId = after.slice(0, lastDash);
    const categoryKey = after.slice(lastDash + 1);

    const value = interaction.fields.getTextInputValue('setup-category-value').trim();

    const result = serverConfig.setServerConfig(serverId, `categories.${categoryKey}`, value);

    await interaction.reply({ content: result.message, flags: 64 }).catch(() => {});
    await showCategoryConfig(interaction, serverId);
}

// ==========================================
// 📺 CHANNELS
// ==========================================

async function showChannelConfig(interaction, serverId) {
    const server = serverConfig.getServer(serverId);
    if (!server) return;

    const channelLabels = {
        salaryPoll: '📊 Salary Poll',
        logs: '📜 Daily Logs',
        bossSpawn: '🎯 Boss Spawn',
        event: '🚨 Event Alerts',
        ticketCategory: '🎫 Ticket Category',
        tempVoiceSource: '🔉 Temp Voice Source'
    };

    const embed = new EmbedBuilder()
        .setColor(0xFEE75C)
        .setTitle(`📺 Channels — ${server.name}`)
        .setDescription('Select a channel to configure:\n\n' +
            Object.entries(server.channels).map(([key, val]) => {
                const label = channelLabels[key] || key;
                const status = val ? `<#${val}>` : '❌ Not set';
                return `**${label}**: ${status}`;
            }).join('\n')
        )
        .setTimestamp();

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`setup-channel-${serverId}`)
        .setPlaceholder('Select a channel...')
        .addOptions(
            Object.keys(server.channels).map(key =>
                new StringSelectMenuOptionBuilder()
                    .setLabel(channelLabels[key] || key)
                    .setDescription(server.channels[key] ? `ID: ${server.channels[key]}` : 'Not configured')
                    .setValue(key)
            )
        );

    const backRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('setup-channel-back-' + serverId)
            .setLabel('🔙 Back to Server Config')
            .setStyle(ButtonStyle.Secondary)
    );

    return await interaction.update({
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(selectMenu), backRow]
    }).catch(() => {});
}

async function handleSetChannel(interaction, serverId) {
    const channelKey = interaction.values[0];

    const modal = new ModalBuilder()
        .setCustomId(`setup-modal-channel-${serverId}-${channelKey}`)
        .setTitle(`📺 Channel ID`);

    const chInput = new TextInputBuilder()
        .setCustomId('setup-channel-value')
        .setLabel(`Discord Channel/Category ID`)
        .setPlaceholder('Paste the channel/category ID')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(chInput));
    await interaction.showModal(modal);
}

export async function handleChannelModal(interaction) {
    const cid = interaction.customId;
    const prefix = 'setup-modal-channel-';
    const after = cid.slice(prefix.length);
    const lastDash = after.lastIndexOf('-');
    const serverId = after.slice(0, lastDash);
    const channelKey = after.slice(lastDash + 1);

    const value = interaction.fields.getTextInputValue('setup-channel-value').trim();

    const result = serverConfig.setServerConfig(serverId, `channels.${channelKey}`, value);

    await interaction.reply({ content: result.message, flags: 64 }).catch(() => {});
    await showChannelConfig(interaction, serverId);
}

// ==========================================
// 📋 MODAL HANDLER
// ==========================================

export function canHandleSetupModal(interaction) {
    if (!interaction.isModalSubmit()) return false;
    const cid = interaction.customId;
    return cid.startsWith('setup-modal-');
}

/**
 * Dispatches setup modals to the correct handler
 */
export async function handleSetupModal(interaction) {
    const cid = interaction.customId;

    if (cid === 'setup-modal-add-server') {
        return await handleAddServerModal(interaction);
    }
    if (cid.startsWith('setup-modal-rankurl-')) {
        return await handleRankUrlModal(interaction);
    }
    if (cid.startsWith('setup-modal-staffrole-')) {
        return await handleStaffRoleModal(interaction);
    }
    if (cid.startsWith('setup-modal-rename-')) {
        return await handleRenameModal(interaction);
    }
    if (cid.startsWith('setup-modal-category-')) {
        return await handleCategoryModal(interaction);
    }
    if (cid.startsWith('setup-modal-channel-')) {
        return await handleChannelModal(interaction);
    }
    if (cid.startsWith('setup-modal-role-add-')) {
        return await handleAddClanRoleModal(interaction);
    }

    return false;
}

// ==========================================
// 👑 CLAN ROLES
// ==========================================

async function showClanRolesConfig(interaction, serverId) {
    const server = serverConfig.getServer(serverId);
    if (!server) return;

    const roles = Object.entries(server.clanRoles);
    let desc = roles.length > 0
        ? roles.map(([clan, roleId]) => `**${clan}**: <@&${roleId}>`).join('\n')
        : '*No clan roles configured yet.*';

    const embed = new EmbedBuilder()
        .setColor(0xFEE75C)
        .setTitle(`👑 Clan Roles — ${server.name}`)
        .setDescription(desc)
        .setTimestamp();

    const menuOptions = [
        new StringSelectMenuOptionBuilder()
            .setLabel('➕ Add Clan Role')
            .setDescription('Add a new clan-to-role mapping')
            .setValue('add')
            .setEmoji('➕')
    ];

    if (roles.length > 0) {
        menuOptions.push(
            new StringSelectMenuOptionBuilder()
                .setLabel('🗑️ Remove Clan Role')
                .setDescription('Remove an existing clan role')
                .setValue('remove')
                .setEmoji('🗑️')
        );
    }

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`setup-role-select-${serverId}`)
        .setPlaceholder('Manage clan roles...')
        .addOptions(menuOptions);

    const backRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('setup-role-back-' + serverId)
            .setLabel('🔙 Back to Server Config')
            .setStyle(ButtonStyle.Secondary)
    );

    return await interaction.update({
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(selectMenu), backRow]
    }).catch(() => {});
}

async function handleAddClanRole(interaction, serverId) {
    const modal = new ModalBuilder()
        .setCustomId(`setup-modal-role-add-${serverId}`)
        .setTitle('👑 Add Clan Role');

    const clanInput = new TextInputBuilder()
        .setCustomId('setup-role-clan')
        .setLabel('Clan Name (e.g., 浪人・AEON・)')
        .setPlaceholder('Exact clan name from MIR4 ranking')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

    const roleInput = new TextInputBuilder()
        .setCustomId('setup-role-id')
        .setLabel('Discord Role ID')
        .setPlaceholder('Paste the role ID')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

    modal.addComponents(
        new ActionRowBuilder().addComponents(clanInput),
        new ActionRowBuilder().addComponents(roleInput)
    );
    await interaction.showModal(modal);
}

export async function handleAddClanRoleModal(interaction) {
    const serverId = interaction.customId.replace('setup-modal-role-add-', '');
    const clanName = interaction.fields.getTextInputValue('setup-role-clan').trim();
    const roleId = interaction.fields.getTextInputValue('setup-role-id').trim();

    const result = serverConfig.setServerConfig(serverId, `clanRoles.${clanName}`, roleId);
    await interaction.reply({ content: result.message, flags: 64 }).catch(() => {});
    await showClanRolesConfig(interaction, serverId);
}

async function handleRemoveClanRole(interaction, serverId) {
    const server = serverConfig.getServer(serverId);
    if (!server) return;

    const roles = Object.entries(server.clanRoles);
    if (roles.length === 0) {
        return await interaction.reply({ content: '📭 No clan roles to remove.', flags: 64 }).catch(() => {});
    }

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`setup-role-remove-select-${serverId}`)
        .setPlaceholder('Select a clan role to remove...')
        .addOptions(
            roles.map(([clan, roleId]) =>
                new StringSelectMenuOptionBuilder()
                    .setLabel(clan.substring(0, 100))
                    .setDescription(`Role ID: ${roleId}`)
                    .setValue(clan)
            )
        );

    return await interaction.reply({
        content: '🗑️ **Select a clan role to remove:**',
        components: [new ActionRowBuilder().addComponents(selectMenu)],
        flags: 64
    }).catch(() => {});
}

export async function handleRemoveClanRoleSelect(interaction, serverId) {
    const clanName = interaction.values[0];

    const config = serverConfig.getConfig();
    if (config.servers[serverId]?.clanRoles) {
        delete config.servers[serverId].clanRoles[clanName];
        serverConfig.saveServerConfig();
    }

    await interaction.update({
        content: `✅ Removed clan role **${clanName}** from ${serverId}.`,
        components: [],
        flags: 64
    }).catch(() => {});
    await showClanRolesConfig(interaction, serverId);
}
