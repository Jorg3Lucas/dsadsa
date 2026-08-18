// ==========================================
// 📜 HISTORY — recent claim logs + active punishments
// Reads the bot's in-memory dailyLogs/punishments
// (same process), resolving user names best-effort.
// ==========================================

import { dailyLogs, punishments, client, db } from "../core/state.js";
import { DISCORD_SERVER_ID } from "../core/config.js";
import { loadAccounts } from "./accounts.js";

const MAX_LOGS = 100;

// uid -> { name, at } — short cache for name lookups
const nameCache = new Map();
const NAME_CACHE_MS = 5 * 60 * 1000;

/** Find a display name for a uid among current claims in the claim db. */
function resolveNameFromDb(uid) {
    if (!db) return null;
    for (const key in db) {
        const panel = db[key];
        if (!panel || key.startsWith("_") || typeof panel !== "object") continue;
        if (panel.ownerId === uid && panel.ownerName) return panel.ownerName;
        for (const subKey in panel) {
            const sub = panel[subKey];
            if (sub && typeof sub === "object" && sub.ownerId === uid && sub.ownerName) return sub.ownerName;
        }
    }
    return null;
}

/** Best-effort: web account → current claim → Discord member lookup. */
async function resolveName(uid) {
    const cached = nameCache.get(uid);
    if (cached && Date.now() - cached.at < NAME_CACHE_MS) return cached.name;

    let name = null;
    const account = loadAccounts().find(a => a.uid === uid);
    if (account) {
        name = account.displayName;
    }
    if (!name) {
        name = resolveNameFromDb(uid);
    }
    if (!name && client && client.guilds && client.guilds.cache) {
        const guild = client.guilds.cache.get(DISCORD_SERVER_ID);
        if (guild && guild.members) {
            try {
                const member = await Promise.race([
                    guild.members.fetch(uid),
                    new Promise(resolve => setTimeout(() => resolve(null), 1000))
                ]);
                if (member && member.displayName) name = member.displayName;
            } catch {
                // not a member / invalid id — fall through
            }
        }
    }

    nameCache.set(uid, { name: name || uid, at: Date.now() });
    return name || uid;
}

function formatRemaining(ms) {
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

/** Build the history payload for the website. @returns {Promise<{logs: Array, punishments: Array}>} */
export async function getHistory() {
    const logs = (dailyLogs.queue || [])
        .slice(-MAX_LOGS)
        .reverse()
        .map(entry => ({
            type: entry.type || "CLAIM_START",
            user: entry.user || "?",
            targetRoom: entry.targetRoom || "",
            context: entry.context || "",
            timestamp: entry.timestamp || "",
            date: entry.date || ""
        }));

    const now = Date.now();
    const active = [];
    for (const [uid, expiry] of Object.entries(punishments || {})) {
        const remainingMs = expiry - now;
        if (remainingMs <= 0) continue;
        active.push({ uid, remainingMs });
    }
    // Resolve all names in parallel — Discord member lookups used to run
    // sequentially with a 1s timeout each, which stalled the endpoint.
    const punishmentsOut = await Promise.all(active.map(async p => ({
        uid: p.uid,
        name: await resolveName(p.uid),
        remainingMs: p.remainingMs,
        remaining: formatRemaining(p.remainingMs)
    })));
    punishmentsOut.sort((a, b) => a.remainingMs - b.remainingMs);

    return { logs, punishments: punishmentsOut };
}
