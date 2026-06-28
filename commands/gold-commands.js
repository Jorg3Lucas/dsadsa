// ==========================================
// 🛒 GOLD SHOP SLASH COMMANDS
// /shop, /orders, /deliver, /goldadmin, /goldstats
// ==========================================

import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import * as goldShop from '../gold-shop.js';
import { getOrderStatusEmoji, buildOrderEmbed, buildCatalogEmbed, buildCatalogButtons } from '../interactions/gold-interactions.js';

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
    if (commandName === 'goldadmin') {
        return handleGoldAdmin(interaction);
    }

    return false;
}

// ==========================================
// 🛒 /shop - Browse catalog
// ==========================================

async function handleShop(interaction) {
    await interaction.deferReply({ flags: 64 });

    const embed = buildCatalogEmbed();
    const components = buildCatalogButtons();

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
            content: '📭 Você ainda não fez nenhum pedido. Use `/shop` para comprar Gold!',
            flags: 64
        });
    }

    // Show last 10 orders
    const recentOrders = orders.slice(0, 10);

    const embed = new EmbedBuilder()
        .setColor(0xFEE75C)
        .setTitle('📋 Meus Pedidos')
        .setDescription(`Você tem **${orders.length}** pedido(s) no total.`)
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
        embed.setFooter({ text: `Mostrando os 10 mais recentes de ${orders.length} pedidos.` });
    }

    const components = [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('gold-shop-back')
                .setLabel('🛒 Voltar à Loja')
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
            content: '❌ Pedido não encontrado. Verifique o ID e tente novamente.',
            flags: 64
        });
    }

    // Only the order owner or admin can view details
    const isAdmin = interaction.member.roles.cache.has(process.env.GOLD_ADMIN_ROLE_ID || '') ||
                    interaction.member.permissions.has('ManageMessages');

    if (order.userId !== interaction.user.id && !isAdmin) {
        return interaction.editReply({
            content: '❌ Este pedido não pertence a você.',
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
// 👑 /goldadmin - Admin commands
// ==========================================

async function handleGoldAdmin(interaction) {
    const subcommand = interaction.options.getSubcommand();

    // Check admin permissions
    const isAdmin = interaction.member.roles.cache.has(process.env.GOLD_ADMIN_ROLE_ID || '') ||
                    interaction.member.permissions.has('ManageMessages');

    if (!isAdmin) {
        return interaction.reply({
            content: '❌ Você não tem permissão para usar este comando.',
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
    if (subcommand === 'produtos') {
        return handleAdminProducts(interaction);
    }
}

async function handleAdminStats(interaction) {
    const stats = goldShop.getShopStats();

    const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle('📊 Estatísticas da Gold Shop')
        .setTimestamp()
        .addFields(
            { name: '📦 Total de Pedidos', value: String(stats.totalOrders), inline: true },
            { name: '⏳ Pendentes', value: String(stats.pending), inline: true },
            { name: '💰 Aguardando Entrega', value: String(stats.paid), inline: true },
            { name: '✅ Entregues', value: String(stats.delivered), inline: true },
            { name: '❌ Cancelados', value: String(stats.cancelled), inline: true },
            { name: '🏪 Produtos Ativos', value: String(stats.activeProducts), inline: true },
            { name: '💰 Receita Total', value: `R$ ${stats.totalRevenue.toFixed(2)}`, inline: false },
            { name: '💛 Gold Vendido', value: `${(stats.totalGoldSold / 1000000).toFixed(2)}M`, inline: false }
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
            content: '✅ Nenhum pedido aguardando entrega!',
            flags: 64
        });
    }

    const embed = new EmbedBuilder()
        .setColor(0xFEE75C)
        .setTitle('📋 Pedidos Aguardando Entrega')
        .setDescription(`**${pendingOrders.length}** pedido(s) pago(s) aguardando entrega.`)
        .setTimestamp();

    for (const order of pendingOrders) {
        const paidAt = new Date(order.paidAt).toLocaleString('pt-BR');
        embed.addFields({
            name: `💰 ${order.orderId} - ${order.productName}`,
            value: `👤 <@${order.userId}>\n🎮 Personagem: ${order.characterName}\n📅 Pago em: ${paidAt}`,
            inline: false
        });
    }

    const components = pendingOrders.map(order =>
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`gold-deliver-${order.orderId}`)
                .setLabel(`✅ Entregar ${order.orderId}`)
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
            content: '❌ Pedido não encontrado.',
            flags: 64
        });
    }

    if (order.status !== 'paid') {
        return interaction.editReply({
            content: `❌ Este pedido está como **${order.status}**. Só é possível entregar pedidos pagos.`,
            flags: 64
        });
    }

    const delivered = goldShop.markOrderAsDelivered(orderId, interaction.user.tag);

    const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle('✅ Pedido Entregue!')
        .setDescription(`O pedido **${orderId}** foi marcado como entregue.`)
        .addFields(
            { name: '👤 Cliente', value: `<@${delivered.userId}>`, inline: true },
            { name: '💛 Produto', value: delivered.productName, inline: true },
            { name: '🎮 Personagem', value: delivered.characterName, inline: true },
            { name: '👑 Entregue por', value: interaction.user.tag, inline: false }
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
            .setTitle('✅ Gold Entregue!')
            .setDescription(`Seu pedido **${orderId}** foi entregue!`)
            .addFields(
                { name: '💛 Produto', value: delivered.productName, inline: true },
                { name: '🎮 Personagem', value: delivered.characterName, inline: true },
                { name: '💰 Total', value: `R$ ${delivered.price.toFixed(2)}`, inline: true }
            )
            .setFooter({ text: 'Obrigado pela compra! Volte sempre 🙏' })
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
            content: '❌ Pedido não encontrado.',
            flags: 64
        });
    }

    if (order.status === 'delivered') {
        return interaction.editReply({
            content: '❌ Não é possível cancelar um pedido já entregue.',
            flags: 64
        });
    }

    const cancelled = goldShop.cancelOrder(orderId, reason);

    await interaction.editReply({
        content: `✅ Pedido **${orderId}** cancelado.\n📝 Motivo: ${reason}`,
        flags: 64
    });

    // Notify the user
    try {
        const user = await interaction.client.users.fetch(cancelled.userId);
        await user.send({
            content: `❌ Seu pedido **${orderId}** (${cancelled.productName}) foi cancelado.\n📝 Motivo: ${reason}\n\n💳 Se você já pagou, solicite o reembolso em um ticket de suporte.`
        });
    } catch { /* DM might be closed */ }
}

async function handleAdminProducts(interaction) {
    const products = goldShop.getAllProducts();

    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('🏪 Gerenciar Produtos')
        .setDescription('Clique em um produto para ativar/desativar.')
        .setTimestamp();

    for (const product of products) {
        const status = product.active ? '✅ Ativo' : '❌ Inativo';
        embed.addFields({
            name: `${product.name} - R$ ${product.price.toFixed(2)}`,
            value: `💛 ${(product.amount / 1000000).toFixed(1)}M Gold | ${status}`,
            inline: false
        });
    }

    const components = products.map(product =>
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`gold-toggle-${product.id}`)
                .setLabel(`${product.active ? '❌ Desativar' : '✅ Ativar'} ${product.name}`)
                .setStyle(product.active ? ButtonStyle.Danger : ButtonStyle.Success)
        )
    );

    await interaction.editReply({
        embeds: [embed],
        components,
        flags: 64
    });
}
