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
    EmbedBuilder,
    PermissionFlagsBits
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
// HELPER: Find existing by name or create
// Prevents duplicate name errors on re-setup.
// ══════════════════════════════════════════

/** Find an existing guild role by name or create a new one. */
async function findOrCreateRole(guild, name, opts) {
    const existing = guild.roles.cache.find(r => r.name === name);
    if (existing) return existing;
    return await guild.roles.create({ name, ...opts });
}

/** Find an existing guild category by name or create a new one. */
async function findOrCreateCategory(guild, name, opts) {
    const existing = guild.channels.cache.find(c => c.name === name && c.type === 4);
    if (existing) return existing;
    return await guild.channels.create({ name, type: 4, ...opts });
}

/**
 * Find an existing text channel by name under a parent, or create a new one.
 * If a channel with the same name exists, it is deleted and re-created
 * to ensure clean state.
 */
async function findOrCreateTextChannel(guild, name, parentId, opts = {}) {
    const existing = guild.channels.cache.find(
        c => c.name === name && c.type === 0 && c.parentId === parentId
    );
    if (existing) {
        await existing.delete('Re-creating channel via /setup').catch(() => {});
    }
    return await guild.channels.create({ name, type: 0, parent: parentId, ...opts });
}



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
                floorChannels: result.floorChannels,
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
    // ── Create or reuse roles (prevents duplicate name errors) ──
    const memberRole = await findOrCreateRole(guild, worldRoleName(world), {
        color: 0x2b2d31,
        reason: `[Setup] ${world} member role`
    });
    const elderRole = await findOrCreateRole(guild, worldElderRoleName(world), {
        color: 0xffaa00,
        reason: `[Setup] ${world} elder role`
    });

    // ═════════════════════════════════════
    // CATEGORY 1: MAIN WORLD CHANNELS
    // ═════════════════════════════════════
    const mainCat = await findOrCreateCategory(guild, worldCategoryName(world), {
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

    // ── Welcome channel ──
    // Visible to EVERYONE (no role needed) — so newcomers can register.
    // Hidden from members once they get the {World} Member role.
    // Elders can still see and manage it.
    const welcomeChannel = await findOrCreateTextChannel(guild, '👋・welcome', mainCat.id, {
        reason: `[Setup] ${world} welcome`
    });

    // Override category permissions: @everyone can VIEW, members CANNOT view
    await welcomeChannel.permissionOverwrites.create(guild.roles.everyone, {
        ViewChannel: true, ReadMessageHistory: true, SendMessages: false
    }).catch(() => {});
    await welcomeChannel.permissionOverwrites.create(memberRole.id, {
        ViewChannel: false
    }).catch(() => {});
    await welcomeChannel.permissionOverwrites.create(elderRole.id, {
        ViewChannel: true, ReadMessageHistory: true, SendMessages: true, ManageMessages: true
    }).catch(() => {});

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
    const approvalsChannel = await findOrCreateTextChannel(guild, '📋・approvals', mainCat.id, {
        reason: `[Setup] ${world} approvals`
    });
    await approvalsChannel.permissionOverwrites.create(memberRole.id, { ViewChannel: false }).catch(() => {});
    if (!db.config.adminChannelId) {
        db.config.adminChannelId = approvalsChannel.id;
        setAdminChannelId(approvalsChannel.id);
    }

    // ── Tickets channel ──
    const ticketChannel = await findOrCreateTextChannel(guild, '🎫・tickets', mainCat.id, {
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
        const channel = await findOrCreateTextChannel(guild, ch.name, mainCat.id, {
            reason: `[Setup] ${world} ${ch.name}`
        });
        // Remove send permission from members
        await channel.permissionOverwrites.create(memberRole.id, {
            ViewChannel: true, ReadMessageHistory: true, SendMessages: false
        }).catch(() => {});
        elderPostIds[ch.name] = channel.id;
    }

    // ── Per-world chat (all members can talk) ──
    const chatChannel = await findOrCreateTextChannel(guild, worldChatName(world), mainCat.id, {
        reason: `[Setup] ${world} chat`
    });

    // ═════════════════════════════════════
    // CATEGORY 2: CLAIMS (read-only for all)
    // Creates floor claim channels directly under the Claims
    // category (Discord does NOT support nested categories).
    // Panel embeds are sent by auto-channel-setup on boot.
    // ═════════════════════════════════════
    const claimsCat = await findOrCreateCategory(guild, worldClaimsCatName(world), {
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

    // ── Floor channels (created directly under Claims category) ──
    // Channel names are prefixed with floor to group them visually.
    const floorChannelDefs = [
        { name: '🔸┃7F-sp7',    panels: ['7peak'] },
        { name: '🔹┃7F-ms7',    panels: ['7squarenormal', '7squareantidemon'] },
        { name: '🔸┃8F-sp8',    panels: ['8peak'] },
        { name: '🔹┃8F-ms8',    panels: ['8squarenormal', '8squareantidemon'] },
        { name: '🔸┃9F-sp9',    panels: ['9peak'] },
        { name: '🔹┃9F-ms9',    panels: ['9squarenormal', '9squareantidemon'] },
        { name: '🔸┃10F-sp10',  panels: ['10peak'] },
        { name: '🔹┃10F-ms10',  panels: ['10squarenormal', '10squareantidemon'] },
        { name: '🔸┃11F-sp11',  panels: ['11peak', '11goblin'] },
        { name: '🔹┃11F-ms11',  panels: ['11squareleaders', '11squareevents', '11squareantidemon', '11msgoblin'] },
        { name: '🔸┃12F-sp12',  panels: ['12peak', '12randomevent', '12goblin'] },
        { name: '🔹┃12F-ms12',  panels: ['12squareleaders', '12squareevents', '12squareantidemon', '12msgoblin'] },
        { name: '🌀┃summons',    panels: ['summon'] }
    ];

    const floorChannels = {}; // { '🔸┃7F-sp7': channelId, ... }
    for (const chDef of floorChannelDefs) {
        const ch = await findOrCreateTextChannel(guild, chDef.name, claimsCat.id, {
            reason: `[Setup] ${world} ${chDef.name}`
        });
        // Read-only for members and elders
        await ch.permissionOverwrites.create(memberRole.id, {
            ViewChannel: true, ReadMessageHistory: true, SendMessages: false
        }).catch(() => {});
        await ch.permissionOverwrites.create(elderRole.id, {
            ViewChannel: true, ReadMessageHistory: true, SendMessages: false
        }).catch(() => {});
        floorChannels[chDef.name] = ch.id;
    }

    // ═════════════════════════════════════
    // CATEGORY 3: ACTIVITY LOGS (all can post)
    // ═════════════════════════════════════
    const logsCat = await findOrCreateCategory(guild, worldLogsCatName(world), {
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
        const ch = await findOrCreateTextChannel(guild, name, logsCat.id, {
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
        floorChannels,
        logChannelIds
    };
}

// ══════════════════════════════════════════
// 4. SERVER-WIDE CHANNELS
// ══════════════════════════════════════════

async function setupGeneralChannels(guild, db) {
    if (db.config._generalChannelsDone) return;

    // ── Alliance General category ──
    const generalCat = await findOrCreateCategory(guild, '🌐 Alliance General', {
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
    const marketChannel = await findOrCreateTextChannel(guild, '🛒・market', generalCat.id, {
        reason: '[Setup] Alliance market'
    });
    const mainChatChannel = await findOrCreateTextChannel(guild, '💬・main-chat', generalCat.id, {
        reason: '[Setup] Alliance main chat'
    });

    // Tower rules & Announcements & Allied list — all can view, only elders+admins write
    // We need to create these with proper permissions
    async function createElderPostChannel(name, emoji) {
        const ch = await findOrCreateTextChannel(guild, `${emoji}・${name}`, generalCat.id, {
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
    const remindersChannel = await findOrCreateTextChannel(guild, '📢・reminders', generalCat.id, {
        reason: '[Setup] General reminders'
    });
    const eventsChannel = await findOrCreateTextChannel(guild, '📅・events', generalCat.id, {
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

// ══════════════════════════════════════════
// 7. NUKE — Delete EVERYTHING in the guild
// ══════════════════════════════════════════

/**
 * Confirmation timeout (5 minutes).
 * Key: `${userId}-nuke` → { confirmed: boolean }
 */
const nukeConfirmations = {};
const NUKE_CONFIRM_EXPIRY = 5 * 60 * 1000;

// Roles that must NEVER be deleted
const PROTECTED_ROLE_NAMES = new Set(['@everyone', 'Discord Bot', 'discord']);

/**
 * /nuke — Deletes ALL channels, categories, and editable roles in the guild.
 * Only the channel where the command was run is preserved.
 * Steps:
 *   1. Confirm with a button (ephemeral).
 *   2. Delete all text/voice channels
 *   3. Delete all categories
 *   4. Delete all editable, non-protected roles
 *   5. Clear db.config
 */
export async function handleNuke(interaction, db, saveLocalStorage, logEvent) {
    const cacheKey = `${interaction.user.id}-nuke`;

    // ── Step 1: Show confirmation ──
    const totalChannels = interaction.guild.channels.cache.size;
    const totalRoles = interaction.guild.roles.cache.size;

    const confirmEmbed = new EmbedBuilder()
        .setTitle('💣 Confirm Nuke?')
        .setColor(0xed4245)
        .setDescription(
            '⚠️ **This will permanently delete EVERYTHING:**\n\n' +
            `📊 **Guild stats:**\n` +
            `   🗂️ **${totalChannels}** channels/categories\n` +
            `   🏷️ **${totalRoles}** roles\n\n` +
            '• All channels will be deleted\n' +
            '• All categories will be deleted\n' +
            '• All custom roles will be deleted\n' +
            '• **Exception:** The current channel is preserved\n' +
            '• **Exception:** @everyone, bot roles, and managed roles are kept\n' +
            '• All setup configuration will be cleared from the database\n\n' +
            '**This action CANNOT be undone.** Click the button below to confirm.'
        )
        .setFooter({ text: 'Confirmation expires in 5 minutes' })
        .setTimestamp();

    const confirmRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('nuke_confirm')
            .setLabel('💣 YES, NUKE EVERYTHING')
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId('nuke_cancel')
            .setLabel('❌ Cancel')
            .setStyle(ButtonStyle.Secondary)
    );

    nukeConfirmations[cacheKey] = { confirmed: false, timestamp: Date.now() };

    return interaction.reply({
        embeds: [confirmEmbed],
        components: [confirmRow],
        flags: 64
    });
}

/**
 * Handle the nuke confirmation button or cancel button.
 */
export async function handleNukeButton(interaction, db, saveLocalStorage, logEvent) {
    const cacheKey = `${interaction.user.id}-nuke`;
    const confirmation = nukeConfirmations[cacheKey];

    if (!confirmation || (Date.now() - confirmation.timestamp > NUKE_CONFIRM_EXPIRY)) {
        delete nukeConfirmations[cacheKey];
        return interaction.update({
            content: '⌛ This confirmation has expired. Run `/nuke` again.',
            embeds: [],
            components: [],
            flags: 64
        });
    }

    // Handle cancel
    if (interaction.customId === 'nuke_cancel') {
        delete nukeConfirmations[cacheKey];
        return interaction.update({
            content: '✅ Nuke cancelled. No changes were made.',
            embeds: [],
            components: [],
            flags: 64
        });
    }

    // ── Execute nuke ──
    await interaction.update({
        content: '💣 **Nuking...** Deleting channels, categories, and roles. This may take a moment.',
        embeds: [],
        components: [],
        flags: 64
    });

    delete nukeConfirmations[cacheKey];

    const guild = interaction.guild;
    const safeChannelId = interaction.channelId;
    const results = { channels: 0, categories: 0, roles: 0, errors: [] };

    // ══════════════════════════════════════
    // 1. DELETE ALL CHANNELS (except the safe channel)
    // ══════════════════════════════════════
    // Delete text/voice channels first, then categories.
    // Sorting: text/voice channels sorted by position (higher first),
    // then categories. This avoids permission issues.

    const allChannels = [...guild.channels.cache.values()]
        .filter(ch => ch.id !== safeChannelId) // Never delete the channel where /nuke was run
        .sort((a, b) => (b.position || 0) - (a.position || 0));

    for (const ch of allChannels) {
        try {
            await ch.delete('💣 Nuke command');
            if (ch.type === 4) {
                results.categories++;
            } else {
                results.channels++;
            }
        } catch (err) {
            results.errors.push(`#${ch.name} (${ch.id}): ${err.message}`);
        }
    }

    // ══════════════════════════════════════
    // 2. DELETE ALL ROLES (except protected ones)
    // ══════════════════════════════════════
    const rolesToDelete = [...guild.roles.cache.values()]
        .filter(role => {
            // Never delete @everyone
            if (role.name === '@everyone') return false;
            // Never delete managed roles (Discord integrations, bots)
            if (role.managed) return false;
            // Never delete roles the bot can't edit (above its highest role)
            if (!role.editable) return false;
            // Skip roles with protected names
            if (PROTECTED_ROLE_NAMES.has(role.name)) return false;
            return true;
        })
        .sort((a, b) => b.position - a.position); // Highest positions first

    for (const role of rolesToDelete) {
        try {
            await role.delete('💣 Nuke command');
            results.roles++;
        } catch (err) {
            results.errors.push(`@${role.name} (${role.id}): ${err.message}`);
        }
    }

    // ══════════════════════════════════════
    // 3. CLEAR DATABASE CONFIG
    // ══════════════════════════════════════
    delete db.config.worldSetup;
    delete db.config._generalChannelsDone;
    delete db.config.generalChannels;
    delete db.config._setupState;
    if (db.config.adminChannelId) delete db.config.adminChannelId;
    saveLocalStorage();

    logEvent(`💣 Nuke executed by ${interaction.user.tag}: ${results.channels} channels, ${results.categories} categories, ${results.roles} roles deleted`);

    // ── Build report ──
    const reportEmbed = new EmbedBuilder()
        .setTitle('💣 Nuke Complete!')
        .setColor(results.errors.length === 0 ? 0x57f287 : 0xffee88)
        .setDescription([
            `📊 **Results:**`,
            `   🗑️ Channels deleted: **${results.channels}**`,
            `   🗑️ Categories deleted: **${results.categories}**`,
            `   🗑️ Roles deleted: **${results.roles}**`,
            `   ✅ Channel preserved: <#${safeChannelId}>`,
            results.errors.length > 0 ? `\n⚠️ **Errors (${results.errors.length}):**\n${results.errors.slice(0, 10).join('\n')}` : ''
        ].join('\n'))
        .setTimestamp();

    await interaction.followUp({ embeds: [reportEmbed], flags: 64 }).catch(() => {});
}
