// ==========================================
// 📎 DISCORD API UTILITY HELPERS
// ==========================================

import axios from "axios";
import { getBotToken } from "./config.js";

/**
 * Send a file with an embed to a Discord channel via REST API multipart.
 * Bypasses discord.js AttachmentBuilder limitations for large/raw file uploads.
 *
 * @param {string} channelId  - Discord channel ID to send to
 * @param {string} fileName   - Display filename for the attachment
 * @param {Buffer} buffer     - File content buffer
 * @param {import("discord.js").EmbedBuilder} embed - Pre-built embed to attach
 * @param {string} [logLabel="File"] - Label for console log messages
 * @returns {Promise<boolean>} - Whether the send succeeded
 */
export async function sendFileWithEmbed(channelId, fileName, buffer, embed, logLabel = "File") {
    try {
        const token = getBotToken();
        const boundary = "----boundary" + Math.random().toString(36).slice(2);
        const parts = [];

        // File part
        parts.push(Buffer.from(
            `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="files[0]"; filename="${fileName}"\r\n` +
            `Content-Type: text/plain; charset=utf-8\r\n\r\n`
        ));
        parts.push(buffer);
        parts.push(Buffer.from("\r\n"));

        // Embed part
        parts.push(Buffer.from(
            `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="payload_json"\r\n` +
            `Content-Type: application/json\r\n\r\n` +
            `${JSON.stringify({ embeds: [embed.toJSON()] })}\r\n`
        ));
        parts.push(Buffer.from(`--${boundary}--\r\n`));

        const body = Buffer.concat(parts);

        await axios.post(
            `https://discord.com/api/v10/channels/${channelId}/messages`,
            body,
            {
                headers: {
                    Authorization: `Bot ${token}`,
                    "Content-Type": `multipart/form-data; boundary=${boundary}`,
                    "Content-Length": String(Buffer.byteLength(body))
                },
                maxBodyLength: Infinity
            }
        );

        console.log(`✅ ${logLabel} sent: ${fileName}`);
        return true;
    } catch (err) {
        console.error(`❌ Failed to send ${logLabel.toLowerCase()}:`, err.message);
        return false;
    }
}
