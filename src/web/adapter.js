// ==========================================
// 🌐 WEB ADAPTER — Fake Discord interaction
// Lets the web server drive the EXACT same
// claim handlers used by Discord (same logic,
// punishments, queues, cooldowns, daily logs).
// ==========================================

import { db } from "../core/state.js";
import { handleClaimInteractions } from "../handlers/claim-handlers.js";
import { renderButtons } from "../handlers/render-buttons.js";
import { renderEmbed } from "../handlers/render-embed.js";
import { reserveFlowCache } from "../interactions/admin-reserve.js";
import { getAntidemonRoomKeys, getSummonRoomKeys, getEventGroupKeys } from "../handlers/claim-core-rooms.js";

// ── Serializers ────────────────────────────

/** Convert Discord.js ActionRowBuilder[] into plain JSON for the frontend. @param {Array} components @returns {Array} */
function serializeComponents(components) {
    const rows = [];
    for (const row of components || []) {
        let json;
        try {
            json = row.toJSON ? row.toJSON() : row;
        } catch {
            continue;
        }
        for (const comp of json.components || []) {
            if (comp.type === 3) {
                rows.push({
                    kind: "select",
                    customId: comp.custom_id,
                    placeholder: comp.placeholder || "Select...",
                    options: (comp.options || []).map(o => ({
                        label: o.label,
                        value: o.value,
                        emoji: o.emoji?.name || null
                    }))
                });
            } else if (comp.type === 2) {
                rows.push({
                    kind: "button",
                    customId: comp.custom_id,
                    label: comp.label || "",
                    style: comp.style,
                    emoji: comp.emoji?.name || null,
                    disabled: !!comp.disabled
                });
            }
        }
    }
    return rows;
}

/** Convert a Discord.js ModalBuilder into plain JSON. @param {object} modal @returns {object} */
function serializeModal(modal) {
    let json;
    try {
        json = modal.toJSON ? modal.toJSON() : modal;
    } catch {
        return null;
    }
    const fields = [];
    for (const row of json.components || []) {
        for (const comp of row.components || []) {
            fields.push({
                customId: comp.custom_id,
                label: comp.label || "",
                required: !!comp.required,
                placeholder: comp.placeholder || ""
            });
        }
    }
    return { customId: json.custom_id, title: json.title || "", fields };
}

/** Capture the response of a handler call (reply/update/showModal). */
function makeCapture() {
    const out = { message: "", menu: null, modal: null };
    return {
        out,
        capture(opts) {
            const content = typeof opts === "string" ? opts : (opts && opts.content) || "";
            if (content) out.message = content;
            if (opts && opts.components && opts.components.length > 0) {
                const menus = serializeComponents(opts.components);
                if (menus.length > 0) out.menu = menus;
            }
        }
    };
}

/** Build a fake interaction object that behaves like a Discord.js interaction. @param {object} account - web account {uid, displayName, isMod, isAdmin} @param {object} payload - {customId, type, value, password} */
export function createFakeInteraction(account, payload) {
    const { out, capture } = makeCapture();

    const fake = {
        user: { id: account.uid, username: account.displayName },
        member: {
            displayName: account.displayName,
            permissions: { has: () => !!(account.isMod || account.isAdmin) }
        },
        customId: payload.customId,
        values: payload.value != null ? [String(payload.value)] : [],
        fields: { getTextInputValue: () => (payload.password != null ? String(payload.password) : "") },
        isButton: () => payload.type === "button",
        isStringSelectMenu: () => payload.type === "select",
        isModalSubmit: () => payload.type === "modal",
        // All response methods funnel into the capture
        reply: async (opts) => { capture(opts); },
        update: async (opts) => { capture(opts); },
        deferReply: async () => {},
        deferUpdate: async () => {},
        editReply: async () => {},
        followUp: async () => {},
        showModal: async (modal) => { out.modal = serializeModal(modal); },
        message: {},
        guild: null,
        channel: null,
        client: null
    };

    return { fake, out };
}

/** Drive the real claim router with a fake interaction. @param {object} account @param {object} payload @returns {Promise<object>} */
export async function runClaimAction(account, payload) {
    // The reserve flow has no entry point on the bot's Discord UI — the cache
    // that seeds it (target user) is created here when started from the website.
    if (payload.customId === "reserve-select-event") {
        reserveFlowCache[account.uid] = {
            targetUserId: account.uid,
            targetUserName: account.displayName || account.username,
            step: "event"
        };
    }
    const { fake, out } = createFakeInteraction(account, payload);
    await handleClaimInteractions(fake);
    return {
        message: out.message,
        menu: out.menu,
        modal: out.modal
    };
}

/** Strip Discord markdown (code fences, bold/italic/underline, headers) for web display. @param {string} text @returns {string} */
function cleanEmbedText(text) {
    if (!text) return "";
    return String(text)
        .replace(/```(?:yaml|md|fix|css|json|ini)?\s*\n?/g, "")
        .replace(/^#+\s*/gm, "")
        .replace(/\*\*/g, "")
        .replace(/__(.*?)__/g, "$1")
        .replace(/\*([^*]+)\*/g, "$1")
        .replace(/`/g, "")
        .replace(/\u200B/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

/** Serialize the Discord embed a panel would show (live status, timers, queues). @param {string} key @returns {object|null} */
function serializeEmbed(key) {
    try {
        const embed = renderEmbed(key);
        const json = embed.toJSON ? embed.toJSON() : embed;
        return {
            title: cleanEmbedText(json.title || ""),
            description: cleanEmbedText(json.description || ""),
            fields: (json.fields || []).map(f => ({
                name: cleanEmbedText(f.name || ""),
                value: cleanEmbedText(f.value || ""),
                inline: !!f.inline
            })),
            color: typeof json.color === "number" ? `#${json.color.toString(16).padStart(6, "0")}` : null
        };
    } catch (err) {
        console.error(`[Web] renderEmbed failed for ${key}:`, err.message);
        return null;
    }
}

/** First meaningful status line of a panel, for the overview card. @param {object} embed @returns {string} */
function computeSummary(embed) {
    if (!embed) return "";
    const lines = (embed.description || "").split("\n").map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
        if (line !== "Status Overview") return line;
    }
    for (const field of embed.fields || []) {
        const valueLine = (field.value || "").split("\n").map(l => l.trim()).find(Boolean);
        if (valueLine) return valueLine;
    }
    return "";
}

// ── Panel serialization ────────────────────

/** Extract a sub-entry (room/location/event) from a panel object when present. */
function serializeSub(entry) {
    if (!entry || typeof entry !== "object") return null;
    const queue = [];
    if (entry.nextId) {
        queue.push({
            name: entry.nextName || "?",
            time: entry.formattedTimeNext || "",
            isUser: null
        });
    }
    return {
        name: entry.name || "",
        status: entry.status || "",
        ownerId: entry.ownerId || null,
        ownerName: entry.ownerName || null,
        timeWindow: entry.timeWindow || entry.time || "",
        nextName: entry.nextName || null,
        queue,
        password: entry.password || null
    };
}

/** Serialize the full claim DB into a plain-JSON panel list for the frontend. */
export function serializePanels() {
    const panels = [];
    if (!db) return panels;

    for (const key in db) {
        const panel = db[key];
        if (!panel || key.startsWith("_") || typeof panel !== "object") continue;

        const base = { key, title: panel.title || key, type: panel.type || "normal" };

        // Live status exactly as the Discord panel shows it (respawn countdowns,
        // owners, queues, ETA, reservations, passwords).
        const embed = serializeEmbed(key);
        base.embed = embed;
        base.color = embed ? embed.color : null;
        base.summary = computeSummary(embed);

        // The exact same buttons the Discord panels render (claim, cancel, death
        // marks, fixed-event claims, ...) — the site mirrors the bot. The DM
        // toggle is stripped here and shown once in the site header instead.
        base.buttons = serializeComponents(renderButtons(key)).filter(b => b.customId !== "dmoptout");

        if (panel.type === "antidemon") {
            base.subs = getAntidemonRoomKeys(key)
                .filter(rm => panel[rm])
                .map(rm => ({ room: rm, ...serializeSub(panel[rm]) }));
        } else if (panel.type === "summon") {
            base.subs = getSummonRoomKeys(key)
                .filter(loc => panel[loc])
                .map(loc => ({ room: loc, ...serializeSub(panel[loc]) }));
        } else if (panel.type === "event_group") {
            base.subs = getEventGroupKeys(panel)
                .filter(ev => panel[ev] && typeof panel[ev] === "object")
                .map(ev => ({ room: ev, ...serializeSub(panel[ev]) }));
        } else {
            // normal / peak / fixed — top-level owner + optional bosses
            base.ownerName = panel.ownerName || null;
            base.ownerId = panel.ownerId || null;
            base.timeWindow = panel.timeWindow || "";
            const queue = [];
            let node = panel.next;
            for (; node;) {
                queue.push({ name: node.userName || "?", time: node.formattedTime || "" });
                node = node.nextQueue;
            }
            base.queue = queue;
            base.subs = [];
            for (const bossKey of ["boss1", "boss2", "boss3"]) {
                if (panel[bossKey] && typeof panel[bossKey] === "object") {
                    base.subs.push({ room: bossKey, ...serializeSub(panel[bossKey]) });
                }
            }
        }

        panels.push(base);
    }

    return panels;
}
