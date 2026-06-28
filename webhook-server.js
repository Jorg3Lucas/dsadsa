// ==========================================
// 🔔 WEBHOOK SERVER
// Receives Mercado Pago payment notifications
// and automatically marks orders as paid
// ==========================================

import express from 'express';
import { extractWebhookPaymentId, getPayment } from './mercadopago.js';
import * as goldShop from './gold-shop.js';
import { EmbedBuilder } from 'discord.js';
import 'dotenv/config';

const PORT = parseInt(process.env.WEBHOOK_PORT || '3000', 10);
const PUBLIC_URL = process.env.WEBHOOK_PUBLIC_URL || `http://${process.env.HOST_IP || 'localhost'}:${PORT}`;

let serverInstance = null;
let discordClient = null;

/**
 * Start the webhook HTTP server
 * @param {object} client - Discord.js client (for sending notifications)
 * @returns {Promise<object>} Express app instance
 */
export function startWebhookServer(client) {
    if (serverInstance) {
        console.log('⚠️ Webhook server already running.');
        return;
    }

    discordClient = client;

    const app = express();

    // Parse JSON bodies (Mercado Pago sends application/json)
    app.use(express.json());

    // Health check endpoint
    app.get('/health', (req, res) => {
        res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // ==========================================
    // 🔔 MERCADO PAGO WEBHOOK
    // POST /webhook/mercadopago
    // ==========================================
    app.post('/webhook/mercadopago', async (req, res) => {
        const body = req.body;

        // Respond immediately to prevent Mercado Pago timeout
        // (we'll process asynchronously)
        res.status(200).json({ received: true });

        try {
            await processWebhook(body);
        } catch (error) {
            console.error('❌ Webhook processing error:', error.message);
        }
    });

    // ==========================================
    // 🚀 START SERVER
    // ==========================================
    serverInstance = app.listen(PORT, () => {
        console.log(`🔔 Webhook server listening on port ${PORT}`);
        console.log(`📌 Webhook URL: ${PUBLIC_URL}/webhook/mercadopago`);
        console.log(`📌 Health check: ${PUBLIC_URL}/health`);
    });

    return app;
}

/**
 * Stop the webhook server gracefully
 */
export function stopWebhookServer() {
    if (serverInstance) {
        serverInstance.close();
        serverInstance = null;
        discordClient = null;
        console.log('🔔 Webhook server stopped.');
    }
}

/**
 * Get the public webhook URL for configuration
 */
export function getWebhookUrl() {
    return `${PUBLIC_URL}/webhook/mercadopago`;
}

/**
 * Process an incoming webhook from Mercado Pago
 */
async function processWebhook(body) {
    // 1. Extract payment ID from webhook payload
    const paymentId = extractWebhookPaymentId(body);
    if (!paymentId) {
        console.log('⏭️ Webhook ignored — not a payment notification:', body?.action || body?.type);
        return;
    }

    console.log(`🔔 Webhook received for payment ${paymentId}`);

    // 2. Fetch payment details from Mercado Pago API
    let payment;
    try {
        payment = await getPayment(paymentId);
    } catch (error) {
        console.error(`❌ Failed to fetch payment ${paymentId}:`, error.message);
        return;
    }

    console.log(`📋 Payment ${paymentId} status: ${payment.status} (${payment.statusDetail})`);

    // 3. Only process approved payments
    if (payment.status !== 'approved') {
        console.log(`⏭️ Payment ${paymentId} not approved (${payment.status}), skipping.`);
        return;
    }

    // 4. Find the order by external reference (order ID)
    const orderId = payment.externalRef;
    if (!orderId || !orderId.startsWith('GOLD-')) {
        console.log(`⏭️ Payment ${paymentId} has no valid order reference: "${orderId}"`);
        return;
    }

    const order = goldShop.getOrder(orderId);
    if (!order) {
        console.log(`❌ Order ${orderId} not found in database.`);
        return;
    }

    if (order.status !== 'pending') {
        console.log(`⏭️ Order ${orderId} already has status "${order.status}", not updating.`);
        return;
    }

    // 5. Verify the payment amount matches
    if (Math.abs(payment.transactionAmount - order.price) > 0.01) {
        console.warn(`⚠️ Amount mismatch for order ${orderId}: expected ${order.price}, received ${payment.transactionAmount}`);
        // Still mark as paid since Mercado Pago confirmed it
    }

    // 6. Mark order as paid
    goldShop.markOrderAsPaid(orderId);
    console.log(`✅ Order ${orderId} marked as paid automatically via webhook!`);

    // 7. Send Discord notifications
    await notifyPaymentConfirmed(order, orderId, paymentId);

    // 8. Notify admin channel
    await notifyAdminChannel(order, orderId);
}

/**
 * Send DM to user confirming payment
 */
async function notifyPaymentConfirmed(order, orderId, paymentId) {
    if (!discordClient) return;

    try {
        const user = await discordClient.users.fetch(order.userId);
        if (user) {
            const dmEmbed = new EmbedBuilder()
                .setColor(0x57F287)
                .setTitle('✅ Pagamento Confirmado!')
                .setDescription(
                    `📋 **Pedido:** ${orderId}\\n` +
                    `💛 **Produto:** ${order.productName}\\n` +
                    `💰 **Valor:** R$ ${order.price.toFixed(2)}\\n` +
                    `💳 **Pagamento:** Confirmado via PIX\\n` +
                    `🆔 **Transação:** ${paymentId}\\n\\n` +
                    `⏳ **Próximo passo:** Nossa equipe fará a entrega no jogo em breve!\\n` +
                    `📌 Você será notificado quando o gold for entregue.`
                )
                .setTimestamp();

            await user.send({ embeds: [dmEmbed] });
            console.log(`📬 DM sent to user ${order.userId} about payment confirmation.`);
        }
    } catch {
        console.log(`⚠️ Could not send DM to user ${order.userId} (DMs may be closed).`);
    }
}

/**
 * Send notification to admin channel
 */
async function notifyAdminChannel(order, orderId) {
    if (!discordClient) return;

    const adminChannelId = process.env.GOLD_ADMIN_CHANNEL_ID;
    if (!adminChannelId) return;

    try {
        const channel = await discordClient.channels.fetch(adminChannelId);
        if (!channel) return;

        const adminEmbed = new EmbedBuilder()
            .setColor(0x57F287)
            .setTitle('💳 Pagamento Confirmado — Automático!')
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

export default {
    startWebhookServer,
    stopWebhookServer,
    getWebhookUrl
};
