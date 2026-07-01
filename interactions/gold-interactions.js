// ==========================================
// 🛒 GOLD SHOP INTERACTIONS
// Buttons, modals, select menus
// ==========================================

import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import fs from 'fs';
import path from 'path';
import * as goldShop from '../gold-shop.js';
import { createPixPayment, initMercadoPago } from '../mercadopago.js';
import { getServerBaseUrl } from '../webhook-server.js';

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

export function buildOrderEmbed(order) {
    const statusEmoji = getOrderStatusEmoji(order.status);
    const statusText = getOrderStatusText(order.status);

    const colors = {
        'delivered': 0x57F287,
        'paid': 0xFEE75C,
        'cancelled': 0xED4245,
        'pending': 0x5865F2
    };

    const embed = new EmbedBuilder()
        .setColor(colors[order.status] || 0x5865F2)
        .setTitle(`${statusEmoji} Pedido ${order.orderId}`)
        .setDescription(`> ${order.productName}`)
        .setTimestamp()
        .addFields(
            { name: '💛 Gold', value: `\`${(order.goldAmount / 1000000).toFixed(2)}M\``, inline: true },
            { name: '💰 Valor', value: `\`R$ ${order.price.toFixed(2)}\``, inline: true },
            { name: '📌 Status', value: `**${statusEmoji} ${statusText}**`, inline: false },
            { name: '🎮 Personagem', value: `\`${order.characterName}\``, inline: true },
            { name: '🌍 Servidor', value: `\`${order.server}\``, inline: true },
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
            const barLen = 10;
            const totalSecs = 30 * 60;
            const filled = Math.round((remaining / totalSecs) * barLen);
            const bar = '🟩'.repeat(filled) + '⬜'.repeat(barLen - filled);
            embed.addFields({
                name: '⏳ PIX Expira em',
                value: `${bar}\n\`${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s\``,
                inline: false
            });
        } else {
            embed.addFields({
                name: '⏳ PIX Expirado',
                value: '> O QR Code PIX expirou. Crie um novo pedido.',
                inline: false
            });
        }
    }

    embed.setFooter({
        text: `Gold Shop • ${order.orderId}`
    });

    return embed;
}

// ==========================================
// 🏪 GOLD PANEL (persistent, for !goldshop command)
// ==========================================

/** Renders the persistent gold shop panel embed */
export function buildGoldPanelEmbed() {
    const stock = goldShop.getGoldStock();
    const pricing = goldShop.getPricingInfo();

    const tBody = pricing.map((p) => `${p.label} \n> **${p.price}** / ${p.per}`).join('\n\n');

    const stockBar = stock > 0
        ? `🟢 **${stock.toLocaleString()} gold** disponíveis`
        : '🔴 **Estoque esgotado** — aguarde reposição';

    const embed = new EmbedBuilder()
        .setColor(0xFFD700)
        .setTitle('✨ Gold Shop — MIR4')
        .setDescription(
            `### ⚡ Compre Gold com PIX!\n\n` +
            `📦 **Estoque:** ${stockBar}\n\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `### 📊 Tabela de Preços\n` +
            `*(por unidade de 1.053 gold)*\n\n` +
            `${tBody}\n\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
            `💎 **Quanto mais gold, menor o preço por unidade!**\n` +
            `🔹 Pagamento via **PIX** (Mercado Pago)\n` +
            `🔹 Entrega **rápida** após confirmação\n` +
            `🔹 Suporte via ticket caso tenha dúvidas`
        )
        .setTimestamp();

    embed.setFooter({
        text: stock > 0 ? `💛 ${stock.toLocaleString()} gold em estoque` : '⚠️ Estoque vazio — aguarde reposição'
    });

    return embed;
}

/** Renders the persistent gold shop panel buttons */
export function buildGoldPanelButtons() {
    const stock = goldShop.getGoldStock();
    const rows = [];

    // Buy button
    const buyRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('gold-buy-custom')
            .setLabel(`💛 Comprar Gold${stock > 0 ? ` (${stock.toLocaleString()} disp.)` : ''}`)
            .setStyle(stock > 0 ? ButtonStyle.Success : ButtonStyle.Secondary)
            .setDisabled(stock <= 0)
    );
    rows.push(buyRow);

    // Quick buy options: 1053, 2106, 3159, 5000, 10000
    if (stock > 0) {
        const quickAmounts = [
            goldShop.GOLD_UNIT,           // 1k
            goldShop.GOLD_UNIT * 2,       // 2k
            goldShop.GOLD_UNIT * 3,       // 3k
            goldShop.GOLD_UNIT * 5,       // 5k
            goldShop.GOLD_UNIT * 10       // 10k
        ].filter(a => a <= stock);

        for (let i = 0; i < quickAmounts.length; i += 3) {
            const row = new ActionRowBuilder();
            const batch = quickAmounts.slice(i, i + 3);
            for (const amount of batch) {
                try {
                    const pricing = goldShop.calculatePrice(amount);
                    row.addComponents(
                        new ButtonBuilder()
                            .setCustomId(`gold-quick-${amount}`)
                            .setLabel(`${(amount / goldShop.GOLD_UNIT).toFixed(0)}K gold - ${formatCurrency(pricing.totalPrice)}`)
                            .setStyle(ButtonStyle.Primary)
                    );
                } catch { /* amount exceeds stock or invalid */ }
            }
            if (batch.length > 0) rows.push(row);
        }
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

const GOLD_PREFIXES = ['gold-buy-', 'gold-quick-', 'gold-my-orders', 'gold-shop-back', 'gold-deliver-', 'gold-cancel-order-', 'gold-refresh-order-', 'gold-admin-menu', 'gold-stats', 'gold-pending-orders', 'gold-refresh-panel', 'gold-set-stock', 'gold-show-pix-', 'gold-how-to-open-dm'];

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
    if (cid === 'gold-buy-custom') {
        return handleBuyCustom(interaction);
    }
    if (cid.startsWith('gold-quick-')) {
        return handleQuickBuy(interaction);
    }
    if (cid.startsWith('gold-buy-')) {
        return handleBuyCustom(interaction);
    }
    if (cid.startsWith('gold-deliver-')) {
        return handleDeliverButton(interaction);
    }
    if (cid.startsWith('gold-cancel-order-')) {
        return handleCancelOrderButton(interaction);
    }
    if (cid.startsWith('gold-refresh-order-')) {
        return handleRefreshOrder(interaction);
    }
    if (cid.startsWith('gold-show-pix-')) {
        return handleShowPixCode(interaction);
    }
    if (cid === 'gold-how-to-open-dm') {
        return handleHowToOpenDm(interaction);
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
    if (cid === 'gold-set-stock') {
        return handleSetStock(interaction);
    }
    if (cid === 'gold-refresh-panel') {
        return handleRefreshPanel(interaction);
    }

    return false;
}

// ==========================================
// 🛒 CUSTOM BUY (opens modal to enter gold amount)
// ==========================================

async function handleBuyCustom(interaction) {
    const stock = goldShop.getGoldStock();
    if (stock <= 0) {
        return interaction.reply({ content: '❌ Estoque vazio no momento. Aguarde reposição.', flags: 64 });
    }

    const mpReady = !!process.env.MERCADO_PAGO_ACCESS_TOKEN;
    if (!mpReady) {
        return interaction.reply({ content: '❌ Sistema de pagamento não configurado.', flags: 64 });
    }

    const modal = new ModalBuilder()
        .setCustomId('gold-modal-buy-custom')
        .setTitle('💛 Comprar Gold');

    const goldInput = new TextInputBuilder()
        .setCustomId('gold-amount')
        .setLabel(`Qtd gold (Mín: ${goldShop.GOLD_UNIT}, Disp: ${stock})`)
        .setPlaceholder(`Ex: ${goldShop.GOLD_UNIT}`)
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

    modal.addComponents(
        new ActionRowBuilder().addComponents(goldInput)
    );

    await interaction.showModal(modal);
}

// ==========================================
// ⚡ QUICK BUY (pre-defined amounts)
// ==========================================

async function handleQuickBuy(interaction) {
    const amount = parseInt(interaction.customId.replace('gold-quick-', ''), 10);
    if (isNaN(amount) || amount <= 0) {
        return interaction.reply({ content: '❌ Quantidade inválida.', flags: 64 });
    }

    const stock = goldShop.getGoldStock();
    if (amount > stock) {
        return interaction.reply({ content: `❌ Estoque insuficiente. Disponível: ${stock.toLocaleString()} gold.`, flags: 64 });
    }

    const mpReady = !!process.env.MERCADO_PAGO_ACCESS_TOKEN;
    if (!mpReady) {
        return interaction.reply({ content: '❌ Sistema de pagamento não configurado.', flags: 64 });
    }

    // Process directly — no modal needed since amount is pre-defined
    await processBuyOrder(interaction, amount);
}

// ==========================================
// 📝 HANDLE MODAL SUBMIT
// ==========================================

export async function handleGoldModalSubmit(interaction) {
    const modalId = interaction.customId;

    // ── Handle set stock modal ──
    if (modalId === 'gold-modal-set-stock') {
        return handleSetStockModal(interaction);
    }

    // ── Handle custom buy ──
    if (modalId === 'gold-modal-buy-custom') {
        return processBuyOrder(interaction, null);
    }

    // ── Handle quick buy ──
    // ── Note: quick buy no longer opens a modal — processed directly in handleQuickBuy
    if (modalId.startsWith('gold-modal-quick-')) {
        const amount = parseInt(modalId.replace('gold-modal-quick-', ''), 10);
        return processBuyOrder(interaction, amount);
    }

    // ── Handle show PIX code modal (just acknowledge, no data to process)
    if (modalId.startsWith('gold-modal-pix-code-')) {
        await interaction.deferUpdate();
        return;
    }

    return false;
}

/**
 * Process a buy order with dynamic pricing
 */
async function processBuyOrder(interaction, fixedAmount) {
    // Character name and server are no longer asked — use defaults
    const characterName = 'N/A';
    const server = 'N/A';

    // Get gold amount from modal or fixed
    let goldAmount;
    if (fixedAmount) {
        goldAmount = fixedAmount;
    } else {
        const amountStr = interaction.fields.getTextInputValue('gold-amount').trim().replace(/\./g, '').replace(/,/g, '');
        goldAmount = parseInt(amountStr, 10);
        if (isNaN(goldAmount) || goldAmount <= 0) {
            return interaction.reply({ content: '❌ Quantidade de gold inválida.', flags: 64 });
        }
    }

    // ── Separate deferReply try/catch to handle Discord API timeouts gracefully ──
    let deferred = false;
    try {
        await interaction.deferReply({ flags: 64 });
        deferred = true;
    } catch {
        // defer may fail due to Discord timeout — order is still created below
        console.warn('⚠️ deferReply failed (Discord timeout), continuing without acknowledgment...');
    }

    try {
        // Calculate price dynamically
        const pricing = goldShop.calculatePrice(goldAmount);

        // Create order using the new dynamic order function
        const order = goldShop.createDynamicOrder(
            interaction.user.id,
            interaction.user.tag,
            pricing.goldAmount,
            pricing.totalPrice,
            characterName,
            server,
            `${pricing.tierLabel} | ${pricing.units} unidade(s) de ${goldShop.GOLD_UNIT}`
        );

        // Initialize Mercado Pago if needed
        initMercadoPago();

        // Create PIX payment
        const pixResult = await createPixPayment(
            pricing.totalPrice,
            `MIR4 Gold - ${goldAmount.toLocaleString()} - ${order.orderId}`,
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

        // ====================================================
        // Embed 1: Success message (green)
        // ====================================================
        const embedSucesso = new EmbedBuilder()
            .setColor(0x2ECC71)
            .setTitle('✅ Pedido Gerado com Sucesso!')
            .setDescription(
                `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                `### 💳 Pagamento PIX\n\n` +
                `💵 **Valor:** \`R$ ${pricing.totalPrice.toFixed(2)}\`\n` +
                `🔹 Pague via **QR Code** ou **Copia e Cola**\n\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                `### ⏰ Prazo\n\n` +
                `> **Este pedido expira em 30 minutos!**\n` +
                `> Após o prazo, o PIX será cancelado automaticamente.\n\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                `### 📬 Entrega\n\n` +
                `> 🟢 **Mantenha sua DM aberta** para receber o produto!\n` +
                `> 📩 Você será notificado assim que o pagamento for confirmado.`
            );

        // ====================================================
        // Embed 2: Order info (dark) — QR code as thumbnail
        // ====================================================
        const embedInfo = new EmbedBuilder()
            .setColor(0x111214)
            .setTitle('⭐ Informações do Pedido')
            .setDescription(
                `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                `> **🆔 ${order.orderId}**\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                `### 📦 Produto\n` +
                `> 💛 **${pricing.goldAmount.toLocaleString()} Gold**\n` +
                `> 📊 ${pricing.tierLabel}\n\n` +
                `### 💰 Resumo\n`
            )
            .addFields(
                { name: '💵 Subtotal', value: `\`R$ ${pricing.totalPrice.toFixed(2)}\``, inline: true },
                { name: '🛒 Valor Total', value: `\`R$ ${pricing.totalPrice.toFixed(2)}\``, inline: true }
            );

        // ====================================================
        // Action buttons
        // ====================================================
        const botoes = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`gold-show-pix-${order.orderId}`)
                .setLabel('PIX Copia e cola')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('gold-how-to-open-dm')
                .setLabel('Como abrir a DM')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setLabel('Pagar pelo site')
                .setURL(pixResult.ticketUrl || 'https://www.mercadopago.com.br/ajuda/pix')
                .setStyle(ButtonStyle.Link),
            new ButtonBuilder()
                .setCustomId(`gold-cancel-order-${order.orderId}`)
                .setLabel('Cancelar')
                .setStyle(ButtonStyle.Danger)
        );

        // Save QR code to local file and serve via Express (no Discord CDN upload)
        if (order.pixQrCode) {
            try {
                const qrDir = path.resolve('./qr-codes');
                if (!fs.existsSync(qrDir)) {
                    fs.mkdirSync(qrDir, { recursive: true });
                }
                const qrBuffer = Buffer.from(order.pixQrCode, 'base64');
                const qrFilename = `pix-qr-${order.orderId}.png`;
                fs.writeFileSync(path.join(qrDir, qrFilename), qrBuffer);

                const baseUrl = await getServerBaseUrl();
                const qrUrl = `${baseUrl}/qr/${qrFilename}`;
                embedInfo.setThumbnail(qrUrl);
            } catch (qrErr) {
                console.error('⚠️ [Gold Shop] Failed to save/serve QR code:', qrErr.message);
                if (pixResult.ticketUrl) {
                    embedInfo.setThumbnail(pixResult.ticketUrl);
                }
            }
        }

        // Send the response (no files — QR is served by Express)
        const replyPayload = {
            content: `${interaction.user}`,
            embeds: [embedSucesso, embedInfo],
            components: [botoes]
        };

        if (deferred) {
            await interaction.editReply(replyPayload);
        } else {
            await interaction.reply({ ...replyPayload, flags: 64 });
        }

        // Notify admin channel (non-critical, don't block on failure)
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
                            `💛 **Gold:** ${pricing.goldAmount.toLocaleString()}\n` +
                            `💰 **Valor:** R$ ${pricing.totalPrice.toFixed(2)}\n` +
                            `📊 **Tier:** ${pricing.tierLabel}\n` +
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
        // ── Detailed debug log ──
        console.error('❌ [Gold Shop] Error creating order');
        console.error(`  👤 User: ${interaction.user.tag} (${interaction.user.id})`);
        console.error(`  💛 Gold: ${goldAmount.toLocaleString()} | 🌍 Server: ${server} | 🎮 Char: ${characterName}`);
        console.error(`  🏷️ Error: ${error.name} — ${error.message}`);
        console.error(`  🔄 Deferred: ${deferred} | 🆔 Interaction: ${interaction.id} | 📺 Channel: ${interaction.channelId}`);
        console.error(`  🕐 Timestamp: ${new Date().toISOString()}`);
        console.error('📋 [Gold Shop] Stack trace:');
        console.error(error.stack);
        if (error.response?.data) {
            console.error('📋 [Gold Shop] API response data (e.g. Mercado Pago):', JSON.stringify(error.response.data, null, 2));
        }

        // Try to send error feedback — handle AbortError separately
        try {
            const errorMsg = error.name === 'AbortError'
                ? '❌ Tempo limite excedido. O pedido foi criado! Use /orders para ver seus pedidos e copiar o código PIX.'
                : `❌ Erro ao criar pedido: ${error.message}`;

            if (deferred) {
                await interaction.editReply({ content: errorMsg, flags: 64 });
            } else if (!interaction.replied) {
                await interaction.reply({ content: errorMsg, flags: 64 });
            }
        } catch { /* interaction may have already expired */ }
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

    const embed = buildGoldPanelEmbed();
    const components = buildGoldPanelButtons();

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

    // Deduct gold from stock
    if (order.goldAmount > 0) {
        try { goldShop.deductStock(order.goldAmount); } catch { /* stock already updated manually */ }
    }

    await interaction.update({
        content: `✅ Pedido **${orderId}** marcado como entregue!\n💛 -${order.goldAmount.toLocaleString()} gold do estoque.`,
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
    const stock = goldShop.getGoldStock();

    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('👑 Admin - Gold Shop')
        .setDescription('Painel de administração da Gold Shop.')
        .addFields(
            { name: '💛 Estoque', value: `${stock.toLocaleString()} gold`, inline: true },
            { name: '📊 Estatísticas', value: `📦 ${stats.totalOrders} pedidos | 💰 ${stats.paid} aguardando | ✅ ${stats.delivered} entregues`, inline: false }
        )
        .setTimestamp();

    const components = [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('gold-set-stock')
                .setLabel('💛 Gerenciar Estoque')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('gold-stats')
                .setLabel('📊 Estatísticas')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('gold-pending-orders')
                .setLabel('📋 Pedidos')
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
    const stock = goldShop.getGoldStock();
    const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle('📊 Estatísticas da Gold Shop')
        .addFields(
            { name: '💛 Estoque Atual', value: `${stock.toLocaleString()} gold`, inline: true },
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
// 💛 SET STOCK (admin)
// ==========================================

async function handleSetStock(interaction) {
    const isAdmin = interaction.member.roles.cache.has(process.env.GOLD_ADMIN_ROLE_ID || '') ||
                    interaction.member.permissions.has('ManageMessages');
    if (!isAdmin) return interaction.reply({ content: '❌ Sem permissão.', flags: 64 });

    const currentStock = goldShop.getGoldStock();

    const modal = new ModalBuilder()
        .setCustomId('gold-modal-set-stock')
        .setTitle('💛 Gerenciar Estoque');

    const stockInput = new TextInputBuilder()
        .setCustomId('gold-stock-amount')
        .setLabel('Quantidade total de gold disponível')        
        .setPlaceholder(`Atual: ${currentStock.toLocaleString()}`)
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(stockInput));
    await interaction.showModal(modal);
}

async function handleSetStockModal(interaction) {
    const isAdmin = interaction.member.roles.cache.has(process.env.GOLD_ADMIN_ROLE_ID || '') ||
                    interaction.member.permissions.has('ManageMessages');
    if (!isAdmin) return interaction.reply({ content: '❌ Sem permissão.', flags: 64 });

    const amountStr = interaction.fields.getTextInputValue('gold-stock-amount').trim().replace(/\./g, '').replace(/,/g, '');
    const amount = parseInt(amountStr, 10);

    if (isNaN(amount) || amount < 0) {
        return interaction.reply({ content: '❌ Valor inválido.', flags: 64 });
    }

    goldShop.setGoldStock(amount);

    await interaction.reply({
        content: `✅ Estoque atualizado para **${amount.toLocaleString()} gold**!\n🔄 Use **Atualizar Painel** para refletir no painel público.`,
        flags: 64
    });
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
// 📬 HOW TO OPEN DM
// ==========================================

async function handleHowToOpenDm(interaction) {
    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('📬 Como abrir sua DM')
        .setDescription(
            'Para receber seu produto, você precisa ter as **mensagens diretas** abertas neste servidor.\n\n' +
            '**Passo a passo:**\n' +
            '1️⃣ Clique com botão direito no servidor na lista à esquerda\n' +
            '2️⃣ Vá em **"Configurações de Privacidade"**\n' +
            '3️⃣ Ative a opção **"Permitir mensagens diretas de membros do servidor"**\n\n' +
            '✅ Depois disso, você poderá receber sua entrega por DM!'
        )
        .setTimestamp();

    await interaction.reply({
        embeds: [embed],
        flags: 64
    });
}

// ==========================================
// 📋 SHOW PIX CODE (opens modal with copyable code)
// ==========================================

async function handleShowPixCode(interaction) {
    const orderId = interaction.customId.replace('gold-show-pix-', '');
    const order = goldShop.getOrder(orderId);
    if (!order || !order.pixCopiaCola) {
        return interaction.reply({ content: '❌ Código PIX não encontrado para este pedido.', flags: 64 });
    }

    if (order.userId !== interaction.user.id) {
        return interaction.reply({ content: '❌ Este pedido não pertence a você.', flags: 64 });
    }

    const modal = new ModalBuilder()
        .setCustomId(`gold-modal-pix-code-${orderId}`)
        .setTitle(`PIX - ${orderId}`);

    const pixInput = new TextInputBuilder()
        .setCustomId('gold-pix-code')
        .setLabel('📋 Código PIX (Copie e Cole no app do banco)')
        .setValue(order.pixCopiaCola)
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false);

    modal.addComponents(new ActionRowBuilder().addComponents(pixInput));
    await interaction.showModal(modal);
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
