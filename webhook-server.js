// ==========================================
// 🔔 WEBHOOK SERVER
// Receives Mercado Pago payment notifications
// and automatically marks orders as paid
// ==========================================

import express from 'express';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { extractWebhookPaymentId, getPayment } from './mercadopago.js';
import * as goldShop from './gold-shop.js';
import { EmbedBuilder } from 'discord.js';
import 'dotenv/config';

const PORT = parseInt(process.env.WEBHOOK_PORT || '3000', 10);
const PUBLIC_URL = process.env.WEBHOOK_PUBLIC_URL || `http://${process.env.HOST_IP || 'localhost'}:${PORT}`;

let serverInstance = null;
let discordClient = null;
let cachedBaseUrl = null;

/**
 * Get the server's public base URL for serving QR code images.
 * Discovers the public IP automatically on first call (cached indefinitely).
 * Falls back to env vars or localhost if discovery fails.
 */
export async function getServerBaseUrl() {
    if (cachedBaseUrl) return cachedBaseUrl;

    // 1. Use explicit config if available
    if (process.env.WEBHOOK_PUBLIC_URL) {
        cachedBaseUrl = process.env.WEBHOOK_PUBLIC_URL;
        return cachedBaseUrl;
    }
    if (process.env.HOST_IP) {
        cachedBaseUrl = `http://${process.env.HOST_IP}:${PORT}`;
        return cachedBaseUrl;
    }

    // 2. Auto-discover public IP via ipify
    try {
        const resp = await axios.get('https://api.ipify.org?format=json', { timeout: 5000 });
        if (resp.data?.ip) {
            cachedBaseUrl = `http://${resp.data.ip}:${PORT}`;
            console.log(`🌐 Auto-discovered public IP: ${resp.data.ip}`);
            return cachedBaseUrl;
        }
    } catch (err) {
        console.warn('⚠️ Could not auto-discover public IP:', err.message);
    }

    // 3. Final fallback — won't work from Discord but prevents crash
    cachedBaseUrl = `http://localhost:${PORT}`;
    console.warn('⚠️ Using localhost as fallback — QR thumbnails will not be visible from Discord.');
    console.warn('   Set WEBHOOK_PUBLIC_URL or HOST_IP in .env for proper QR code display.');
    return cachedBaseUrl;
}

/** Invalidate cached base URL (e.g., on IP change) */
export function resetServerBaseUrl() {
    cachedBaseUrl = null;
}

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
    // 🖼️ QR CODE IMAGES
    // Serve QR code PNG files saved by the Gold Shop
    // ==========================================
    const qrDir = path.resolve('./qr-codes');
    if (!fs.existsSync(qrDir)) {
        fs.mkdirSync(qrDir, { recursive: true });
        console.log('📁 QR codes directory created at', qrDir);
    }
    app.use('/qr', express.static(qrDir));

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
        console.log(`📸 QR code URL: ${PUBLIC_URL}/qr/pix-qr-EXEMPLO.png`);

        // Pre-warm the IP discovery (non-blocking)
        getServerBaseUrl().then(url => {
            console.log(`📸 QR codes will be served at: ${url}/qr/`);
        }).catch(() => {});
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

    // 7. Send notifications (reuse shared functions from gold-shop)
    await goldShop.sendPaymentConfirmationDm(discordClient, order, orderId, paymentId);
    await goldShop.sendPaymentToAdminChannel(discordClient, order, orderId);
}

/**
 * Send DM to user confirming payment
 * DEPRECATED: Use goldShop.sendPaymentConfirmationDm instead
 */
async function notifyPaymentConfirmed(order, orderId, paymentId) {
    if (!discordClient) return;

    try {
        const user = await discordClient.users.fetch(order.userId);
        if (user) {
            const dmEmbed = new EmbedBuilder()
                .setColor(0x57F287)
                .setTitle('✅ Payment Confirmed!')
                .setDescription(
                    `📋 **Order:** ${orderId}\\n` +
                    `💛 **Product:** ${order.productName}\\n` +
                    `💰 **Amount:** R$ ${order.price.toFixed(2)}\\n` +
                    `💳 **Payment:** Confirmed via PIX\\n` +
                    `🆔 **Transaction:** ${paymentId}\\n\\n` +
                    `⏳ **Next step:** Our team will deliver in-game soon!\\n` +
                    `📌 You'll be notified when the gold is delivered.`
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
 * DEPRECATED: Use goldShop.sendPaymentToAdminChannel instead
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
            .setTitle('💳 Payment Confirmed — Auto!')
            .setDescription(
                `📋 **Order:** ${orderId}\\n` +
                `👤 **Client:** <@${order.userId}> (${order.userName})\\n` +
                `💛 **Gold:** ${order.goldAmount.toLocaleString()}\\n` +
                `💰 **Amount:** R$ ${order.price.toFixed(2)}\\n` +
                `🎮 **Character:** ${order.characterName}\\n` +
                `🌍 **Server:** ${order.server}\\n` +
                `✅ **Status:** Paid — Awaiting Delivery\\n` +
                `📅 **Confirmed at:** ${new Date().toLocaleString('pt-BR')}\\n\\n` +
                `🔜 Use the 👑 Admin > 📋 Orders panel to deliver the gold.`
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
    getWebhookUrl,
    getServerBaseUrl,
    resetServerBaseUrl
};
