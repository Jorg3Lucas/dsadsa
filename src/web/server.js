// ==========================================
// 🌐 WEB SERVER — runs inside the bot process
// Serves the claim website + JSON API.
// The bot remains the ONLY writer of the JSON
// databases — the website never touches them.
// ==========================================

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { URL } from "node:url";

import {
    loadAccounts,
    saveAccounts,
    findAccount,
    createAccount,
    setAccountPassword,
    verifyPassword,
    createSession,
    getSessionUser,
    destroySession,
    isLoginLocked,
    recordFailedLogin,
    clearFailedLogins
} from "./accounts.js";
import { runClaimAction, serializePanels } from "./adapter.js";
import { getHistory } from "./history.js";
import { computeUpcomingEvents } from "./events.js";

const WEB_DIR = path.join(import.meta.dirname, "../../web");
const SESSION_COOKIE = "claim_session";
const MAX_BODY = 1024 * 1024; // 1 MB

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2"
};

// ── Per-IP API rate limit ──────────────────
const apiHits = new Map(); // ip -> { count, resetAt }
const API_LIMIT = 120; // requests per minute per IP

function allowRequest(ip) {
    const now = Date.now();
    const entry = apiHits.get(ip) || { count: 0, resetAt: now + 60_000 };
    if (now > entry.resetAt) {
        entry.count = 0;
        entry.resetAt = now + 60_000;
    }
    entry.count += 1;
    apiHits.set(ip, entry);
    return entry.count <= API_LIMIT;
}

// ── Helpers ────────────────────────────────

function acceptsGzip(res) {
    return /gzip/.test((res.req && res.req.headers && res.req.headers["accept-encoding"]) || "");
}

function json(res, status, data) {
    const body = JSON.stringify(data);
    const headers = {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
    };
    if (acceptsGzip(res) && body.length > 512) {
        headers["Content-Encoding"] = "gzip";
        res.writeHead(status, headers);
        res.end(zlib.gzipSync(body));
    } else {
        res.writeHead(status, headers);
        res.end(body);
    }
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on("data", chunk => {
            size += chunk.length;
            if (size > MAX_BODY) {
                reject(new Error("Body too large"));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on("end", () => {
            try {
                resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
            } catch {
                reject(new Error("Invalid JSON body"));
            }
        });
        req.on("error", reject);
    });
}

function getCookie(req, name) {
    const header = req.headers.cookie || "";
    for (const part of header.split(";")) {
        const idx = part.indexOf("=");
        if (idx > -1 && part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim();
    }
    return null;
}

function sendSessionCookie(res, token) {
    const secure = process.env.WEB_HTTPS === "true" ? "; Secure" : "";
    res.setHeader("Set-Cookie", `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${7 * 24 * 60 * 60}${secure}`);
}

function clearSessionCookie(res) {
    res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
}

function clientIp(req) {
    return (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "unknown";
}

function requireAuth(req, res) {
    const username = getSessionUser(getCookie(req, SESSION_COOKIE));
    if (!username) {
        json(res, 401, { error: "Not authenticated" });
        return null;
    }
    const account = findAccount(username);
    if (!account) {
        json(res, 401, { error: "Account no longer exists" });
        return null;
    }
    return account;
}

function requireAdmin(req, res) {
    const account = requireAuth(req, res);
    if (!account) return null;
    if (!account.isAdmin) {
        json(res, 403, { error: "Admin access required" });
        return null;
    }
    return account;
}

// ── Static files ───────────────────────────

function serveStatic(req, res, pathname) {
    let rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    // Path traversal guard
    const resolved = path.resolve(WEB_DIR, rel);
    if (!resolved.startsWith(WEB_DIR + path.sep) && resolved !== WEB_DIR) {
        json(res, 403, { error: "Forbidden" });
        return;
    }
    fs.readFile(resolved, (err, data) => {
        if (err) {
            res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
            res.end("Not found");
            return;
        }
        const type = MIME[path.extname(resolved).toLowerCase()] || "application/octet-stream";
        const headers = { "Content-Type": type, "Cache-Control": "no-cache" };
        if (acceptsGzip(res) && data.length > 512 && type.startsWith("text/")) {
            headers["Content-Encoding"] = "gzip";
            res.writeHead(200, headers);
            res.end(zlib.gzipSync(data));
        } else {
            res.writeHead(200, headers);
            res.end(data);
        }
    });
}

// ── Router ─────────────────────────────────

async function handleApi(req, res, url, ip) {
    const method = req.method;
    const p = url.pathname;

    // POST /api/login
    if (method === "POST" && p === "/api/login") {
        let body;
        try {
            body = await readBody(req);
        } catch {
            return json(res, 400, { error: "Invalid request body" });
        }
        const username = String(body.username || "").trim();
        const password = String(body.password || "");
        if (!username || !password) return json(res, 400, { error: "Username and password required" });

        if (isLoginLocked(ip, username)) {
            return json(res, 429, { error: "Too many failed attempts for this user. Try again in 15 minutes." });
        }

        const account = findAccount(username);
        if (!account || !verifyPassword(password, account)) {
            recordFailedLogin(ip, username);
            return json(res, 401, { error: "Invalid username or password" });
        }

        clearFailedLogins(ip, username);
        const token = createSession(account.username);
        sendSessionCookie(res, token);
        return json(res, 200, { ok: true, user: publicUser(account) });
    }

    // POST /api/logout
    if (method === "POST" && p === "/api/logout") {
        destroySession(getCookie(req, SESSION_COOKIE));
        clearSessionCookie(res);
        return json(res, 200, { ok: true });
    }

    // ── Authenticated routes below ──
    const account = requireAuth(req, res);
    if (!account) return;

    // GET /api/me
    if (method === "GET" && p === "/api/me") {
        return json(res, 200, { user: publicUser(account) });
    }

    // GET /api/panels — cached briefly; the expensive embed rendering runs at
    // most once per TTL regardless of how many clients poll.
    if (method === "GET" && p === "/api/panels") {
        const now = Date.now();
        if (!panelsCache.data || now - panelsCache.at > PANELS_TTL_MS) {
            let panels, upcomingEvents = [];
            try {
                panels = serializePanels();
                upcomingEvents = computeUpcomingEvents(100); // complete list (world bosses + scheduled + weekly + claims)
            } catch (err) {
                console.error("[Web] Panels/events failed:", err);
                panels = panels || [];
            }
            panelsCache = { at: now, data: { panels, upcomingEvents } };
        }
        return json(res, 200, { ...panelsCache.data, user: publicUser(account) });
    }

    // GET /api/history — recent claim logs + active punishments (short TTL)
    if (method === "GET" && p === "/api/history") {
        const now = Date.now();
        if (!historyCacheHolder.data || now - historyCacheHolder.at > HISTORY_TTL_MS) {
            try {
                historyCacheHolder = { at: now, data: await getHistory() };
            } catch (err) {
                console.error("[Web] History failed:", err);
                return json(res, 500, { error: "Failed to load history" });
            }
        }
        return json(res, 200, historyCacheHolder.data);
    }

    // ── Admin account management (admins only) ──
    const admin = requireAdmin(req, res);
    if (admin) {
        // GET /api/admin/accounts — list (no password hashes)
        if (method === "GET" && p === "/api/admin/accounts") {
            return json(res, 200, { accounts: loadAccounts().map(publicUser) });
        }

        // POST /api/admin/accounts/create
        if (method === "POST" && p === "/api/admin/accounts/create") {
            let body;
            try {
                body = await readBody(req);
            } catch {
                return json(res, 400, { error: "Invalid request body" });
            }
            const username = String(body.username || "").trim();
            const password = String(body.password || "");
            if (!username || password.length < 4) {
                return json(res, 400, { error: "Username required and password must be at least 4 characters" });
            }
            if (findAccount(username)) {
                return json(res, 409, { error: `Account "${username}" already exists` });
            }
            const uid = String(body.uid || "").trim() || `web:${username}`;
            const accounts = loadAccounts();
            if (accounts.some(a => a.uid === uid)) {
                return json(res, 409, { error: `Another account already uses uid "${uid}"` });
            }
            const account = createAccount({
                username,
                password,
                displayName: String(body.displayName || "").trim() || username,
                uid,
                isAdmin: !!body.isAdmin,
                isMod: !!body.isMod
            });
            accounts.push(account);
            saveAccounts(accounts);
            return json(res, 201, { account: publicUser(account) });
        }

        // POST /api/admin/accounts/remove
        if (method === "POST" && p === "/api/admin/accounts/remove") {
            let body;
            try {
                body = await readBody(req);
            } catch {
                return json(res, 400, { error: "Invalid request body" });
            }
            const username = String(body.username || "").trim();
            const accounts = loadAccounts();
            const idx = accounts.findIndex(a => String(a.username).toLowerCase() === username.toLowerCase());
            if (idx === -1) return json(res, 404, { error: "Account not found" });
            if (String(accounts[idx].username).toLowerCase() === String(admin.username).toLowerCase()) {
                return json(res, 400, { error: "You cannot remove your own account" });
            }
            const isLastAdmin = accounts[idx].isAdmin && accounts.filter(a => a.isAdmin).length === 1;
            if (isLastAdmin) {
                return json(res, 400, { error: "Cannot remove the last admin account" });
            }
            const [removed] = accounts.splice(idx, 1);
            saveAccounts(accounts);
            return json(res, 200, { removed: publicUser(removed) });
        }

        // POST /api/admin/accounts/passwd
        if (method === "POST" && p === "/api/admin/accounts/passwd") {
            let body;
            try {
                body = await readBody(req);
            } catch {
                return json(res, 400, { error: "Invalid request body" });
            }
            const username = String(body.username || "").trim();
            const password = String(body.password || "");
            if (password.length < 4) {
                return json(res, 400, { error: "Password must be at least 4 characters" });
            }
            const accounts = loadAccounts();
            const account = accounts.find(a => String(a.username).toLowerCase() === username.toLowerCase());
            if (!account) return json(res, 404, { error: "Account not found" });
            setAccountPassword(account, password);
            saveAccounts(accounts);
            return json(res, 200, { ok: true });
        }
    }

    // POST /api/action — drive a claim handler (same code path as Discord)
    if (method === "POST" && p === "/api/action") {
        let body;
        try {
            body = await readBody(req);
        } catch {
            return json(res, 400, { error: "Invalid request body" });
        }
        const customId = String(body.customId || "").trim();
        if (!customId) return json(res, 400, { error: "customId required" });
        try {
            const result = await runClaimAction(account, {
                customId,
                type: body.type || "button",
                value: body.value,
                password: body.password
            });
            // State changed — next panels/history fetch must be fresh
            panelsCache = { at: 0, data: null };
            historyCacheHolder = { at: 0, data: null };
            return json(res, 200, result);
        } catch (err) {
            console.error("[Web] Action failed:", err);
            return json(res, 500, { error: "Action failed. Try again." });
        }
    }

    return json(res, 404, { error: "Not found" });
}

// ── Response caches ────────────────────────
let panelsCache = { at: 0, data: null };
let historyCacheHolder = { at: 0, data: null };
const PANELS_TTL_MS = 8000;
const HISTORY_TTL_MS = 4000;

function publicUser(account) {
    return {
        username: account.username,
        displayName: account.displayName || account.username,
        uid: account.uid,
        isAdmin: !!account.isAdmin,
        isMod: !!(account.isMod || account.isAdmin)
    };
}

// ── Server entry ───────────────────────────

/** Start the web server. No-op when WEB_ENABLED=false. @param {object} [opts] - {log} */
export function startWebServer(opts = {}) {
    if (process.env.WEB_ENABLED === "false") {
        opts.log && opts.log("[Web] Disabled (WEB_ENABLED=false).");
        return null;
    }

    const host = process.env.WEB_HOST || "0.0.0.0";
    const port = parseInt(process.env.WEB_PORT || "3000", 10);

    const server = http.createServer(async (req, res) => {
        try {
            const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
            if (url.pathname.startsWith("/api/")) {
                const ip = clientIp(req);
                if (!allowRequest(ip)) {
                    return json(res, 429, { error: "Rate limit exceeded. Slow down." });
                }
                return await handleApi(req, res, url, ip);
            }
            return serveStatic(req, res, url.pathname);
        } catch (err) {
            console.error("[Web] Request error:", err);
            if (!res.headersSent) {
                try { res.writeHead(500, { "Content-Type": "application/json" }); } catch { /* ignore */ }
                try { res.end(JSON.stringify({ error: "Internal error" })); } catch { /* ignore */ }
            }
        }
    });

    server.listen(port, host, () => {
        opts.log && opts.log(`[Web] Claim website running at http://${host === "0.0.0.0" ? "localhost" : host}:${port}`);
        opts.log && opts.log(`[Web] Accounts file: ./web-accounts.json — manage with: npm run web:adduser`);
        if (process.env.WEB_HTTPS === "true") {
            opts.log && opts.log("[Web] Secure cookies enabled — put this behind an HTTPS reverse proxy (nginx/caddy).");
        } else {
            opts.log && opts.log("[Web] ⚠️ Running without HTTPS — for public access, put the bot behind an HTTPS reverse proxy and set WEB_HTTPS=true.");
        }
    });

    server.on("error", err => {
        opts.log && opts.log(`[Web] Failed to start server on ${host}:${port}: ${err.message}`);
    });

    return server;
}
