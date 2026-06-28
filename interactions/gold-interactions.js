// ==========================================
// 🛒 GOLD SHOP INTERACTIONS
// Buttons, modals, select menus
// ==========================================

import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder } from 'discord.js';
import * as goldShop from '../gold-shop.js';
import { createPixPayment, initMercadoPago } from '../mercadopago.js';

// ==========================================
// 🎨 HELPERS
// ==========================================

export function getOrderStatusEmoji(status) {
    const map = {
        'pending': '⏳',
        'paid': '💰',
        'delivered': '✅',
        'cancelled': '❌'
    };
    return map[status] || '❓';
}

export function getOrderStatusText(status) {
    const map = {
        'pending': 'Aguardando Pagamento',
        'paid': 'Pago - Aguardando Entrega',
        'delivered': 'Entregue',
        'cancelled': 'Cancelado'
    };
    return map[status] || status;
}

export function formatCurrency(value) {
    return `R$ ${value.toFixed(2)}`;
}

// ==========================================
// 🖼️ EMBED BUILDERS
// ==========================================

export function buildCatalogEmbed() {
    const products = goldShop.getActiveProducts();

    const embed = new EmbedBuilder()
        .setColor(0xFEE75C)
        .setTitle('🛒 Gold Shop - MIR4')
        .setDescription(
            '💰 **Compre Gold do MIR4 com PIX!**\n\n' +
            '📌 O pagamento é processado via **Mercado Pago**.\n' +
            '🔄 Após a confirmação do pagamento, nossa equipe fará a entrega no jogo.\n' +
            '⏳ O PIX tem validade de **30 minutos**.\n\n' +
            '**📋 Catálogo de Produtos:**'
        )
        .setTimestamp();

    for (const product of products) {
        embed.addFields({
            name: `${product.name}`,
            value: `💛 **${(product.amount / 1000000).toFixed(1)}M Gold** — 💰 **${formatCurrency(product.price)}**`,
            inline: false
        });
    }

    embed.setFooter({
        text: 'Clique em um produto abaixo para comprar'
    });

    return embed;
}

export function buildCatalogButtons() {
    const products = goldShop.getActiveProducts();
    const rows = [];

    // Create rows of buttons (max 3 per row, 5 rows max)
    for (let i = 0; i < products.length; i += 3) {
        const row = new ActionRowBuilder();
        const batch = products.slice(i, i + 3);

        for (const product of batch) {
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId(`gold-buy-${product.id}`)
                    .setLabel(`${(product.amount / 1000000).toFixed(0)}M - ${formatCurrency(product.price)}`)
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('💛')
            );
        }

        rows.push(row);
    }

    // Add orders button
    rows.push(
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('gold-my-orders')
                .setLabel('📋 Meus Pedidos')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('📋')
        )
    );

    return rows;
}

export function buildOrderEmbed(order) {
    const statusEmoji = getOrderStatusEmoji(order.status);
    const statusText = getOrderStatusText(order.status);

    const embed = new EmbedBuilder()
        .setColor(order.status === 'delivered' ? 0x57F287 : order.status === 'paid' ? 0xFEE75C : order.status === 'cancelled' ? 0xED4245 : 0x5865F2)
        .setTitle(`${statusEmoji} Pedido ${order.orderId}`)
        .setTimestamp()
        .addFields(
            { name: '📦 Produto', value: order.productName, inline: true },
            { name: '💛 Gold', value: `${(order.goldAmount / 1000000).toFixed(2)}M`, inline: true },
            { name: '💰 Valor', value: `R$ ${order.price.toFixed(2)}`, inline: true },
            { name: '📌 Status', value: `**${statusText}**`, inline: false },
            { name: '🎮 Personagem', value: order.characterName, inline: true },
            { name: '🌍 Servidor', value: order.server, inline: true },
            { name: '📅 Criado em', value: new Date(order.createdAt).toLocaleString('pt-BR'), inline: false }
        );

    if (order.paidAt) {
        embed.addFields({
            name: '💳 Pago em',
            value: new Date(order.paidAt).toLocaleString('pt-BR'),
            inline: true
        });
    }

    if (order.deliveredAt) {
        embed.addFields({
            name: '✅ Entregue em',
            value: new Date(order.deliveredAt).toLocaleString('pt-BR'),
            inline: true
        });
        if (order.deliveredBy) {
            embed.addFields({
                name: '👑 Entregue por',
                value: order.deliveredBy,
                inline: true
            });
        }
    }

    if (order.notes) {
        embed.addFields({
            name: '📝 Observações',
            value: order.notes,
            inline: false
        });
    }

    // Show PIX info if pending
    if (order.status === 'pending' && order.pixCopiaCola) {
        embed.addFields({
            name: '📋 Código PIX (Copiar e Colar)',
            value: `\`\`\`\n${order.pixCopiaCola}\n\`\`\``,
            inline: false
        });
    }

    if (order.status === 'pending' && order.paymentExpiresAt) {
        const expires = new Date(order.paymentExpiresAt);
        const now = Date.now();
        const remaining = Math.max(0, Math.floor((expires.getTime() - now) / 1000));
        const minutes = Math.floor(remaining / 60);
        const seconds = remaining % 60;

        if (remaining > 0) {
            embed.addFields({
                name: '⏳ PIX Expira em',
                value: `${minutes}m ${seconds}s`,
                inline: false
            });
        } else {
            embed.addFields({
                name: '⏳ PIX Expirado',
                value: 'O QR Code PIX expirou. Crie um novo pedido.',
                inline: false
            });
        }
    }

    embed.setFooter({
        text: 'Gold Shop - MIR4'
    });

    return embed;
}

export function buildPixEmbed(order, qrCodeBase64, qrCodeText) {
    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('💳 Pagamento PIX')
        .setDescription(
            `🛒 **Pedido:** ${order.orderId}\n` +
            `💛 **Produto:** ${order.productName}\n` +
            `💰 **Valor:** R$ ${order.price.toFixed(2)}\n\n` +
            `📌 **Instruções:**\n` +
            `1️⃣ Abra o app do seu banco\n` +
            `2️⃣ Escolha pagar via PIX (Copia e Cola)\n` +
            `3️⃣ Cole o código abaixo ou escaneie o QR Code\n` +
            `4️⃣ Confirme o pagamento\n\n` +
            `⏳ O PIX expira em **30 minutos**.\n` +
            `🔄 Após o pagamento, aguarde nossa equipe entrar em contato para entrega.\n\n` +
            `**📋 Código PIX (Copia e Cola):**\n` +
            `\`\`\`\n${qrCodeText}\n\`\`\``
        )
        .setTimestamp();

    if (qrCodeBase64) {
        embed.setImage(`attachment://pix-qr-${order.orderId}.png`);
    }

    return embed;
}

// ==========================================
// 🏪 GOLD PANEL (persistent, for !goldshop command)
// Same as catalog but designed for a pinned channel message
// ==========================================

/** Renders the persistent gold shop panel embed */
export function buildGoldPanelEmbed() {
    const products = goldShop.getActiveProducts();

    const embed = new EmbedBuilder()
        .setColor(0xFEE75C)
        .setTitle('🛒 Gold Shop - MIR4')
        .setDescription(
            '💰 **Compre Gold do MIR4 com PIX!**\n\n' +
            '📌 O pagamento é processado via **Mercado Pago**.\n' +
            '🔄 Após a confirmação do pagamento, nossa equipe fará a entrega no jogo.\n' +
            '⏳ O PIX tem validade de **30 minutos**.\n' +
            '💬 **Clique nos botões abaixo para comprar!**\n\n' +
            '━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
            '**📋 Catálogo de Produtos:**'
        )
        .setTimestamp();

    for (const product of products) {
        embed.addFields({
            name: `${product.name}`,
            value: `💛 **${(product.amount / 1000000).toFixed(1)}M Gold** — 💰 **${formatCurrency(product.price)}**`,
            inline: false
        });
    }

    embed.setFooter({
        text: 'Clique em um produto abaixo para comprar'
    });

    return embed;
}

/** Renders the persistent gold shop panel buttons */
export function buildGoldPanelButtons() {
    const products = goldShop.getActiveProducts();
    const rows = [];

    // Create rows of buttons (max 3 per row)
    for (let i = 0; i < products.length; i += 3) {
        const row = new ActionRowBuilder();
        const batch = products.slice(i, i + 3);

        for (const product of batch) {
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId(`gold-buy-${product.id}`)
                    .setLabel(`${(product.amount / 1000000).toFixed(0)}M - ${formatCurrency(product.price)}`)
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('💛')
            );
        }

        rows.push(row);
    }

    // Bottom row: utility buttons
    rows.push(
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('gold-my-orders')
                .setLabel('📋 Meus Pedidos')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('gold-admin-menu')
                .setLabel('👑 Admin')
                .setStyle(ButtonStyle.Secondary)
        )
    );

    return rows;
}

// ==========================================
// 🧩 CAN HANDLE
// ==========================================

const GOLD_PREFIXES = ['gold-buy-', 'gold-my-orders', 'gold-shop-back', 'gold-deliver-', 'gold-toggle-', 'gold-cancel-order-', 'gold-refresh-order-', 'gold-admin-menu', 'gold-stats', 'gold-pending-orders', 'gold-manage-products', 'gold-add-product', 'gold-edit-price-', 'gold-delete-menu', 'gold-select-delete', 'gold-refresh-panel'];

export function canHandleGoldInteraction(interaction) {
    const cid = interaction.customId;
    return GOLD_PREFIXES.some(prefix => cid.startsWith(prefix));
}

// ==========================================
// 🎯 MAIN DISPATCH
// ==========================================

export async function handleGoldInteraction(interaction) {
    const cid = interaction.customId;

    if (cid === 'gold-my-orders') {
        return handleMyOrdersButton(interaction);
    }
    if (cid === 'gold-shop-back') {
        return handleShopBack(interaction);
    }
    if (cid.startsWith('gold-buy-')) {
        return handleBuyButton(interaction);
    }
    if (cid.startsWith('gold-deliver-')) {
        return handleDeliverButton(interaction);
    }
    if (cid.startsWith('gold-toggle-')) {
        return handleToggleProduct(interaction);
    }
    if (cid.startsWith('gold-cancel-order-')) {
        return handleCancelOrderButton(interaction);
    }
    if (cid.startsWith('gold-refresh-order-')) {
        return handleRefreshOrder(interaction);
    }
    if (cid === 'gold-admin-menu') {
        return handleAdminMenu(interaction);
    }
    if (cid === 'gold-stats') {
        return handleAdminStatsButton(interaction);
    }
    if (cid === 'gold-pending-orders') {
        return handleAdminPendingButton(interaction);
    }
    if (cid === 'gold-manage-products') {
        return handleAdminProductsButton(interaction);
    }
    if (cid === 'gold-add-product') {
        return handleAddProductButton(interaction);
    }
    if (cid.startsWith('gold-edit-price-')) {
        return handleEditPriceButton(interaction);
    }
    if (cid === 'gold-delete-menu') {
        return handleDeleteMenu(interaction);
    }
    if (cid === 'gold-select-delete') {
        return handleSelectDelete(interaction);
    }
    if (cid === 'gold-refresh-panel') {
        return handleRefreshPanel(interaction);
    }

    return false;
}

// ==========================================
// 🛒 BUY FLOW
// ==========================================

async function handleBuyButton(interaction) {
    const productId = interaction.customId.replace('gold-buy-', '');

    // Check if Mercado Pago is initialized
    const mpReady = !!process.env.MERCADO_PAGO_ACCESS_TOKEN;
    if (!mpReady) {
        return interaction.reply({
            content: '❌ O sistema de pagamento não está configurado. Entre em contato com o administrador.',
            flags: 64
        });
    }

    const product = goldShop.getProduct(productId);
    if (!product || !product.active) {
        return interaction.reply({
            content: '❌ Produto não encontrado ou indisponível.',
            flags: 64
        });
    }

    // Show modal to ask for character name
    const modal = new ModalBuilder()
        .setCustomId(`gold-modal-${productId}`)
        .setTitle(`Comprar ${product.name}`);

    const characterInput = new TextInputBuilder()
        .setCustomId('gold-character-name')
        .setLabel('🎮 Nome do personagem (exatamente como no jogo)')
        .setPlaceholder('Digite o nome do seu personagem...')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMinLength(2)
        .setMaxLength(20);

    const serverInput = new TextInputBuilder()
        .setCustomId('gold-server')
        .setLabel('🌍 Servidor (ASIA / EU / SA)')
        .setPlaceholder('EU')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMinLength(2)
        .setMaxLength(10);

    const firstRow = new ActionRowBuilder().addComponents(characterInput);
    const secondRow = new ActionRowBuilder().addComponents(serverInput);

    modal.addComponents(firstRow, secondRow);

    await interaction.showModal(modal);
}

// ==========================================
// 📝 HANDLE MODAL SUBMIT
// ==========================================

export async function handleGoldModalSubmit(interaction) {
    const modalId = interaction.customId;

    // ── Handle add product modal ──
    if (modalId === 'gold-modal-add-product') {
        return handleAddProductModal(interaction);
    }

    // ── Handle edit price modal ──
    if (modalId.startsWith('gold-modal-edit-price-')) {
        return handleEditPriceModal(interaction);
    }

    // ── Handle buy modal (standard) ──
    if (!modalId.startsWith('gold-modal-')) return false;

    const productId = modalId.replace('gold-modal-', '');
    const product = goldShop.getProduct(productId);
    if (!product || !product.active) {
        return interaction.reply({
            content: '❌ Produto não encontrado ou indisponível.',
            flags: 64
        });
    }

    const characterName = interaction.fields.getTextInputValue('gold-character-name').trim();
    const server = interaction.fields.getTextInputValue('gold-server').trim().toUpperCase();

    if (!['ASIA', 'EU', 'SA'].includes(server)) {
        return interaction.reply({
            content: '❌ Servidor inválido. Use ASIA, EU ou SA.',
            flags: 64
        });
    }

    await interaction.deferReply({ flags: 64 });

    try {
        // Create order in database
        const order = await goldShop.createOrder(
            interaction.user.id,
            interaction.user.tag,
            productId,
            characterName
        );

        // Initialize Mercado Pago if needed
        initMercadoPago();

        // Create PIX payment
        const pixResult = await createPixPayment(
            product.price,
            `MIR4 Gold - ${product.name} - ${order.orderId}`,
            null,
            order.orderId
        );

        // Update order with payment info
        goldShop.updateOrderPayment(
            order.orderId,
            pixResult.id,
            pixResult.qrCode,
            pixResult.qrCodeBase64
        );

        // Send DM with PIX info
        const pixEmbed = buildPixEmbed(order, pixResult.qrCodeBase64, pixResult.qrCode);

        const dmComponents = [
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`gold-refresh-order-${order.orderId}`)
                    .setLabel('🔄 Atualizar Status')
                    .setStyle(ButtonStyle.Secondary)
            )
        ];

        try {
            await interaction.user.send({
                embeds: [pixEmbed],
                components: dmComponents,
                files: pixResult.qrCodeBase64
                    ? [{ attachment: Buffer.from(pixResult.qrCodeBase64, 'base64'), name: `pix-qr-${order.orderId}.png` }]
                    : []
            });
        } catch {
            // DM might be closed, send in channel instead
            await interaction.editReply({
                content: '⚠️ Não consegui enviar DM. Verifique se suas DMs estão abertas.',
                flags: 64
            });
        }

        // Confirm in interaction
        const confirmEmbed = new EmbedBuilder()
            .setColor(0x57F287)
            .setTitle('✅ Pedido Criado com Sucesso!')
            .setDescription(
                `📋 **Pedido:** ${order.orderId}\n` +
                `💛 **Produto:** ${product.name}\n` +
                `💰 **Valor:** R$ ${product.price.toFixed(2)}\n` +
                `🎮 **Personagem:** ${characterName}\n\n` +
                `💳 **Instruções de Pagamento enviadas no seu DM!**\n` +
                `📌 Verifique suas mensagens privadas para pagar via PIX.\n\n` +
                `⏳ O PIX expira em **30 minutos**.`
            )
            .setTimestamp();

        await interaction.editReply({
            embeds: [confirmEmbed],
            flags: 64
        });

        // Send notification to admin channel
        const adminChannelId = process.env.GOLD_ADMIN_CHANNEL_ID;
        if (adminChannelId) {
            try {
                const adminChannel = await interaction.client.channels.fetch(adminChannelId);
                if (adminChannel) {
                    const adminEmbed = new EmbedBuilder()
                        .setColor(0xFEE75C)
                        .setTitle('🆕 Novo Pedido!')
                        .setDescription(
                            `📋 **Pedido:** ${order.orderId}\n` +
                            `👤 **Cliente:** <@${interaction.user.id}> (${interaction.user.tag})\n` +
                            `💛 **Produto:** ${product.name}\n` +
                            `💰 **Valor:** R$ ${product.price.toFixed(2)}\n` +
                            `🎮 **Personagem:** ${characterName}\n` +
                            `🌍 **Servidor:** ${server}\n` +
                            `📅 **Data:** ${new Date().toLocaleString('pt-BR')}`
                        )
                        .setTimestamp();

                    await adminChannel.send({ embeds: [adminEmbed] });
                }
            } catch (err) {
                console.error('❌ Failed to send admin notification:', err.message);
            }
        }

    } catch (error) {
        console.error('❌ Error creating order:', error);
        await interaction.editReply({
            content: `❌ Erro ao criar pedido: ${error.message}`,
            flags: 64
        });
    }
}

// ==========================================
// 📋 MY ORDERS BUTTON
// ==========================================

async function handleMyOrdersButton(interaction) {
    await interaction.deferReply({ flags: 64 });

    const orders = goldShop.getUserOrders(interaction.user.id);

    if (orders.length === 0) {
        return interaction.editReply({
            content: '📭 Você ainda não fez nenhum pedido.',
            flags: 64
        });
    }

    const embed = new EmbedBuilder()
        .setColor(0xFEE75C)
        .setTitle('📋 Meus Pedidos')
        .setDescription(`Total: **${orders.length}** pedido(s)`)
        .setTimestamp();

    for (const order of orders.slice(0, 10)) {
        const statusEmoji = getOrderStatusEmoji(order.status);
        const date = new Date(order.createdAt).toLocaleString('pt-BR');
        embed.addFields({
            name: `${statusEmoji} ${order.orderId} - ${order.productName}`,
            value: `📅 ${date}\n💰 R$ ${order.price.toFixed(2)} | 📌 **${getOrderStatusText(order.status)}**`,
            inline: false
        });
    }

    await interaction.editReply({
        embeds: [embed],
        components: [
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('gold-shop-back')
                    .setLabel('🛒 Voltar à Loja')
                    .setStyle(ButtonStyle.Secondary)
            )
        ],
        flags: 64
    });
}

// ==========================================
// 🔙 BACK TO SHOP
// ==========================================

async function handleShopBack(interaction) {
    await interaction.deferReply({ flags: 64 });

    const embed = buildCatalogEmbed();
    const components = buildCatalogButtons();

    await interaction.editReply({
        embeds: [embed],
        components
    });
}

// ==========================================
// ✅ DELIVER BUTTON (Admin)
// ==========================================

async function handleDeliverButton(interaction) {
    const isAdmin = interaction.member.roles.cache.has(process.env.GOLD_ADMIN_ROLE_ID || '') ||
                    interaction.member.permissions.has('ManageMessages');

    if (!isAdmin) {
        return interaction.reply({
            content: '❌ Você não tem permissão para isso.',
            flags: 64
        });
    }

    const orderId = interaction.customId.replace('gold-deliver-', '');
    const order = goldShop.getOrder(orderId);

    if (!order) {
        return interaction.update({
            content: '❌ Pedido não encontrado.',
            components: [],
            flags: 64
        });
    }

    if (order.status !== 'paid') {
        return interaction.reply({
            content: `❌ Este pedido está como **${order.status}**.`,
            flags: 64
        });
    }

    goldShop.markOrderAsDelivered(orderId, interaction.user.tag);

    await interaction.update({
        content: `✅ Pedido **${orderId}** marcado como entregue!`,
        components: [],
        flags: 64
    });

    // Notify user
    try {
        const user = await interaction.client.users.fetch(order.userId);
        await user.send({
            content: `✅ **Pedido ${orderId} Entregue!**\n\n💛 ${order.productName} para o personagem **${order.characterName}** foi entregue com sucesso!\n\n💰 **Valor:** R$ ${order.price.toFixed(2)}\n👑 **Entregue por:** ${interaction.user.tag}\n\nObrigado pela preferência! 🙏`
        });
    } catch { /* DM might fail */ }
}

// ==========================================
// 🔄 TOGGLE PRODUCT (Admin)
// ==========================================

async function handleToggleProduct(interaction) {
    const isAdmin = interaction.member.roles.cache.has(process.env.GOLD_ADMIN_ROLE_ID || '') ||
                    interaction.member.permissions.has('ManageMessages');

    if (!isAdmin) {
        return interaction.reply({
            content: '❌ Você não tem permissão para isso.',
            flags: 64
        });
    }

    const productId = interaction.customId.replace('gold-toggle-', '');
    const product = goldShop.toggleProduct(productId);

    await interaction.update({
        content: `✅ Produto **${product.name}** ${product.active ? 'ativado' : 'desativado'}!`,
        components: [],
        flags: 64
    });
}

// ==========================================
// 👑 ADMIN MENU (from panel button)
// ==========================================

async function handleAdminMenu(interaction) {
    const isAdmin = interaction.member.roles.cache.has(process.env.GOLD_ADMIN_ROLE_ID || '') ||
                    interaction.member.permissions.has('ManageMessages');

    if (!isAdmin) {
        return interaction.reply({
            content: '❌ Você não tem permissão de administrador.',
            flags: 64
        });
    }

    const stats = goldShop.getShopStats();

    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('👑 Admin - Gold Shop')
        .setDescription('Painel de administração da Gold Shop.')
        .addFields(
            { name: '📊 Estatísticas', value: `📦 ${stats.totalOrders} pedidos | 💰 ${stats.paid} aguardando entrega | ✅ ${stats.delivered} entregues`, inline: false }
        )
        .setTimestamp();

    const components = [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('gold-stats')
                .setLabel('📊 Estatísticas')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('gold-pending-orders')
                .setLabel('📋 Pedidos Pendentes')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('gold-manage-products')
                .setLabel('🏪 Produtos')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('gold-shop-back')
                .setLabel('🔙 Voltar')
                .setStyle(ButtonStyle.Danger)
        )
    ];

    await interaction.reply({
        embeds: [embed],
        components,
        flags: 64
    });
}

// ==========================================
// 📊 ADMIN STATS BUTTON
// ==========================================

async function handleAdminStatsButton(interaction) {
    const isAdmin = interaction.member.roles.cache.has(process.env.GOLD_ADMIN_ROLE_ID || '') ||
                    interaction.member.permissions.has('ManageMessages');
    if (!isAdmin) return interaction.reply({ content: '❌ Sem permissão.', flags: 64 });

    const stats = goldShop.getShopStats();
    const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle('📊 Estatísticas da Gold Shop')
        .addFields(
            { name: '📦 Total de Pedidos', value: String(stats.totalOrders), inline: true },
            { name: '⏳ Pendentes', value: String(stats.pending), inline: true },
            { name: '💰 Aguardando Entrega', value: String(stats.paid), inline: true },
            { name: '✅ Entregues', value: String(stats.delivered), inline: true },
            { name: '❌ Cancelados', value: String(stats.cancelled), inline: true },
            { name: '📊 Receita Total', value: `R$ ${stats.totalRevenue.toFixed(2)}`, inline: false }
        )
        .setTimestamp();

    await interaction.reply({ embeds: [embed], flags: 64 });
}

// ==========================================
// 📋 ADMIN PENDING ORDERS BUTTON
// ==========================================

async function handleAdminPendingButton(interaction) {
    const isAdmin = interaction.member.roles.cache.has(process.env.GOLD_ADMIN_ROLE_ID || '') ||
                    interaction.member.permissions.has('ManageMessages');
    if (!isAdmin) return interaction.reply({ content: '❌ Sem permissão.', flags: 64 });

    const pendingOrders = goldShop.getPendingOrders();

    if (pendingOrders.length === 0) {
        return interaction.reply({ content: '✅ Nenhum pedido aguardando entrega!', flags: 64 });
    }

    const embed = new EmbedBuilder()
        .setColor(0xFEE75C)
        .setTitle('📋 Pedidos Aguardando Entrega')
        .setDescription(`**${pendingOrders.length}** pedido(s) pago(s) aguardando entrega.`)
        .setTimestamp();

    for (const order of pendingOrders.slice(0, 5)) {
        embed.addFields({
            name: `💰 ${order.orderId} - ${order.productName}`,
            value: `👤 <@${order.userId}>\n🎮 ${order.characterName}\n💳 ${new Date(order.paidAt).toLocaleString('pt-BR')}`,
            inline: false
        });
    }

    const components = pendingOrders.slice(0, 5).map(order =>
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`gold-deliver-${order.orderId}`)
                .setLabel(`✅ Entregar ${order.orderId}`)
                .setStyle(ButtonStyle.Success)
        )
    );

    await interaction.reply({ embeds: [embed], components, flags: 64 });
}

// ==========================================
// 🏪 ADMIN PRODUCTS BUTTON
// ==========================================

async function handleAdminProductsButton(interaction) {
    const isAdmin = interaction.member.roles.cache.has(process.env.GOLD_ADMIN_ROLE_ID || '') ||
                    interaction.member.permissions.has('ManageMessages');
    if (!isAdmin) return interaction.reply({ content: '❌ Sem permissão.', flags: 64 });

    const products = goldShop.getAllProducts();

    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('🏪 Gerenciar Produtos')
        .setDescription('Clique em um produto para editar, ou use os botões abaixo.')
        .setTimestamp();

    for (const product of products) {
        embed.addFields({
            name: `${product.id} — ${product.name}`,
            value: `💛 **${(product.amount / 1000000).toFixed(1)}M Gold** — 💰 **R$ ${product.price.toFixed(2)}** — ${product.active ? '✅' : '❌'}`,
            inline: false
        });
    }

    const components = [];

    // Row 1: Toggle active/inactive for each product
    const toggleRow = new ActionRowBuilder();
    for (const product of products.slice(0, 5)) {
        toggleRow.addComponents(
            new ButtonBuilder()
                .setCustomId(`gold-toggle-${product.id}`)
                .setLabel(product.active ? `❌ ${product.name}` : `✅ ${product.name}`)
                .setStyle(product.active ? ButtonStyle.Danger : ButtonStyle.Success)
        );
    }
    if (products.length > 0) components.push(toggleRow);

    // Row 2: Edit price for each product
    const editRow = new ActionRowBuilder();
    for (const product of products.slice(0, 5)) {
        editRow.addComponents(
            new ButtonBuilder()
                .setCustomId(`gold-edit-price-${product.id}`)
                .setLabel(`💰 ${product.name}`)
                .setStyle(ButtonStyle.Secondary)
        );
    }
    if (products.length > 0) components.push(editRow);

    // Row 3: Delete and Add new
    const actionRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('gold-add-product')
                .setLabel('➕ Novo Produto')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('gold-refresh-panel')
                .setLabel('🔄 Atualizar Painel')
                .setStyle(ButtonStyle.Primary)
        );
    // Add delete buttons if more than default products
    if (products.some(p => !['gold_100k', 'gold_500k', 'gold_1m', 'gold_2m', 'gold_5m', 'gold_10m'].includes(p.id))) {
        actionRow.addComponents(
            new ButtonBuilder()
                .setCustomId('gold-delete-menu')
                .setLabel('🗑️ Remover')
                .setStyle(ButtonStyle.Danger)
        );
    }
    components.push(actionRow);

    await interaction.reply({ embeds: [embed], components, flags: 64 });
}

// ==========================================
// ➕ ADD PRODUCT BUTTON → opens modal
// ==========================================

async function handleAddProductButton(interaction) {
    const isAdmin = interaction.member.roles.cache.has(process.env.GOLD_ADMIN_ROLE_ID || '') ||
                    interaction.member.permissions.has('ManageMessages');
    if (!isAdmin) return interaction.reply({ content: '❌ Sem permissão.', flags: 64 });

    const modal = new ModalBuilder()
        .setCustomId('gold-modal-add-product')
        .setTitle('➕ Novo Produto');

    const idInput = new TextInputBuilder()
        .setCustomId('gold-product-id')
        .setLabel('ID do produto (ex: gold_3m)')
        .setPlaceholder('gold_3m')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMinLength(3)
        .setMaxLength(30);

    const nameInput = new TextInputBuilder()
        .setCustomId('gold-product-name')
        .setLabel('Nome (ex: 💛 3M Gold)')
        .setPlaceholder('💛 3M Gold')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMinLength(2)
        .setMaxLength(50);

    const amountInput = new TextInputBuilder()
        .setCustomId('gold-product-amount')
        .setLabel('Quantidade de Gold (ex: 3000000)')
        .setPlaceholder('3000000')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

    const priceInput = new TextInputBuilder()
        .setCustomId('gold-product-price')
        .setLabel('Preço em R$ (ex: 120.00)')
        .setPlaceholder('120.00')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

    modal.addComponents(
        new ActionRowBuilder().addComponents(idInput),
        new ActionRowBuilder().addComponents(nameInput),
        new ActionRowBuilder().addComponents(amountInput),
        new ActionRowBuilder().addComponents(priceInput)
    );

    await interaction.showModal(modal);
}

// ==========================================
// 💰 EDIT PRICE BUTTON → opens modal
// ==========================================

async function handleEditPriceButton(interaction) {
    const isAdmin = interaction.member.roles.cache.has(process.env.GOLD_ADMIN_ROLE_ID || '') ||
                    interaction.member.permissions.has('ManageMessages');
    if (!isAdmin) return interaction.reply({ content: '❌ Sem permissão.', flags: 64 });

    const productId = interaction.customId.replace('gold-edit-price-', '');
    const product = goldShop.getProduct(productId);
    if (!product) return interaction.reply({ content: '❌ Produto não encontrado.', flags: 64 });

    const modal = new ModalBuilder()
        .setCustomId(`gold-modal-edit-price-${productId}`)
        .setTitle(`Editar Preço - ${product.name}`);

    const priceInput = new TextInputBuilder()
        .setCustomId('gold-new-price')
        .setLabel('Novo preço em R$')
        .setPlaceholder(String(product.price))
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(priceInput));
    await interaction.showModal(modal);
}

// ==========================================
// 🗑️ DELETE MENU → select menu
// ==========================================

async function handleDeleteMenu(interaction) {
    const isAdmin = interaction.member.roles.cache.has(process.env.GOLD_ADMIN_ROLE_ID || '') ||
                    interaction.member.permissions.has('ManageMessages');
    if (!isAdmin) return interaction.reply({ content: '❌ Sem permissão.', flags: 64 });

    const products = goldShop.getAllProducts();
    const deletable = products.filter(p => !['gold_100k', 'gold_500k', 'gold_1m', 'gold_2m', 'gold_5m', 'gold_10m'].includes(p.id));

    if (deletable.length === 0) {
        return interaction.reply({ content: '❌ Não há produtos personalizados para remover.', flags: 64 });
    }

    const options = deletable.map(p => ({
        label: `${p.name} - R$ ${p.price.toFixed(2)}`,
        description: `${(p.amount / 1000000).toFixed(1)}M Gold`,
        value: `gold-del-prod-${p.id}`
    }));

    const select = new StringSelectMenuBuilder()
        .setCustomId('gold-select-delete')
        .setPlaceholder('Selecione o produto para remover...')
        .addOptions(options);

    await interaction.reply({
        content: '🗑️ **Selecione o produto que deseja remover permanentemente:**',
        components: [new ActionRowBuilder().addComponents(select)],
        flags: 64
    });
}

// ==========================================
// 🗑️ CONFIRM DELETE
// ==========================================

async function handleSelectDelete(interaction) {
    const isAdmin = interaction.member.roles.cache.has(process.env.GOLD_ADMIN_ROLE_ID || '') ||
                    interaction.member.permissions.has('ManageMessages');
    if (!isAdmin) return interaction.reply({ content: '❌ Sem permissão.', flags: 64 });

    const value = interaction.values[0];
    const productId = value.replace('gold-del-prod-', '');
    const product = goldShop.getProduct(productId);
    if (!product) return interaction.update({ content: '❌ Produto não encontrado.', components: [], flags: 64 });

    goldShop.deleteProduct(productId);

    await interaction.update({
        content: `✅ Produto **${product.name}** removido permanentemente!`,
        components: [],
        flags: 64
    });
}

// ==========================================
// 🔄 REFRESH PANEL
// ==========================================

async function handleRefreshPanel(interaction) {
    const isAdmin = interaction.member.roles.cache.has(process.env.GOLD_ADMIN_ROLE_ID || '') ||
                    interaction.member.permissions.has('ManageMessages');
    if (!isAdmin) return interaction.reply({ content: '❌ Sem permissão.', flags: 64 });

    const panelRef = goldShop.getPanelRef();
    if (!panelRef) {
        return interaction.reply({ content: '❌ Nenhum painel gold encontrado. Use `!goldshop` para criar um.', flags: 64 });
    }

    await interaction.deferReply({ flags: 64 });

    try {
        const channel = await interaction.client.channels.fetch(panelRef.channelId);
        if (!channel) throw new Error('Canal não encontrado');

        const msg = await channel.messages.fetch(panelRef.messageId);
        if (!msg) throw new Error('Mensagem não encontrada');

        await msg.edit({ embeds: [buildGoldPanelEmbed()], components: buildGoldPanelButtons() });

        await interaction.editReply({ content: '✅ Painel gold shop atualizado com sucesso!', flags: 64 });
    } catch (err) {
        goldShop.clearPanelRef();
        await interaction.editReply({ content: `❌ Erro ao atualizar painel: ${err.message}. Use \`!goldshop\` para recriar.`, flags: 64 });
    }
}

// ==========================================
// 🔄 REFRESH ORDER STATUS
// ==========================================

async function handleRefreshOrder(interaction) {
    const orderId = interaction.customId.replace('gold-refresh-order-', '');
    const order = goldShop.getOrder(orderId);

    if (!order) {
        return interaction.reply({
            content: '❌ Pedido não encontrado.',
            flags: 64
        });
    }

    // Only the order owner can refresh
    if (order.userId !== interaction.user.id) {
        return interaction.reply({
            content: '❌ Este pedido não pertence a você.',
            flags: 64
        });
    }

    await interaction.deferReply({ flags: 64 });

    const embed = buildOrderEmbed(order);

    await interaction.editReply({
        embeds: [embed],
        components: order.status === 'pending'
            ? [
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`gold-refresh-order-${order.orderId}`)
                        .setLabel('🔄 Atualizar Status')
                        .setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder()
                        .setCustomId(`gold-cancel-order-${order.orderId}`)
                        .setLabel('❌ Cancelar Pedido')
                        .setStyle(ButtonStyle.Danger)
                )
            ]
            : [],
        flags: 64
    });
}

// ==========================================
// ❌ CANCEL ORDER FROM DM
// ==========================================

async function handleCancelOrderButton(interaction) {
    const orderId = interaction.customId.replace('gold-cancel-order-', '');
    const order = goldShop.getOrder(orderId);

    if (!order) {
        return interaction.reply({
            content: '❌ Pedido não encontrado.',
            flags: 64
        });
    }

    if (order.userId !== interaction.user.id) {
        return interaction.reply({
            content: '❌ Este pedido não pertence a você.',
            flags: 64
        });
    }

    if (order.status !== 'pending') {
        return interaction.reply({
            content: `❌ Não é possível cancelar um pedido com status **${order.status}**.`,
            flags: 64
        });
    }

    goldShop.cancelOrder(orderId, 'Cancelado pelo comprador');

    await interaction.update({
        content: `✅ Pedido **${orderId}** cancelado com sucesso!`,
        components: [],
        flags: 64
    });
}

// ==========================================
// ➕ ADD PRODUCT MODAL SUBMIT
// ==========================================

async function handleAddProductModal(interaction) {
    const isAdmin = interaction.member.roles.cache.has(process.env.GOLD_ADMIN_ROLE_ID || '') ||
                    interaction.member.permissions.has('ManageMessages');
    if (!isAdmin) return interaction.reply({ content: '❌ Sem permissão.', flags: 64 });

    const id = interaction.fields.getTextInputValue('gold-product-id').trim().replace(/\s+/g, '_').toLowerCase();
    const name = interaction.fields.getTextInputValue('gold-product-name').trim();
    const amountStr = interaction.fields.getTextInputValue('gold-product-amount').trim();
    const priceStr = interaction.fields.getTextInputValue('gold-product-price').trim();

    const amount = parseInt(amountStr, 10);
    const price = parseFloat(priceStr);

    if (isNaN(amount) || amount <= 0) {
        return interaction.reply({ content: '❌ Quantidade de Gold inválida.', flags: 64 });
    }
    if (isNaN(price) || price <= 0) {
        return interaction.reply({ content: '❌ Preço inválido.', flags: 64 });
    }

    try {
        const product = goldShop.addProduct(id, name, amount, price);
        await interaction.reply({
            content: `✅ Produto **${product.name}** adicionado com sucesso!\n💛 ${(product.amount / 1000000).toFixed(1)}M Gold — 💰 R$ ${product.price.toFixed(2)}\n🔄 Use o botão **Atualizar Painel** para refletir as mudanças.`,
            flags: 64
        });
    } catch (err) {
        await interaction.reply({ content: `❌ ${err.message}`, flags: 64 });
    }
}

// ==========================================
// 💰 EDIT PRICE MODAL SUBMIT
// ==========================================

async function handleEditPriceModal(interaction) {
    const isAdmin = interaction.member.roles.cache.has(process.env.GOLD_ADMIN_ROLE_ID || '') ||
                    interaction.member.permissions.has('ManageMessages');
    if (!isAdmin) return interaction.reply({ content: '❌ Sem permissão.', flags: 64 });

    const productId = interaction.customId.replace('gold-modal-edit-price-', '');
    const priceStr = interaction.fields.getTextInputValue('gold-new-price').trim();
    const price = parseFloat(priceStr);

    if (isNaN(price) || price <= 0) {
        return interaction.reply({ content: '❌ Preço inválido.', flags: 64 });
    }

    try {
        const product = goldShop.updateProductPrice(productId, price);
        await interaction.reply({
            content: `✅ Preço do **${product.name}** atualizado para **R$ ${product.price.toFixed(2)}**!\n🔄 Use o botão **Atualizar Painel** para refletir as mudanças.`,
            flags: 64
        });
    } catch (err) {
        await interaction.reply({ content: `❌ ${err.message}`, flags: 64 });
    }
}
