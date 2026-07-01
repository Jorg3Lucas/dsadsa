// ==========================================
// 🛒 GOLD SHOP SLASH COMMANDS
// /shop, /orders, /deliver, /goldadmin, /goldstats
// ==========================================

import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import * as goldShop from '../gold-shop.js';
import { getOrderStatusEmoji, buildOrderEmbed, buildGoldPanelEmbed, buildGoldPanelButtons } from '../interactions/gold-interactions.js';

// ==========================================
// 📝 COMMAND DEFINITIONS
// ==========================================

// Commands are registered via ranking-commands.js using raw JSON format

// ==========================================
// 🎯 SLASH COMMAND HANDLER
// ==========================================

export async function handleGoldSlashCommand(interaction) {
    const commandName = interaction.commandName;

    if (commandName === 'shop') {
        return handleShop(interaction);
    }
    if (commandName === 'orders') {
        return handleMyOrders(interaction);
    }
    if (commandName === 'order') {
        return handleOrderDetails(interaction);
    }
    if (commandName === 'goldshop') {
        return handleGoldShopSlash(interaction);
    }
    if (commandName === 'goldadmin') {
        return handleGoldAdmin(interaction);
    }

    return false;
}

// ==========================================
// 🛒 /shop - Show gold shop panel
// ==========================================

async function handleShop(interaction) {
    await interaction.deferReply({ flags: 64 });

    const embed = buildGoldPanelEmbed();
    const components = buildGoldPanelButtons();

    await interaction.editReply({
        embeds: [embed],
        components
    });
}

// ==========================================
// 📋 /orders - View user orders
// ==========================================

async function handleMyOrders(interaction) {
    await interaction.deferReply({ flags: 64 });

    const userId = interaction.user.id;
    const orders = goldShop.getUserOrders(userId);

    if (orders.length === 0) {
        return interaction.editReply({
            content: '📭 You haven\'t placed any orders yet. Use `/shop` to buy Gold!',
            flags: 64
        });
    }

    // Show last 10 orders
    const recentOrders = orders.slice(0, 10);

    const embed = new EmbedBuilder()
        .setColor(0xFEE75C)
        .setTitle('📋 My Orders')
        .setDescription(`You have **${orders.length}** order(s) in total.`)
        .setTimestamp();

    for (const order of recentOrders) {
        const statusEmoji = getOrderStatusEmoji(order.status);
        const date = new Date(order.createdAt).toLocaleString('pt-BR');
        embed.addFields({
            name: `${statusEmoji} ${order.orderId} - ${order.productName}`,
            value: `📅 ${date}\n💰 R$ ${order.price.toFixed(2)}\n📌 **${order.status.toUpperCase()}**`,
            inline: false
        });
    }

    if (orders.length > 10) {
        embed.setFooter({ text: `Showing 10 most recent out of ${orders.length} orders.` });
    }

    const components = [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('gold-shop-back')
                .setLabel('🛒 Back to Shop')
                .setStyle(ButtonStyle.Secondary)
        )
    ];

    await interaction.editReply({
        embeds: [embed],
        components,
        flags: 64
    });
}

// ==========================================
// 🔍 /order - View specific order
// ==========================================

async function handleOrderDetails(interaction) {
    await interaction.deferReply({ flags: 64 });

    const orderId = interaction.options.getString('id').toUpperCase().trim();
    const order = goldShop.getOrder(orderId);

    if (!order) {
        return interaction.editReply({
            content: '❌ Order not found. Check the ID and try again.',
            flags: 64
        });
    }

    // Only the order owner or admin can view details
    const isAdmin = interaction.member.roles.cache.has(process.env.GOLD_ADMIN_ROLE_ID || '') ||
                    interaction.member.permissions.has('ManageMessages');

    if (order.userId !== interaction.user.id && !isAdmin) {
        return interaction.editReply({
            content: '❌ This order doesn\'t belong to you.',
            flags: 64
        });
    }

    const embed = buildOrderEmbed(order);

    await interaction.editReply({
        embeds: [embed],
        flags: 64
    });
}

// ==========================================
// 🏪 /goldshop - Create persistent gold panel
// ==========================================

async function handleGoldShopSlash(interaction) {
    // Check admin permission
    if (!interaction.member.permissions.has('ManageMessages')) {
        return interaction.reply({
            content: '❌ You need the **Manage Messages** permission to use this command.',
            flags: 64
        });
    }

    await interaction.deferReply({ flags: 64 });

    try {
        const embed = buildGoldPanelEmbed();
        const components = buildGoldPanelButtons();

        // Delete existing gold panel in this channel if it exists
        const existing = goldShop.getPanelRef();
        if (existing && existing.channelId === interaction.channelId) {
            try {
                const oldMsg = await interaction.channel.messages.fetch(existing.messageId).catch(() => null);
                if (oldMsg) await oldMsg.delete();
            } catch { /* message may have been deleted */ }
        }

        // Send the panel as a regular (visible to all) message in the channel
        const sent = await interaction.channel.send({ embeds: [embed], components });
        goldShop.savePanelRef(interaction.channelId, sent.id);

        await interaction.editReply({
            content: '✅ **Gold Shop panel created successfully!**\n\nThe panel was pinned to this channel. Everyone can view and buy gold.\n\n💡 Use `/goldadmin` to manage the shop.'
        });

        console.log(`🏪 Gold Shop panel created via /goldshop in channel ${interaction.channelId}`);
    } catch (error) {
        console.error('❌ Error creating gold shop panel via /goldshop:', error);
        await interaction.editReply({
            content: '❌ Error creating gold shop panel. Check the logs.',
            flags: 64
        });
    }
}

// ==========================================
// 👑 /goldadmin - Admin commands
// ==========================================

async function handleGoldAdmin(interaction) {
    const subcommand = interaction.options.getSubcommand();

    // Check admin permissions
    const isAdmin = interaction.member.roles.cache.has(process.env.GOLD_ADMIN_ROLE_ID || '') ||
                    interaction.member.permissions.has('ManageMessages');

    if (!isAdmin) {
        return interaction.reply({
            content: '❌ You don\'t have permission to use this command.',
            flags: 64
        });
    }

    await interaction.deferReply({ flags: 64 });

    if (subcommand === 'stats') {
        return handleAdminStats(interaction);
    }
    if (subcommand === 'pedidos') {
        return handleAdminPendingOrders(interaction);
    }
    if (subcommand === 'entregar') {
        return handleAdminDeliver(interaction);
    }
    if (subcommand === 'cancelar') {
        return handleAdminCancel(interaction);
    }

}

async function handleAdminStats(interaction) {
    const stats = goldShop.getShopStats();

    const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle('📊 Gold Shop Statistics')
        .setTimestamp()
        .addFields(
            { name: '📦 Total Orders', value: String(stats.totalOrders), inline: true },
            { name: '⏳ Pending', value: String(stats.pending), inline: true },
            { name: '💰 Awaiting Delivery', value: String(stats.paid), inline: true },
            { name: '✅ Delivered', value: String(stats.delivered), inline: true },
            { name: '❌ Cancelled', value: String(stats.cancelled), inline: true },
            { name: '💰 Total Revenue', value: `R$ ${stats.totalRevenue.toFixed(2)}`, inline: false },
            { name: '💛 Gold Sold', value: `${(stats.totalGoldSold / 1000000).toFixed(2)}M`, inline: false }
        );

    await interaction.editReply({
        embeds: [embed],
        flags: 64
    });
}

async function handleAdminPendingOrders(interaction) {
    const pendingOrders = goldShop.getPendingOrders();

    if (pendingOrders.length === 0) {
        return interaction.editReply({
            content: '✅ No orders awaiting delivery!',
            flags: 64
        });
    }

    const embed = new EmbedBuilder()
        .setColor(0xFEE75C)
        .setTitle('📋 Orders Awaiting Delivery')
        .setDescription(`**${pendingOrders.length}** paid order(s) awaiting delivery.`)
        .setTimestamp();

    for (const order of pendingOrders) {
        const paidAt = new Date(order.paidAt).toLocaleString('pt-BR');
        embed.addFields({
            name: `💰 ${order.orderId} - ${order.productName}`,
            value: `👤 <@${order.userId}>\n🎮 Character: ${order.characterName}\n📅 Paid on: ${paidAt}`,
            inline: false
        });
    }

    const components = pendingOrders.map(order =>
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`gold-deliver-${order.orderId}`)
                .setLabel(`✅ Deliver ${order.orderId}`)
                .setStyle(ButtonStyle.Success)
        )
    ).slice(0, 5); // Max 5 rows

    await interaction.editReply({
        embeds: [embed],
        components,
        flags: 64
    });
}

async function handleAdminDeliver(interaction) {
    const orderId = interaction.options.getString('id').toUpperCase().trim();
    const order = goldShop.getOrder(orderId);

    if (!order) {
        return interaction.editReply({
            content: '❌ Order not found.',
            flags: 64
        });
    }

    if (order.status !== 'paid') {
        return interaction.editReply({
            content: `❌ This order is **${order.status}**. Only paid orders can be delivered.`,
            flags: 64
        });
    }

    const delivered = goldShop.markOrderAsDelivered(orderId, interaction.user.tag);

    const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle('✅ Order Delivered!')
        .setDescription(`Order **${orderId}** has been marked as delivered.`)
        .addFields(
            { name: '👤 Client', value: `<@${delivered.userId}>`, inline: true },
            { name: '💛 Product', value: delivered.productName, inline: true },
            { name: '🎮 Character', value: delivered.characterName, inline: true },
            { name: '👑 Delivered by', value: interaction.user.tag, inline: false }
        )
        .setTimestamp();

    await interaction.editReply({
        embeds: [embed],
        flags: 64
    });

    // Notify the user via DM that their gold was delivered
    try {
        const user = await interaction.client.users.fetch(delivered.userId);
        const dmEmbed = new EmbedBuilder()
            .setColor(0x57F287)
            .setTitle('✅ Gold Delivered!')
            .setDescription(`Your order **${orderId}** has been delivered!`)
            .addFields(
                { name: '💛 Product', value: delivered.productName, inline: true },
                { name: '🎮 Character', value: delivered.characterName, inline: true },
                { name: '💰 Total', value: `R$ ${delivered.price.toFixed(2)}`, inline: true }
            )
            .setFooter({ text: 'Thank you for your purchase! Come back anytime 🙏' })
            .setTimestamp();

        await user.send({ embeds: [dmEmbed] });
    } catch { /* DM might be closed */ }
}

async function handleAdminCancel(interaction) {
    const orderId = interaction.options.getString('id').toUpperCase().trim();
    const reason = interaction.options.getString('motivo') || 'Cancelado pelo administrador';

    const order = goldShop.getOrder(orderId);

    if (!order) {
        return interaction.editReply({
            content: '❌ Order not found.',
            flags: 64
        });
    }

    if (order.status === 'delivered') {
        return interaction.editReply({
            content: '❌ Cannot cancel a delivered order.',
            flags: 64
        });
    }

    const cancelled = goldShop.cancelOrder(orderId, reason);

    await interaction.editReply({
        content: `✅ Order **${orderId}** cancelled.\n📝 Reason: ${reason}`,
        flags: 64
    });

    // Notify the user
    try {
        const user = await interaction.client.users.fetch(cancelled.userId);
        await user.send({
            content: `❌ Your order **${orderId}** (${cancelled.productName}) was cancelled.\n📝 Reason: ${reason}\n\n💳 If you already paid, request a refund in a support ticket.`
        });
    } catch { /* DM might be closed */ }
}


