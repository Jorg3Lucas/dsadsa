// ==========================================
// 🏗️ SETUP HANDLER — One-command server configuration
// Creates roles, categories, channels, and welcome/approval/ticket panels
// per MIR4 world/server, all within a single Discord guild.
// ==========================================

import {
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder
} from 'discord.js';
import { WORLD_IDS, WELCOME_PANEL_MESSAGE, ensureConfig, setAdminChannelId } from '../core/ranking-constants.js';
import { setupTicketPanel } from './ticket-system.js';
import { syncTicketConfig } from './ticket-core.js';

// ── World name lookup (reverse of WORLD_IDS) ──
const WORLD_BY_NAME = {};
for (const [id, name] of Object.entries(WORLD_IDS)) {
    WORLD_BY_NAME[name] = parseInt(id, 10);
}

// ── Channel naming helpers ──
function worldRoleName(world) { return `${world} Member`; }
function worldElderRoleName(world) { return `${world} Elder`; }
function worldCategoryName(world) { return `🌍 ${world}`; }
function worldClaimsCatName(world) { return `📁 ${world} Claims`; }
function worldLogsCatName(world) { return `📁 ${world} Logs`; }
function worldChatName(world) { return `💬・chat-${world.toLowerCase()}`; }



// ══════════════════════════════════════════
// 1. INTERACTIVE SETUP FLOW
// ══════════════════════════════════════════

/**
 * Entry point: admin runs /setup.
 * Shows a multi-select menu of available worlds.
 */
export async function handleSetupStart(interaction, db, saveLocalStorage, logEvent) {
    const worldOptions = Object.values(WORLD_IDS).map(w => {
        const alreadyDone = !!(db.config?.worldSetup?.[w]);
        return new StringSelectMenuOptionBuilder()
            .setLabel(`${alreadyDone ? '✅ ' : ''}${w}`)
            .setDescription(alreadyDone ? 'Already set up — will re-create' : 'Not yet configured')
            .setValue(w)
            .setDefault(alreadyDone);
    });

    // Paginate if too many options (Discord limit: 25 per menu)
    const MAX_OPTIONS = 25;
    const pages = [];
    for (let i = 0; i < worldOptions.length; i += MAX_OPTIONS) {
        pages.push(worldOptions.slice(i, i + MAX_OPTIONS));
    }

    // Store pagination state
    if (!db.config) db.config = {};
    if (!db.config._setupState) db.config._setupState = {};
    db.config._setupState.page = 0;
    db.config._setupState.pages = pages;
    db.config._setupState.selected = [];
    saveLocalStorage();

    return await sendSetupPage(interaction, db, saveLocalStorage, logEvent);
}

async function sendSetupPage(interaction, db, saveLocalStorage, logEvent, edit = false) {
    const state = db.config._setupState;
    const page = state.pages[state.page];
    if (!page) return;

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('setup_select_worlds')
        .setPlaceholder(`Select worlds to set up (page ${state.page + 1}/${state.pages.length})`)
        .setMinValues(0)
        .setMaxValues(page.length)
        .addOptions(page);

    const components = [new ActionRowBuilder().addComponents(selectMenu)];

    const navButtons = [];
    if (state.pages.length > 1) {
        if (state.page > 0) {
            navButtons.push(
                new ButtonBuilder().setCustomId('setup_prev_page').setLabel('◀️ Prev').setStyle(ButtonStyle.Secondary)
            );
        }
        if (state.page < state.pages.length - 1) {
            navButtons.push(
                new ButtonBuilder().setCustomId('setup_next_page').setLabel('Next ▶️').setStyle(ButtonStyle.Primary)
            );
        }
    }
    if (navButtons.length > 0) {
        components.push(new ActionRowBuilder().addComponents(navButtons));
    }

    // Confirm & cancel buttons
    components.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('setup_confirm').setLabel('✅ Start Setup').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('setup_cancel').setLabel('❌ Cancel').setStyle(ButtonStyle.Secondary)
    ));

    const selectedCount = state.selected.length;
    const embed = new EmbedBuilder()
        .setTitle('🏗️ Server Setup Wizard')
        .setColor(0x2b2d31)
        .setDescription(
            'Select which MIR4 worlds to configure. For each world, the bot will:\n\n' +
            '• Create **roles**: `{World} Member`, `{World} Elder`\n' +
            '• **🌍 {World}** — welcome, approvals, tickets, announcements, rules, world-boss, salary, chat\n' +
            '• **📁 {World} Claims** — read-only claim info (SP, MS, events)\n' +
            '• **📁 {World} Logs** — activity channels: world-boss, heist, valley-war, altar, MS/SP, PVP\n' +
            '• **🌐 Alliance General** — market, tower-rules, announcements, allied-list, main-chat, reminders, events\n\n' +
            `📌 Worlds selected: **${selectedCount}**`
        )
        .setFooter({ text: `Page ${state.page + 1}/${state.pages.length}` })
        .setTimestamp();

    if (edit) {
        await interaction.update({ embeds: [embed], components }).catch(() => {});
    } else {
        await interaction.reply({ embeds: [embed], components, flags: 64 });
    }
}

// ── Handle select menu ──
export async function handleSetupSelectWorlds(interaction, db, saveLocalStorage, logEvent) {
    const state = db.config._setupState;
    if (!state) {
        return await interaction.reply({ content: '⌛ Setup session expired. Please run /setup again.', flags: 64 }).catch(() => {});
    }

    // Preserve selections across pages
    const pageValues = state.pages[state.page].map(o => o.data.value);
    const prevSelections = state.selected.filter(s => !pageValues.includes(s));
    state.selected = [...prevSelections, ...interaction.values];
    saveLocalStorage();
    await interaction.deferUpdate();
    return await sendSetupPage(interaction, db, saveLocalStorage, logEvent, true);
}

// ── Handle navigation ──
export async function handleSetupNav(interaction, db, saveLocalStorage, logEvent, direction) {
    const state = db.config._setupState;
    if (!state) return;
    if (direction === 'prev' && state.page > 0) state.page--;
    if (direction === 'next' && state.page < state.pages.length - 1) state.page++;
    saveLocalStorage();
    await interaction.deferUpdate();
    return await sendSetupPage(interaction, db, saveLocalStorage, logEvent, true);
}

// ── Handle cancel ──
export async function handleSetupCancel(interaction, db, saveLocalStorage, logEvent) {
    delete db.config._setupState;
    saveLocalStorage();
    return await interaction.update({
        content: '❌ **Setup cancelled.** No changes were made.',
        embeds: [],
        components: [],
        flags: 64
    }).catch(() => {});
}

// ══════════════════════════════════════════
// 2. EXECUTE SETUP
// ══════════════════════════════════════════

export async function handleSetupConfirm(interaction, db, saveLocalStorage, logEvent) {
    const state = db.config._setupState;
    if (!state || state.selected.length === 0) {
        return await interaction.update({
            content: '❌ No worlds selected. Please select at least one world.',
            embeds: [],
            components: [],
            flags: 64
        }).catch(() => {});
    }

    await interaction.update({
        content: '🏗️ **Setting up...** This may take a moment.',
        embeds: [],
        components: [],
        flags: 64
    }).catch(() => {});

    const guild = interaction.guild;
    const worldsToSetup = state.selected;
    const results = { success: [], errors: [] };
    const now = Date.now();

    ensureConfig(db);
    if (!db.config.worldSetup) db.config.worldSetup = {};

    for (const world of worldsToSetup) {
        try {
            const result = await setupWorld(guild, world, db);
            db.config.worldSetup[world] = {
                roleMemberId: result.roleMemberId,
                roleElderId: result.roleElderId,
                categoryId: result.categoryId,
                claimsCategoryId: result.claimsCategoryId,
                logsCategoryId: result.logsCategoryId,
                welcomeChannelId: result.welcomeChannelId,
                approvalsChannelId: result.approvalsChannelId,
                ticketChannelId: result.ticketChannelId,
                chatChannelId: result.chatChannelId,
                elderPostIds: result.elderPostIds,
                claimChannelIds: result.claimChannelIds,
                logChannelIds: result.logChannelIds,
                elders: [],
                setupAt: new Date().toISOString()
            };
            results.success.push(world);
            logEvent(`✅ [Setup] World ${world} configured successfully.`);
        } catch (err) {
            results.errors.push(`${world}: ${err.message}`);
            logEvent(`❌ [Setup] World ${world} failed: ${err.message}`);
        }
        // Delay between worlds to avoid Discord rate limits
        await new Promise(r => setTimeout(r, 1500));
    }

    // ── Create server-wide channels (once) ──
    try {
        await setupGeneralChannels(guild, db);
    } catch (err) {
        results.errors.push(`General channels: ${err.message}`);
    }

    // Sync ticket config with new world setup
    syncTicketConfig(db);

    // Cleanup state
    delete db.config._setupState;
    saveLocalStorage();

    // Build report
    const embed = new EmbedBuilder()
        .setTitle('🏗️ Setup Complete!')
        .setColor(results.errors.length === 0 ? 0x57f287 : 0xffee88)
        .setDescription(
            `✅ **${results.success.length}/${worldsToSetup.length} worlds configured**\n\n` +
            results.success.map(w => `✅ ${w}`).join('\n') +
            (results.errors.length > 0 ? `\n\n⚠️ **Errors:**\n${results.errors.map(e => `❌ ${e}`).join('\n')}` : '')
        )
        .setTimestamp();

    // Send report as new message (interaction already updated)
    await interaction.followUp({ embeds: [embed], flags: 64 }).catch(() => {});
}

// ══════════════════════════════════════════
// 3. SETUP A SINGLE WORLD
// ══════════════════════════════════════════

async function setupWorld(guild, world, db) {
    // ── Create roles ──
    const memberRole = await guild.roles.create({
        name: worldRoleName(world),
        color: 0x2b2d31,
        reason: `[Setup] ${world} member role`
    });
    const elderRole = await guild.roles.create({
        name: worldElderRoleName(world),
        color: 0xffaa00,
        reason: `[Setup] ${world} elder role`
    });

    // ═════════════════════════════════════
    // CATEGORY 1: MAIN WORLD CHANNELS
    // ═════════════════════════════════════
    const mainCat = await guild.channels.create({
        name: worldCategoryName(world),
        type: 4,
        reason: `[Setup] ${world} main`
    });
    // Category default: deny everyone, member can view+send, elder can view+send+manage
    await mainCat.permissionOverwrites.create(guild.roles.everyone, { ViewChannel: false }).catch(() => {});
    await mainCat.permissionOverwrites.create(memberRole.id, {
        ViewChannel: true, ReadMessageHistory: true, SendMessages: true, AttachFiles: true
    }).catch(() => {});
    await mainCat.permissionOverwrites.create(elderRole.id, {
        ViewChannel: true, ReadMessageHistory: true, SendMessages: true, AttachFiles: true, ManageMessages: true
    }).catch(() => {});

    // ── Welcome channel (everyone can view after getting member role) ──
    const welcomeChannel = await guild.channels.create({
        name: '👋・welcome', type: 0, parent: mainCat.id,
        reason: `[Setup] ${world} welcome`
    });
    await welcomeChannel.send({
        embeds: [{
            color: 0x57f287,
            title: `🌍 Welcome to ${world}!`,
            description: 'Register your MIR4 account below to get access to the server channels.\n\n' +
                'Click **👑 Register as Owner** if this is your main character.\n' +
                'Click **✈️ Register as Pilot** if you play for someone else.',
            footer: { text: world },
            timestamp: new Date().toISOString()
        }]
    });
    const regRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('welcome_register_owner').setLabel('👑 Register as Owner').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('welcome_register_pilot').setLabel('✈️ Register as Pilot').setStyle(ButtonStyle.Secondary)
    );
    await welcomeChannel.send({ content: WELCOME_PANEL_MESSAGE, components: [regRow] });

    // ── Approvals channel (elder view only) ──
    const approvalsChannel = await guild.channels.create({
        name: '📋・approvals', type: 0, parent: mainCat.id,
        reason: `[Setup] ${world} approvals`
    });
    await approvalsChannel.permissionOverwrites.create(memberRole.id, { ViewChannel: false }).catch(() => {});
    if (!db.config.adminChannelId) {
        db.config.adminChannelId = approvalsChannel.id;
        setAdminChannelId(approvalsChannel.id);
    }

    // ── Tickets channel ──
    const ticketChannel = await guild.channels.create({
        name: '🎫・tickets', type: 0, parent: mainCat.id,
        reason: `[Setup] ${world} tickets`
    });
    await setupTicketPanel(ticketChannel);

    // ── Elder-only post channels (members read only) ──
    const elderPostChannels = [
        { name: '📢・announcements', emoji: '📢' },
        { name: '👹・world-boss-list', emoji: '👹' },
        { name: '📜・rules', emoji: '📜' },
        { name: '💰・salary-list', emoji: '💰' }
    ];
    const elderPostIds = {};
    for (const ch of elderPostChannels) {
        const channel = await guild.channels.create({
            name: ch.name, type: 0, parent: mainCat.id,
            reason: `[Setup] ${world} ${ch.name}`
        });
        // Remove send permission from members
        await channel.permissionOverwrites.create(memberRole.id, {
            ViewChannel: true, ReadMessageHistory: true, SendMessages: false
        }).catch(() => {});
        elderPostIds[ch.name] = channel.id;
    }

    // ── Per-world chat (all members can talk) ──
    const chatChannel = await guild.channels.create({
        name: worldChatName(world), type: 0, parent: mainCat.id,
        reason: `[Setup] ${world} chat`
    });

    // ═════════════════════════════════════
    // CATEGORY 2: CLAIMS (read-only for all)
    // ═════════════════════════════════════
    const claimsCat = await guild.channels.create({
        name: worldClaimsCatName(world),
        type: 4,
        reason: `[Setup] ${world} claims`
    });
    // Deny everyone, allow member+elder to VIEW only (no send)
    await claimsCat.permissionOverwrites.create(guild.roles.everyone, { ViewChannel: false }).catch(() => {});
    await claimsCat.permissionOverwrites.create(memberRole.id, {
        ViewChannel: true, ReadMessageHistory: true, SendMessages: false
    }).catch(() => {});
    await claimsCat.permissionOverwrites.create(elderRole.id, {
        ViewChannel: true, ReadMessageHistory: true, SendMessages: false
    }).catch(() => {});

    const claimChannels = ['⚔️・claim-sp', '⚔️・claim-ms', '🎪・events'];
    const claimChannelIds = {};
    for (const name of claimChannels) {
        const ch = await guild.channels.create({
            name, type: 0, parent: claimsCat.id,
            reason: `[Setup] ${world} ${name}`
        });
        // Explicitly deny send for both member and elder
        await ch.permissionOverwrites.create(memberRole.id, {
            ViewChannel: true, ReadMessageHistory: true, SendMessages: false
        }).catch(() => {});
        await ch.permissionOverwrites.create(elderRole.id, {
            ViewChannel: true, ReadMessageHistory: true, SendMessages: false
        }).catch(() => {});
        claimChannelIds[name] = ch.id;
    }

    // ═════════════════════════════════════
    // CATEGORY 3: ACTIVITY LOGS (all can post)
    // ═════════════════════════════════════
    const logsCat = await guild.channels.create({
        name: worldLogsCatName(world),
        type: 4,
        reason: `[Setup] ${world} logs`
    });
    await logsCat.permissionOverwrites.create(guild.roles.everyone, { ViewChannel: false }).catch(() => {});
    await logsCat.permissionOverwrites.create(memberRole.id, {
        ViewChannel: true, ReadMessageHistory: true, SendMessages: true, AttachFiles: true
    }).catch(() => {});
    await logsCat.permissionOverwrites.create(elderRole.id, {
        ViewChannel: true, ReadMessageHistory: true, SendMessages: true, AttachFiles: true, ManageMessages: true
    }).catch(() => {});

    const logChannels = ['🐉・world-boss', '💎・heist', '⚔️・valley-war', '🛡️・altar-defense', '🏰・ms-and-sp', '🤺・pvp'];
    const logChannelIds = {};
    for (const name of logChannels) {
        const ch = await guild.channels.create({
            name, type: 0, parent: logsCat.id,
            reason: `[Setup] ${world} ${name}`
        });
        logChannelIds[name] = ch.id;
    }

    return {
        roleMemberId: memberRole.id,
        roleElderId: elderRole.id,
        categoryId: mainCat.id,
        claimsCategoryId: claimsCat.id,
        logsCategoryId: logsCat.id,
        welcomeChannelId: welcomeChannel.id,
        approvalsChannelId: approvalsChannel.id,
        ticketChannelId: ticketChannel.id,
        chatChannelId: chatChannel.id,
        elderPostIds,
        claimChannelIds,
        logChannelIds
    };
}

// ══════════════════════════════════════════
// 4. SERVER-WIDE CHANNELS
// ══════════════════════════════════════════

async function setupGeneralChannels(guild, db) {
    if (db.config._generalChannelsDone) return;

    // ── Alliance General category ──
    const generalCat = await guild.channels.create({
        name: '🌐 Alliance General',
        type: 4,
        reason: '[Setup] Alliance General'
    });
    // Restrict to @everyone deny by default
    await generalCat.permissionOverwrites.create(guild.roles.everyone, { ViewChannel: false }).catch(() => {});
    // Grant view+send to each world's member role so members can see & interact in alliance channels
    // Elder-only channels (tower-rules, announcements, allied-list) will override SendMessages to false
    for (const [, wc] of Object.entries(db.config.worldSetup || {})) {
        const role = guild.roles.cache.get(wc.roleMemberId);
        if (role) {
            await generalCat.permissionOverwrites.create(role, {
                ViewChannel: true, ReadMessageHistory: true, SendMessages: true
            }).catch(() => {});
        }
    }

    // Market & Main chat — all members can write
    const marketChannel = await guild.channels.create({
        name: '🛒・market', type: 0, parent: generalCat.id,
        reason: '[Setup] Alliance market'
    });
    const mainChatChannel = await guild.channels.create({
        name: '💬・main-chat', type: 0, parent: generalCat.id,
        reason: '[Setup] Alliance main chat'
    });

    // Tower rules & Announcements & Allied list — all can view, only elders+admins write
    // We need to create these with proper permissions
    async function createElderPostChannel(name, emoji) {
        const ch = await guild.channels.create({
            name: `${emoji}・${name}`, type: 0, parent: generalCat.id,
            reason: `[Setup] Alliance ${name}`
        });
        // Members can't send; elders keep send permission
        for (const [, wc] of Object.entries(db.config.worldSetup || {})) {
            if (wc.roleMemberId) {
                await ch.permissionOverwrites.create(wc.roleMemberId, {
                    ViewChannel: true, ReadMessageHistory: true, SendMessages: false
                }).catch(() => {});
            }
            if (wc.roleElderId) {
                await ch.permissionOverwrites.create(wc.roleElderId, {
                    ViewChannel: true, ReadMessageHistory: true, SendMessages: true
                }).catch(() => {});
            }
        }
        return ch;
    }

    const towerRulesChannel = await createElderPostChannel('tower-rules', '🏛️');
    const announcementsChannel = await createElderPostChannel('announcements', '📢');
    const alliedListChannel = await createElderPostChannel('allied-list', '📋');

    // Create reminders + events channels under general category
    const remindersChannel = await guild.channels.create({
        name: '📢・reminders', type: 0, parent: generalCat.id,
        reason: '[Setup] General reminders'
    });
    const eventsChannel = await guild.channels.create({
        name: '📅・events', type: 0, parent: generalCat.id,
        reason: '[Setup] General events'
    });

    db.config._generalChannelsDone = true;
    db.config.generalChannels = {
        categoryId: generalCat.id,
        marketChannelId: marketChannel.id,
        mainChatChannelId: mainChatChannel.id,
        towerRulesChannelId: towerRulesChannel.id,
        announcementsChannelId: announcementsChannel.id,
        alliedListChannelId: alliedListChannel.id,
        remindersChannelId: remindersChannel.id,
        eventsChannelId: eventsChannel.id
    };
}

// ══════════════════════════════════════════
// 5. SET ELDER COMMAND
// ══════════════════════════════════════════

/**
 * /setelder <world> <member>
 * Assigns the elder role for a specific world to a Discord member.
 */
export async function handleSetElder(interaction, db, saveLocalStorage, logEvent) {
    const world = interaction.options.getString('world').toUpperCase();
    const targetMember = interaction.options.getMember('member');

    // Validate world
    const worldId = WORLD_BY_NAME[world];
    if (!worldId) {
        const validWorlds = Object.values(WORLD_IDS).join(', ');
        return interaction.reply({
            content: `❌ Invalid world **${world}**. Valid worlds: ${validWorlds}`,
            flags: 64
        });
    }

    // Check if world is set up
    if (!db.config?.worldSetup?.[world]) {
        return interaction.reply({
            content: `❌ World **${world}** is not configured yet. Run \`/setup\` first.`,
            flags: 64
        });
    }

    const worldConfig = db.config.worldSetup[world];
    const elderRole = interaction.guild.roles.cache.get(worldConfig.roleElderId);
    if (!elderRole) {
        return interaction.reply({
            content: `❌ Elder role for **${world}** not found. Run \`/setup\` to recreate.`,
            flags: 64
        });
    }

    // Check if already an elder
    if (targetMember.roles.cache.has(elderRole.id)) {
        return interaction.reply({
            content: `ℹ️ **${targetMember.displayName}** is already an elder for **${world}**.`,
            flags: 64
        });
    }

    try {
        await targetMember.roles.add(elderRole);
    } catch (err) {
        return interaction.reply({
            content: `❌ Failed to assign role: ${err.message}`,
            flags: 64
        });
    }

    // Also give member role if they don't have it
    const memberRole = interaction.guild.roles.cache.get(worldConfig.roleMemberId);
    if (memberRole && !targetMember.roles.cache.has(memberRole.id)) {
        await targetMember.roles.add(memberRole).catch(() => {});
    }

    // Store in config
    if (!worldConfig.elders.includes(targetMember.id)) {
        worldConfig.elders.push(targetMember.id);
    }
    saveLocalStorage();

    logEvent(`👑 ${interaction.user.tag} set ${targetMember.user.tag} as elder for ${world}`);
    return interaction.reply({
        content: `✅ **${targetMember.displayName}** is now an **${world} Elder**!`,
        flags: 64
    });
}

// ══════════════════════════════════════════
// 6. HELPERS for other systems
// ══════════════════════════════════════════

/**
 * Get the world name for a Discord member based on their roles.
 * Returns null if the member doesn't have any world role.
 */
export function getMemberWorld(member, db) {
    const worldSetup = db.config?.worldSetup;
    if (!worldSetup) return null;

    for (const [world, config] of Object.entries(worldSetup)) {
        if (member.roles.cache.has(config.roleMemberId) || member.roles.cache.has(config.roleElderId)) {
            return world;
        }
    }
    return null;
}

/**
 * Get all elder user IDs for a specific world.
 */
export function getWorldElderIds(world, db) {
    return db.config?.worldSetup?.[world]?.elders || [];
}

/**
 * Get the Discord member role ID for a world.
 */
export function getWorldMemberRoleId(world, db) {
    return db.config?.worldSetup?.[world]?.roleMemberId || null;
}
