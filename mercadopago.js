// ==========================================
// 💳 MERCADO PAGO INTEGRATION
// PIX payment creation and webhook verification
// ==========================================

import { MercadoPagoConfig, Payment } from 'mercadopago';

let client = null;
let paymentClient = null;

/**
 * Initialize Mercado Pago client with access token
 */
export function initMercadoPago() {
    const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
    if (!accessToken) {
        console.warn('⚠️ MERCADO_PAGO_ACCESS_TOKEN not set. PIX payments will be disabled.');
        return false;
    }
    try {
        client = new MercadoPagoConfig({ accessToken });
        paymentClient = new Payment(client);
        console.log('✅ Mercado Pago client initialized successfully.');
        return true;
    } catch (error) {
        console.error('❌ Failed to initialize Mercado Pago client:', error.message);
        return false;
    }
}

/**
 * Log warnings about missing Gold Shop environment variables
 */
export function checkGoldEnvVars() {
    const required = [
        { key: 'MERCADO_PAGO_ACCESS_TOKEN', desc: 'Token de acesso do Mercado Pago (pagamentos PIX)' },
        { key: 'GOLD_ADMIN_ROLE_ID', desc: 'ID do cargo de administrador da loja' },
        { key: 'GOLD_ADMIN_CHANNEL_ID', desc: 'ID do canal para notificações de pedidos' }
    ];

    let missing = false;
    for (const env of required) {
        if (!process.env[env.key]) {
            console.warn(`⚠️  Variável de ambiente faltando: ${env.key} — ${env.desc}`);
            missing = true;
        }
    }

    if (missing) {
        console.log('📌 Configure essas variáveis no arquivo .env para ativar a Gold Shop.');
    }
    return missing;
}

/**
 * Generate a UUID v4 for idempotency key
 */
function generateIdempotencyKey() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

/**
 * Create a PIX payment and return QR code data
 * 
 * @param {number} amount - Transaction amount in BRL
 * @param {string} description - Payment description
 * @param {string} payerEmail - Customer email (optional)
 * @param {string} externalRef - Your order ID for reference
 * @returns {Promise<{id: string, qrCode: string, qrCodeBase64: string, status: string}>}
 */
export async function createPixPayment(amount, description, payerEmail = null, externalRef = null) {
    if (!paymentClient) {
        throw new Error('Mercado Pago not initialized. Set MERCADO_PAGO_ACCESS_TOKEN in .env');
    }

    const body = {
        transaction_amount: Number(amount.toFixed(2)),
        description: description.substring(0, 255),
        payment_method_id: 'pix',
        payer: {
            email: payerEmail || 'comprador@email.com'
        }
    };

    // Add external reference if provided
    if (externalRef) {
        body.external_reference = String(externalRef).substring(0, 255);
    }

    const idempotencyKey = generateIdempotencyKey();

    try {
        const result = await paymentClient.create({
            body,
            requestOptions: {
                idempotencyKey
            }
        });

        return {
            id: String(result.id),
            qrCode: result.point_of_interaction?.transaction_data?.qr_code || '',
            qrCodeBase64: result.point_of_interaction?.transaction_data?.qr_code_base64 || '',
            status: result.status,
            dateCreated: result.date_created
        };
    } catch (error) {
        console.error('❌ Mercado Pago payment creation failed:', error.message);
        if (error.response?.data) {
            console.error('📋 API Response:', JSON.stringify(error.response.data, null, 2));
        }
        throw error;
    }
}

/**
 * Get payment details by payment ID
 * 
 * @param {string} paymentId - Mercado Pago payment ID
 * @returns {Promise<{id: string, status: string, statusDetail: string, transactionAmount: number, payerEmail: string, externalRef: string}>}
 */
export async function getPayment(paymentId) {
    if (!paymentClient) {
        throw new Error('Mercado Pago not initialized.');
    }

    try {
        const result = await paymentClient.get({ id: paymentId });

        return {
            id: String(result.id),
            status: result.status,
            statusDetail: result.status_detail,
            transactionAmount: result.transaction_amount,
            payerEmail: result.payer?.email || '',
            externalRef: result.external_reference || ''
        };
    } catch (error) {
        console.error(`❌ Failed to fetch payment ${paymentId}:`, error.message);
        throw error;
    }
}

/**
 * Check if a payment was approved
 * 
 * @param {string} paymentId - Mercado Pago payment ID
 * @returns {Promise<boolean>}
 */
export async function isPaymentApproved(paymentId) {
    try {
        const payment = await getPayment(paymentId);
        return payment.status === 'approved';
    } catch {
        return false;
    }
}

/**
 * Verify webhook notification signature and extract payment ID
 * 
 * @param {object} body - Request body from Mercado Pago webhook
 * @returns {string|null} - Payment ID or null if invalid
 */
export function extractWebhookPaymentId(body) {
    if (!body || !body.data || !body.data.id) {
        return null;
    }

    // Only process payment notifications
    if (body.type !== 'payment' && body.action !== 'payment.created' && body.action !== 'payment.updated') {
        return null;
    }

    return String(body.data.id);
}

export default {
    initMercadoPago,
    createPixPayment,
    getPayment,
    isPaymentApproved,
    extractWebhookPaymentId
};
