// ==========================================
// 🔐 WEB ACCOUNTS — storage & password hashing
// Accounts live in web-accounts.json (separate
// from the bot's databases). Managed by the
// admin via `npm run web:adduser`.
// ==========================================

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ACCOUNTS_PATH = path.resolve("./web-accounts.json");

/** @returns {Array<object>} */
export function loadAccounts() {
    try {
        if (fs.existsSync(ACCOUNTS_PATH)) {
            const data = JSON.parse(fs.readFileSync(ACCOUNTS_PATH, "utf8"));
            return Array.isArray(data) ? data : [];
        }
    } catch (e) {
        console.error("[Web] Failed to read web-accounts.json:", e.message);
    }
    return [];
}

/** Persist the account list. @param {Array<object>} accounts */
export function saveAccounts(accounts) {
    fs.writeFileSync(ACCOUNTS_PATH, JSON.stringify(accounts, null, 2), "utf8");
}

export function findAccount(username) {
    const uname = String(username || "").trim().toLowerCase();
    return loadAccounts().find(a => String(a.username || "").toLowerCase() === uname) || null;
}

/** Build a new account object with a hashed password. @param {object} opts - {username, password, displayName, uid, isAdmin, isMod} @returns {object} */
export function createAccount(opts) {
    const salt = crypto.randomBytes(16).toString("hex");
    return {
        username: opts.username,
        displayName: opts.displayName || opts.username,
        uid: opts.uid || `web:${opts.username}`,
        isAdmin: !!opts.isAdmin,
        isMod: !!(opts.isMod || opts.isAdmin),
        salt,
        hash: hashPassword(opts.password, salt),
        createdAt: new Date().toISOString()
    };
}

/** Update an account's password in place. @param {object} account @param {string} newPassword */
export function setAccountPassword(account, newPassword) {
    account.salt = crypto.randomBytes(16).toString("hex");
    account.hash = hashPassword(newPassword, account.salt);
}

/** Hash a password with a per-user salt (scrypt). @param {string} password @param {string} salt @returns {string} */
export function hashPassword(password, salt) {
    return crypto.scryptSync(String(password), salt, 64).toString("hex");
}

/** Constant-time password verification. @param {string} password @param {object} account @returns {boolean} */
export function verifyPassword(password, account) {
    if (!account || !account.salt || !account.hash) return false;
    try {
        const actual = Buffer.from(hashPassword(password, account.salt), "hex");
        const expected = Buffer.from(account.hash, "hex");
        return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
    } catch {
        return false;
    }
}

// ── Sessions (in-memory — users re-login after a bot restart) ──

const sessions = new Map(); // token -> { username, expiresAt }
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** @returns {string} */
export function createSession(username) {
    const token = crypto.randomBytes(32).toString("hex");
    sessions.set(token, { username, expiresAt: Date.now() + SESSION_TTL_MS });
    return token;
}

/** @returns {string|null} username for a valid token */
export function getSessionUser(token) {
    if (!token) return null;
    const session = sessions.get(token);
    if (!session) return null;
    if (Date.now() > session.expiresAt) {
        sessions.delete(token);
        return null;
    }
    return session.username;
}

export function destroySession(token) {
    if (token) sessions.delete(token);
}

// ── Login rate limiting (brute-force protection) ──
// Per-username lockout stops credential guessing for a specific account.
// A separate, HIGH per-IP cap only trips under sustained abuse — important
// because behind a reverse proxy all users share the same IP, so a low cap
// would lock out everyone after a few typos.

const loginAttempts = new Map(); // key -> { count, resetAt }
const MAX_USER_ATTEMPTS = 5;     // per username, per 15 min
const MAX_IP_ATTEMPTS = 50;      // per IP, per 15 min (abuse only)
const LOCKOUT_MS = 15 * 60 * 1000;

function attemptKey(ip, username) {
    return `${ip}|${String(username || "").toLowerCase()}`;
}

function isLocked(key, maxAttempts) {
    const entry = loginAttempts.get(key);
    if (!entry) return false;
    if (Date.now() > entry.resetAt) {
        loginAttempts.delete(key);
        return false;
    }
    return entry.count >= maxAttempts;
}

/** Returns true if this username is locked out from this IP. */
export function isLoginLocked(ip, username) {
    return isLocked(attemptKey(ip, username), MAX_USER_ATTEMPTS) ||
        isLocked(attemptKey(ip, ""), MAX_IP_ATTEMPTS);
}

/** Record a failed login attempt (per username + per IP). */
export function recordFailedLogin(ip, username) {
    const now = Date.now();
    const userKey = attemptKey(ip, username);
    const userEntry = loginAttempts.get(userKey) || { count: 0, resetAt: now + LOCKOUT_MS };
    userEntry.count += 1;
    loginAttempts.set(userKey, userEntry);

    const ipKey = attemptKey(ip, "");
    const ipEntry = loginAttempts.get(ipKey) || { count: 0, resetAt: now + LOCKOUT_MS };
    ipEntry.count += 1;
    loginAttempts.set(ipKey, ipEntry);
}

export function clearFailedLogins(ip, username) {
    loginAttempts.delete(attemptKey(ip, username));
}
