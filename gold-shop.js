// ==========================================
// 🏪 GOLD SHOP CORE MODULE
// Orders, stock, pricing management
// ==========================================

import fs from 'fs';
import path from 'path';
import { EmbedBuilder } from 'discord.js';
import { isPaymentApproved } from './mercadopago.js';
import 'dotenv/config';

// ==========================================
// 📁 DATABASE PATH
// ==========================================

const GOLD_DB_PATH = path.resolve('./database_gold.json');

// ==========================================
// 🏪 SHOP STATE
// ==========================================

const goldDb = {
    orders: {},
    goldStock: 0,
    config: {
        adminRoleId: process.env.GOLD_ADMIN_ROLE_ID || '',
        adminChannelId: process.env.GOLD_ADMIN_CHANNEL_ID || '',
        webhookSecret: process.env.MERCADO_PAGO_WEBHOOK_SECRET || '',
        nextOrderNumber: 1
    }
};

let saveTimeout = null;

// ==========================================
// 💾 DATABASE PERSISTENCE
// ==========================================

function loadGoldDatabase() {
    try {
        if (fs.existsSync(GOLD_DB_PATH)) {
            const data = JSON.parse(fs.readFileSync(GOLD_DB_PATH, 'utf8'));
            if (data.orders) goldDb.orders = data.orders;
            if (data.config) goldDb.config = { ...goldDb.config, ...data.config };
            if (typeof data.goldStock === 'number') goldDb.goldStock = data.goldStock;
            console.log(`✅ Gold shop database loaded. ${Object.keys(goldDb.orders).length} orders found.`);
        } else {
            saveGoldDatabase();
            console.log('📝 New database_gold.json created.');
        }
    } catch (error) {
        console.error('❌ Error loading gold database:', error.message);
    }
}

function saveGoldDatabase() {
    try {
        if (saveTimeout) clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => {
            fs.writeFileSync(GOLD_DB_PATH, JSON.stringify(goldDb, null, 2), 'utf8');
        }, 200);
    } catch (error) {
        console.error('❌ Error saving gold database:', error.message);
    }
}

// ==========================================
// 📋 ORDER ID GENERATION
// ==========================================

function generateOrderId() {
    const num = goldDb.config.nextOrderNumber++;
    saveGoldDatabase();
    return `GOLD-${String(num).padStart(6, '0')}`;
}

// ==========================================
// 🏪 PUBLIC API
// ==========================================

/** Initialize the gold shop system */
export function initGoldShop() {
    loadGoldDatabase();
    return goldDb;
}

/**
 * Create a dynamic order with custom gold amount and price
 */
export function createDynamicOrder(userId, userName, goldAmount, price, characterName, server, tierLabel) {
    const orderId = generateOrderId();
    const now = new Date().toISOString();

    const order = {
        orderId,
        userId,
        userName,
        productId: 'dynamic',
        productName: `💛 ${goldAmount.toLocaleString()} Gold`,
        goldAmount,
        price: Number(price.toFixed(2)),
        status: 'pending',
        paymentId: null,
        pixQrCode: null,
        pixCopiaCola: null,
        paymentExpiresAt: null,
        characterName,
        server,
        createdAt: now,
        paidAt: null,
        deliveredAt: null,
        deliveredBy: null,
        notes: `📊 ${tierLabel}`
    };

    goldDb.orders[orderId] = order;
    saveGoldDatabase();
    return order;
}

/**
 * Update order with PIX payment info
 */
export function updateOrderPayment(orderId, paymentId, qrCode, qrCodeBase64) {
    const order = goldDb.orders[orderId];
    if (!order) throw new Error('Pedido não encontrado.');

    order.paymentId = paymentId;
    order.pixQrCode = qrCodeBase64;
    order.pixCopiaCola = qrCode;
    order.paymentExpiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    goldDb.orders[orderId] = order;
    saveGoldDatabase();
    return order;
}

/** Mark an order as paid */
export function markOrderAsPaid(orderId) {
    const order = goldDb.orders[orderId];
    if (!order) throw new Error('Pedido não encontrado.');
    if (order.status !== 'pending') return order;

    order.status = 'paid';
    order.paidAt = new Date().toISOString();
    goldDb.orders[orderId] = order;
    saveGoldDatabase();
    return order;
}

/** Mark an order as delivered */
export function markOrderAsDelivered(orderId, deliveredBy) {
    const order = goldDb.orders[orderId];
    if (!order) throw new Error('Pedido não encontrado.');
    if (order.status !== 'paid') {
        throw new Error('O pedido precisa ser pago antes de ser entregue.');
    }

    order.status = 'delivered';
    order.deliveredAt = new Date().toISOString();
    order.deliveredBy = deliveredBy;
    goldDb.orders[orderId] = order;
    saveGoldDatabase();
    return order;
}

/** Cancel an order */
export function cancelOrder(orderId, reason = 'Cancelado pelo admin') {
    const order = goldDb.orders[orderId];
    if (!order) throw new Error('Pedido não encontrado.');
    if (order.status === 'delivered') {
        throw new Error('Não é possível cancelar um pedido já entregue.');
    }

    order.status = 'cancelled';
    order.notes = reason;
    goldDb.orders[orderId] = order;
    saveGoldDatabase();
    return order;
}

/** Get order by ID */
export function getOrder(orderId) {
    return goldDb.orders[orderId] || null;
}

/** Get orders by user ID */
export function getUserOrders(userId) {
    return Object.values(goldDb.orders)
        .filter(o => o.userId === userId)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/** Get all pending orders (paid, awaiting delivery) */
export function getPendingOrders() {
    return Object.values(goldDb.orders)
        .filter(o => o.status === 'paid')
        .sort((a, b) => new Date(a.paidAt) - new Date(b.paidAt));
}

/** Get orders by status */
export function getOrdersByStatus(status) {
    return Object.values(goldDb.orders)
        .filter(o => o.status === status)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/** Get all orders */
export function getAllOrders() {
    return Object.values(goldDb.orders)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/** Update order notes */
export function updateOrderNotes(orderId, notes) {
    const order = goldDb.orders[orderId];
    if (!order) throw new Error('Pedido não encontrado.');
    order.notes = notes;
    goldDb.orders[orderId] = order;
    saveGoldDatabase();
    return order;
}

// ==========================================
// 💰 GOLD STOCK & PRICING
// ==========================================

// 1 "k" no jogo = 1053 gold
// Tiers usam múltiplos de GOLD_UNIT:
//   ≤ 5k (5×1053 = 5265 gold):  R$ 18,00 / 1053
//   ≤ 10k (10×1053 = 10530 gold): R$ 17,00 / 1053
//   > 10k:                        R$ 16,50 / 1053
export const GOLD_UNIT = 1053;

const PRICE_TIERS = [
    { maxGold: 5 * GOLD_UNIT,  pricePerUnit: 18.00 },
    { maxGold: 10 * GOLD_UNIT, pricePerUnit: 17.00 },
    { maxGold: Infinity, pricePerUnit: 16.50 }
];

/** Get current gold stock */
export function getGoldStock() {
    return goldDb.goldStock || 0;
}

/** Set gold stock (admin) */
export function setGoldStock(amount) {
    if (amount < 0) throw new Error('Estoque não pode ser negativo.');
    goldDb.goldStock = Math.floor(amount);
    saveGoldDatabase();
    return goldDb.goldStock;
}

/** Deduct gold from stock after delivery */
export function deductStock(amount) {
    const current = getGoldStock();
    if (current < amount) throw new Error('Estoque insuficiente.');
    goldDb.goldStock = current - amount;
    saveGoldDatabase();
    return goldDb.goldStock;
}

/**
 * Calculate dynamic price based on gold amount and tier
 * Tiers (1k = ${GOLD_UNIT} gold):
 *   ≤ 5k (${(5 * GOLD_UNIT).toLocaleString()} gold): R$ 18,00 per 1053 gold
 *   ≤ 10k (${(10 * GOLD_UNIT).toLocaleString()} gold): R$ 17,00 per 1053 gold
 *   > 10k: R$ 16,50 per 1053 gold
 */
export function calculatePrice(goldAmount) {
    if (goldAmount < GOLD_UNIT) {
        throw new Error(`Mínimo de ${GOLD_UNIT.toLocaleString()} gold por compra.`);
    }

    const stock = getGoldStock();
    if (goldAmount > stock) {
        throw new Error(`Estoque insuficiente. Disponível: ${stock.toLocaleString()} gold.`);
    }

    const tier = PRICE_TIERS.find(t => goldAmount < t.maxGold);
    const pricePerUnit = tier.pricePerUnit;

    const units = goldAmount / GOLD_UNIT;
    const totalPrice = parseFloat((units * pricePerUnit).toFixed(2));

    const fiveK = 5 * GOLD_UNIT;
    const tenK = 10 * GOLD_UNIT;

    const tierLabel = goldAmount < fiveK
        ? '💵 R$ 18,00/un (< 5k)'
        : goldAmount < tenK
            ? '💰 R$ 17,00/un (5k-10k)'
            : '💎 R$ 16,50/un (> 10k)';

    return { goldAmount, units: parseFloat(units.toFixed(2)), pricePerUnit, totalPrice, tierLabel };
}

/** Get pricing tiers for display */
export function getPricingInfo() {
    const fiveK = 5 * GOLD_UNIT;
    const tenK = 10 * GOLD_UNIT;
    return [
        { label: `💵 Até 5k (${fiveK.toLocaleString()} gold)`, price: 'R$ 18,00', per: '1k (1053 gold)' },
        { label: `💰 De 5k a 10k (${fiveK.toLocaleString()} a ${tenK.toLocaleString()} gold)`, price: 'R$ 17,00', per: '1k (1053 gold)' },
        { label: '💎 Acima de 10k (10.530+ gold)', price: 'R$ 16,50', per: '1k (1053 gold)' }
    ];
}

/** Get shop statistics for admin dashboard */
export function getShopStats() {
    const orders = Object.values(goldDb.orders);
    return {
        totalOrders: orders.length,
        pending: orders.filter(o => o.status === 'pending').length,
        paid: orders.filter(o => o.status === 'paid').length,
        delivered: orders.filter(o => o.status === 'delivered').length,
        cancelled: orders.filter(o => o.status === 'cancelled').length,
        totalRevenue: orders
            .filter(o => o.status === 'delivered')
            .reduce((sum, o) => sum + o.price, 0),
        totalGoldSold: orders
            .filter(o => o.status === 'delivered')
            .reduce((sum, o) => sum + o.goldAmount, 0),
        goldStock: getGoldStock()
    };
}

// ==========================================
// 📍 PANEL REFERENCE (persistent panel in Discord)
// ==========================================

export function getPanelRef() {
    return goldDb.config.panelRef || null;
}

export function savePanelRef(channelId, messageId) {
    goldDb.config.panelRef = { channelId, messageId };
    saveGoldDatabase();
}

export function clearPanelRef() {
    delete goldDb.config.panelRef;
    saveGoldDatabase();
}

// ==========================================
// ⏰ EXPIRED PIX AUTO-CANCEL
// ==========================================

let expiredOrdersInterval = null;

export function startExpiredOrdersCheck(client) {
    if (expiredOrdersInterval) {
        clearInterval(expiredOrdersInterval);
    }

    setTimeout(() => {
        console.log('⏰ [Gold Shop] Running initial expired PIX check...');
        checkExpiredOrders(client);
    }, 10 * 1000);

    expiredOrdersInterval = setInterval(() => {
        checkExpiredOrders(client);
    }, 30 * 1000);

    console.log('📅 [Gold Shop] Expired PIX check scheduled: every 30 seconds');
}

async function checkExpiredOrders(client) {
    const now = Date.now();
    let expiredCount = 0;

    for (const [orderId, order] of Object.entries(goldDb.orders)) {
        if (order.status !== 'pending') continue;
        if (!order.paymentExpiresAt) continue;

        const expiresAt = new Date(order.paymentExpiresAt).getTime();
        if (now >= expiresAt) {
            try {
                cancelOrder(orderId, '⏰ PIX expirado');
                expiredCount++;

                if (client && order.userId) {
                    try {
                        const user = await client.users.fetch(order.userId);
                        await user.send({
                            content: `⏰ **Pedido ${orderId} — PIX Expirado**\n\n` +
                                     `O prazo de pagamento do seu pedido expirou.\n` +
                                     `💛 **Gold:** ${order.goldAmount.toLocaleString()}\n` +
                                     `💰 **Valor:** R$ ${order.price.toFixed(2)}\n\n` +
                                     `Você pode criar um novo pedido a qualquer momento na loja! 🛒`
                        });
                    } catch { /* DM may be closed */ }
                }
            } catch (err) {
                console.error(`❌ [Gold Shop] Error cancelling expired order ${orderId}:`, err.message);
            }
        }
    }

    if (expiredCount > 0) {
        console.log(`⏰ [Gold Shop] Auto-cancelled ${expiredCount} expired PIX order(s).`);
    }
}

// ==========================================
// 📊 DAILY SALES REPORT
// ==========================================

let _lastReportDate = null;

/**
 * Get today's sales summary (delivered orders and revenue today).
 */
export function getDailySalesSummary() {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const orders = Object.values(goldDb.orders);

    const todayOrders = orders.filter(o => {
        const createdAt = new Date(o.createdAt);
        return createdAt >= todayStart;
    });

    const deliveredToday = orders.filter(o => {
        if (o.status !== 'delivered' || !o.deliveredAt) return false;
        const deliveredAt = new Date(o.deliveredAt);
        return deliveredAt >= todayStart;
    });

    const paidToday = orders.filter(o => {
        if (o.status !== 'paid' || !o.paidAt) return false;
        const paidAt = new Date(o.paidAt);
        return paidAt >= todayStart;
    });

    return {
        // Today's orders
        totalToday: todayOrders.length,
        pendingToday: todayOrders.filter(o => o.status === 'pending').length,
        cancelledToday: todayOrders.filter(o => o.status === 'cancelled').length,
        // Delivered today
        deliveredCount: deliveredToday.length,
        goldSoldToday: deliveredToday.reduce((sum, o) => sum + o.goldAmount, 0),
        revenueToday: deliveredToday.reduce((sum, o) => sum + o.price, 0),
        // Paid today (awaiting delivery)
        paidCount: paidToday.length,
        paidValue: paidToday.reduce((sum, o) => sum + o.price, 0),
        // All-time totals
        totalOrders: orders.length,
        totalGoldSold: orders
            .filter(o => o.status === 'delivered')
            .reduce((sum, o) => sum + o.goldAmount, 0),
        totalRevenue: orders
            .filter(o => o.status === 'delivered')
            .reduce((sum, o) => sum + o.price, 0),
        goldStock: getGoldStock()
    };
}

/**
 * Send the daily sales report to the admin channel.
 */
export async function sendDailySalesReport(client) {
    const adminChannelId = process.env.GOLD_ADMIN_CHANNEL_ID;
    if (!adminChannelId) {
        console.warn('⚠️ [Gold Shop] Cannot send daily report: GOLD_ADMIN_CHANNEL_ID not set.');
        return;
    }

    try {
        const channel = await client.channels.fetch(adminChannelId);
        if (!channel) {
            console.warn('⚠️ [Gold Shop] Admin channel not found for daily report.');
            return;
        }

        const stats = getDailySalesSummary();
        const today = new Date().toLocaleDateString('pt-BR', {
            day: '2-digit',
            month: 'long',
            year: 'numeric'
        });

        const embed = new EmbedBuilder()
            .setColor(0xFFD700)
            .setTitle('📊 Resumo Diário — Gold Shop')
            .setDescription(`📅 **${today}**`)
            .addFields(
                { name: '━━━ 📦 Hoje ━━━', value: '\u200B', inline: false },
                { name: '💛 Gold Vendido', value: `${(stats.goldSoldToday / 1000000).toFixed(2)}M`, inline: true },
                { name: '💰 Faturamento', value: `R$ ${stats.revenueToday.toFixed(2)}`, inline: true },
                { name: '✅ Entregues', value: String(stats.deliveredCount), inline: true },
                { name: '⏳ Aguardando Entrega', value: String(stats.paidCount), inline: true },
                { name: '📦 Pedidos Hoje', value: String(stats.totalToday), inline: true },
                { name: '❌ Cancelados Hoje', value: String(stats.cancelledToday), inline: true },
                { name: '━━━ 📊 Totais Gerais ━━━', value: '\u200B', inline: false },
                { name: '💛 Total Vendido', value: `${(stats.totalGoldSold / 1000000).toFixed(2)}M`, inline: true },
                { name: '💰 Receita Total', value: `R$ ${stats.totalRevenue.toFixed(2)}`, inline: true },
                { name: '📦 Total Pedidos', value: String(stats.totalOrders), inline: true },
                { name: '💛 Estoque Atual', value: `${stats.goldStock.toLocaleString()} gold`, inline: true }
            )
            .setTimestamp();

        await channel.send({ embeds: [embed] });
        console.log(`📊 [Gold Shop] Daily sales report sent for ${today}`);
    } catch (err) {
        console.error('❌ [Gold Shop] Failed to send daily report:', err.message);
    }
}

/**
 * Start the daily sales report scheduler.
 * Sends a report at 18:00 Berlin time (checks every minute).
 */
export function startGoldDailyReport(client) {
    // Initial check after 1 minute (gives the bot time to fully start)
    setTimeout(() => {
        console.log('📊 [Gold Shop] Daily report scheduler started (will send at 18:00 Berlin).');
    }, 60 * 1000);

    setInterval(async () => {
        const now = new Date();
        const todayStr = now.toDateString();

        // Skip if we already sent the report today
        if (_lastReportDate === todayStr) return;

        // Uses server's local time (assumes Berlin timezone, consistent with panel-tick.js)
        const localHour = now.getHours();

        // Send on the first check after 18:00 (not a strict one-minute window)
        if (localHour >= 18) {
            _lastReportDate = todayStr;
            console.log(`📊 [Gold Shop] Sending daily sales report (${now.toLocaleString()})...`);
            await sendDailySalesReport(client);
        }
    }, 60 * 1000);

    console.log('📅 [Gold Shop] Daily report check scheduled: every 60 seconds');
}

// ==========================================
// 🗑️ QR CODE AUTO-CLEANUP
// ==========================================

const QR_DIR = path.resolve('./qr-codes');
const QR_REGEX = /^pix-qr-(GOLD-\d+)\.png$/;
let qrCleanupInterval = null;

/**
 * Start periodic cleanup of old QR code files.
 * Deletes QR files whose associated order is no longer 'pending'
 * (paid, delivered, cancelled) and orphaned files older than 1 hour.
 * Runs every 5 minutes.
 */
export function startQrCodeCleanup() {
    if (qrCleanupInterval) {
        clearInterval(qrCleanupInterval);
    }

    // First run after 1 minute (gives orders time to be created)
    setTimeout(() => {
        console.log('🗑️ [Gold Shop] Running initial QR code cleanup...');
        cleanupQrCodeFiles();
    }, 60 * 1000);

    qrCleanupInterval = setInterval(() => {
        cleanupQrCodeFiles();
    }, 5 * 60 * 1000);

    console.log('📅 [Gold Shop] QR code cleanup scheduled: every 5 minutes');
}

function cleanupQrCodeFiles() {
    try {
        if (!fs.existsSync(QR_DIR)) {
            return; // No QR directory yet
        }

        const files = fs.readdirSync(QR_DIR);
        let deletedCount = 0;
        const now = Date.now();

        for (const file of files) {
            const filePath = path.join(QR_DIR, file);

            // Skip non-PNG and non-matching files
            const match = file.match(QR_REGEX);
            if (!match) {
                // Unknown file — delete if older than 1 hour
                try {
                    const stat = fs.statSync(filePath);
                    if (now - stat.mtimeMs > 60 * 60 * 1000) {
                        fs.unlinkSync(filePath);
                        deletedCount++;
                        console.log(`🗑️ [Gold Shop] Deleted unknown/orphaned QR file: ${file}`);
                    }
                } catch { /* skip files that can't be stat'd */ }
                continue;
            }

            const orderId = match[1];
            const order = goldDb.orders[orderId];

            // Delete QR if order doesn't exist or is no longer pending
            // (paid → admin delivers, delivered, cancelled, expired)
            if (!order || order.status !== 'pending') {
                try {
                    fs.unlinkSync(filePath);
                    deletedCount++;
                    console.log(`🗑️ [Gold Shop] Deleted QR for ${orderId} (status: ${order?.status || 'not found'})`);
                } catch (err) {
                    console.error(`❌ [Gold Shop] Failed to delete QR ${file}:`, err.message);
                }
            }
        }

        if (deletedCount > 0) {
            console.log(`🗑️ [Gold Shop] Cleaned up ${deletedCount} old QR code file(s).`);
        }
    } catch (err) {
        console.error('❌ [Gold Shop] QR cleanup error:', err.message);
    }
}

// ==========================================
// 🔄 PAYMENT POLLING
// Polls Mercado Pago API for pending orders whose webhook may have been missed
// ==========================================

let paymentPollInterval = null;

/**
 * Send a payment confirmation DM to the user
 */
export async function sendPaymentConfirmationDm(client, order, orderId, paymentId) {
    if (!client) return;
    try {
        const user = await client.users.fetch(order.userId);
        if (user) {
            const dmEmbed = new EmbedBuilder()
                .setColor(0x57F287)
                .setTitle('✅ Pagamento Confirmado!')
                .setDescription(
                    `📋 **Pedido:** ${orderId}\\n` +
                    `💛 **Produto:** ${order.productName}\\n` +
                    `💰 **Valor:** R$ ${order.price.toFixed(2)}\\n` +
                    `💳 **Pagamento:** Confirmado via PIX\\n` +
                    `🆔 **Transação:** ${paymentId || order.paymentId || 'N/A'}\\n\\n` +
                    `⏳ **Próximo passo:** Nossa equipe fará a entrega no jogo em breve!\\n` +
                    `📌 Você será notificado quando o gold for entregue.`
                )
                .setTimestamp();

            await user.send({ embeds: [dmEmbed] });
            console.log(`📬 DM sent to user ${order.userId} about payment confirmation for ${orderId}.`);
        }
    } catch {
        console.log(`⚠️ Could not send DM to user ${order.userId} (DMs may be closed).`);
    }
}

/**
 * Send payment notification to the admin channel
 */
export async function sendPaymentToAdminChannel(client, order, orderId) {
    if (!client) return;

    const adminChannelId = process.env.GOLD_ADMIN_CHANNEL_ID;
    if (!adminChannelId) return;

    try {
        const channel = await client.channels.fetch(adminChannelId);
        if (!channel) return;

        const adminEmbed = new EmbedBuilder()
            .setColor(0x57F287)
            .setTitle('💳 Pagamento Confirmado!')
            .setDescription(
                `📋 **Pedido:** ${orderId}\\n` +
                `👤 **Cliente:** <@${order.userId}> (${order.userName})\\n` +
                `💛 **Gold:** ${order.goldAmount.toLocaleString()}\\n` +
                `💰 **Valor:** R$ ${order.price.toFixed(2)}\\n` +
                `🎮 **Personagem:** ${order.characterName}\\n` +
                `🌍 **Servidor:** ${order.server}\\n` +
                `✅ **Status:** Pago — Aguardando Entrega\\n` +
                `📅 **Confirmado em:** ${new Date().toLocaleString('pt-BR')}\\n\\n` +
                `🔜 Use o painel 👑 Admin > 📋 Pedidos para entregar o gold.`
            )
            .setTimestamp();

        await channel.send({ embeds: [adminEmbed] });
        console.log(`📢 Admin channel notified about payment for ${orderId}.`);
    } catch (err) {
        console.error('❌ Failed to notify admin channel:', err.message);
    }
}

/**
 * Mark an order as paid and send all notifications
 * Used both by webhook handler and polling system
 */
export async function markOrderAsPaidAndNotify(client, orderId, paymentId) {
    const order = getOrder(orderId);
    if (!order) {
        console.log(`❌ [Payment Poll] Order ${orderId} not found.`);
        return false;
    }

    if (order.status !== 'pending') {
        return false;
    }

    // Mark as paid
    markOrderAsPaid(orderId);
    console.log(`✅ [Payment Poll] Order ${orderId} marked as paid automatically!`);

    // Send notifications
    await sendPaymentConfirmationDm(client, order, orderId, paymentId);
    await sendPaymentToAdminChannel(client, order, orderId);

    return true;
}

/**
 * Start polling Mercado Pago API for pending payments.
 * Acts as a backup for missed webhook notifications.
 * Runs every 30 seconds.
 */
export function startPaymentPolling(client) {
    if (paymentPollInterval) {
        clearInterval(paymentPollInterval);
    }

    // First run after 30 seconds (gives time for initial webhook to arrive)
    setTimeout(() => {
        console.log('🔍 [Gold Shop] Running initial payment status poll...');
        pollPendingPayments(client);
    }, 30 * 1000);

    paymentPollInterval = setInterval(() => {
        pollPendingPayments(client);
    }, 30 * 1000);

    console.log('📅 [Gold Shop] Payment polling scheduled: every 30 seconds');
}

async function pollPendingPayments(client) {
    try {
        const orders = Object.values(goldDb.orders);
        const pendingOrders = orders.filter(
            o => o.status === 'pending' && o.paymentId
        );

        if (pendingOrders.length === 0) return;

        let confirmedCount = 0;

        for (const order of pendingOrders) {
            try {
                const approved = await isPaymentApproved(order.paymentId);
                if (approved) {
                    const marked = await markOrderAsPaidAndNotify(client, order.orderId, order.paymentId);
                    if (marked) confirmedCount++;
                }
            } catch (err) {
                console.error(`❌ [Payment Poll] Error checking payment ${order.paymentId} for ${order.orderId}:`, err.message);
            }
        }

        if (confirmedCount > 0) {
            console.log(`🔍 [Gold Shop] Payment poll confirmed ${confirmedCount} new payment(s).`);
        }
    } catch (err) {
        console.error('❌ [Gold Shop] Payment polling error:', err.message);
    }
}

export default {
    initGoldShop,
    createDynamicOrder,
    updateOrderPayment,
    markOrderAsPaid,
    markOrderAsDelivered,
    cancelOrder,
    getOrder,
    getUserOrders,
    getPendingOrders,
    getOrdersByStatus,
    getAllOrders,
    updateOrderNotes,
    getShopStats,
    getPanelRef,
    savePanelRef,
    clearPanelRef,
    startExpiredOrdersCheck,
    startQrCodeCleanup,
    startGoldDailyReport,
    startPaymentPolling,
    getDailySalesSummary,
    getGoldStock,
    setGoldStock,
    deductStock,
    calculatePrice,
    getPricingInfo,
    GOLD_UNIT
};
