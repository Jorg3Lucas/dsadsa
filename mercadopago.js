// ==========================================
// 💳 MERCADO PAGO INTEGRATION
// ==========================================

import { MercadoPagoConfig, Payment } from "mercadopago";
import axios from 'axios';

let client = null;
let paymentClient = null;

/**
 * Log warnings about missing Gold Shop environment variables
 */
export function checkGoldEnvVars() {
    const required = [
        { key: 'MERCADO_PAGO_ACCESS_TOKEN', desc: 'Mercado Pago access token (PIX payments)' },
        { key: 'GOLD_ADMIN_ROLE_ID', desc: 'Shop admin role ID' },
        { key: 'GOLD_ADMIN_CHANNEL_ID', desc: 'Channel ID for order notifications' }
    ];

    let missing = false;
    for (const env of required) {
        if (!process.env[env.key]) {
            console.warn(`⚠️  Missing environment variable: ${env.key} — ${env.desc}`);
            missing = true;
        }
    }

    if (missing) {
        console.log('📌 Set these variables in .env to enable the Gold Shop.');
    }
    return missing;
}

export function initMercadoPago() {
    if (paymentClient) return true;

    const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;

    if (!accessToken) {
        console.error("❌ MERCADO_PAGO_ACCESS_TOKEN not configured.");
        return false;
    }

    try {
        client = new MercadoPagoConfig({
            accessToken,
            options: {
                timeout: 30000
            }
        });

        paymentClient = new Payment(client);

        console.log("✅ Mercado Pago inicializado.");

        return true;
    } catch (err) {
        console.error("❌ Error initializing Mercado Pago:", err);
        return false;
    }
}

function generateIdempotencyKey() {
    return crypto.randomUUID();
}

export async function createPixPayment(
    amount,
    description,
    payerEmail = null,
    externalRef = null
) {

    if (!paymentClient) {
        throw new Error("Mercado Pago not initialized.");
    }

    const body = {
        transaction_amount: Number(amount),
        description: description.substring(0, 255),

        payment_method_id: "pix",

        payer: {
            email: payerEmail || "comprador@example.com"
        }
    };

    if (externalRef) {
        body.external_reference = String(externalRef);
    }

    const idempotencyKey = generateIdempotencyKey();

    console.log("━━━━━━━━━━━━━━━━━━━━━━");
    console.log("💳 Criando pagamento PIX...");
    console.log(body);

    try {

        console.time("MercadoPago");

        const result = await paymentClient.create({
            body,
            requestOptions: {
                idempotencyKey
            }
        });

        console.timeEnd("MercadoPago");

        console.log("✅ PIX criado:", result.id);

        console.log({
            status: result.status,
            qr: !!result.point_of_interaction?.transaction_data?.qr_code,
            qrBase64:
                !!result.point_of_interaction?.transaction_data?.qr_code_base64
        });

        const qr =
            result.point_of_interaction?.transaction_data?.qr_code;

        const qrBase64 =
            result.point_of_interaction?.transaction_data?.qr_code_base64;

        if (!qr) {
            console.error(result);
            throw new Error(
                "Mercado Pago did not return the PIX code."
            );
        }

        if (!qrBase64) {
            console.error(result);
            throw new Error(
                "Mercado Pago did not return the QR Code."
            );
        }

        return {
            id: String(result.id),

            status: result.status,

            qrCode: qr,

            qrCodeBase64: qrBase64.replace(
                /^data:image\/png;base64,/,
                ""
            ),

            dateCreated: result.date_created,

            ticketUrl: result.point_of_interaction?.transaction_data?.ticket_url || null
        };

    } catch (err) {

        console.error("━━━━━━━━━━━━━━━━━━━━━━");
        console.error("❌ Erro Mercado Pago");
        console.error(err);

        if (err.response?.data) {
            console.error(
                JSON.stringify(
                    err.response.data,
                    null,
                    2
                )
            );
        }

        throw err;
    }
}

export async function getPayment(paymentId) {

    if (!paymentClient) {
        throw new Error("Mercado Pago not initialized.");
    }

    const payment = await paymentClient.get({
        id: paymentId
    });

    return {
        id: String(payment.id),

        status: payment.status,

        statusDetail: payment.status_detail,

        transactionAmount: payment.transaction_amount,

        payerEmail: payment.payer?.email,

        externalRef: payment.external_reference
    };
}

export async function isPaymentApproved(paymentId) {

    try {

        const payment = await getPayment(paymentId);

        return payment.status === "approved";

    } catch {

        return false;

    }

}

export function extractWebhookPaymentId(body) {

    if (!body?.data?.id) return null;

    if (
        body.type !== "payment" &&
        body.action !== "payment.created" &&
        body.action !== "payment.updated"
    ) {
        return null;
    }

    return String(body.data.id);

}

/**
 * Upload a base64 image to Imgur for use as an embed thumbnail.
 * Avoids Discord CDN upload which was causing AbortError.
 * 
 * Requires IMGUR_CLIENT_ID env var (get one free at https://api.imgur.com/oauth2/addclient)
 * 
 * @param {string} base64Image - Base64-encoded image data (without data:image prefix)
 * @returns {Promise<string|null>} Direct image URL or null on failure
 */
export async function uploadToImgur(base64Image) {
    const clientId = process.env.IMGUR_CLIENT_ID;
    if (!clientId) {
        console.warn('⚠️ [Imgur] IMGUR_CLIENT_ID not configured — QR thumbnail will not be uploaded.');
        return null;
    }

    try {
        const response = await axios.post('https://api.imgur.com/3/image', {
            image: base64Image,
            type: 'base64'
        }, {
            headers: {
                'Authorization': `Client-ID ${clientId}`
            },
            timeout: 15000
        });

        if (response.data?.data?.link) {
            console.log('📸 [Imgur] QR code uploaded successfully:', response.data.data.link);
            return response.data.data.link;
        }

        console.warn('⚠️ [Imgur] Unexpected response:', JSON.stringify(response.data).substring(0, 200));
        return null;
    } catch (err) {
        console.error('❌ [Imgur] Upload failed:', err.message);
        if (err.response?.data) {
            console.error('📋 [Imgur] Response:', JSON.stringify(err.response.data).substring(0, 300));
        }
        return null;
    }
}

export default {
    initMercadoPago,
    checkGoldEnvVars,
    createPixPayment,
    getPayment,
    isPaymentApproved,
    extractWebhookPaymentId,
    uploadToImgur
};
