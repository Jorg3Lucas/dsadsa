// ==========================================
// 🔗 REGISTRATION — Shared State & Helpers
// Single source of truth for registration request state,
// persistence, constants and the shared embed helper.
// Extracted from registration-panel.js
// ==========================================

import fs from 'fs';
import path from 'path';
import { EmbedBuilder } from 'discord.js';
import { runBackup } from '../auto-backup.js';
import { client } from '../core/state.js';
import { logger } from '../core/logger.js';

// ── Pending pilot registration requests (ownerId -> { pilotId, pilotTag, timestamp }) ──
export const pilotRequests = {};

// ── Pending owner registration requests (userId -> { nickname, userTag, ... }) ──
export const pendingOwnerRegistrations = {};

// ── Persistence ──
const REGISTRATION_REQUESTS_PATH = path.resolve('./registration-requests.json');
export const REQUEST_EXPIRY_MS = 48 * 60 * 60 * 1000; // 48 hours
export const CONFIRM_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

/** Save pilot and owner registration requests to disk. */
export function saveRegistrationRequests() {
    try {
        const data = { pilotRequests, pendingOwnerRegistrations };
        runBackup(['./registration-requests.json']);
        fs.writeFileSync(REGISTRATION_REQUESTS_PATH, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
        logger.error('Registration', 'Error saving registration requests', err);
    }
}

/** Load pilot and owner registration requests from disk. Cleans up already-expired entries. */
export function loadRegistrationRequests() {
    try {
        if (!fs.existsSync(REGISTRATION_REQUESTS_PATH)) return;
        const raw = fs.readFileSync(REGISTRATION_REQUESTS_PATH, 'utf8');
        const data = JSON.parse(raw);
        const now = Date.now();

        // Clean expired and restore valid
        if (data.pilotRequests) {
            for (const [key, req] of Object.entries(data.pilotRequests)) {
                if (now - req.timestamp <= REQUEST_EXPIRY_MS) {
                    pilotRequests[key] = req;
                }
            }
        }
        if (data.pendingOwnerRegistrations) {
            for (const [key, req] of Object.entries(data.pendingOwnerRegistrations)) {
                if (now - req.timestamp <= REQUEST_EXPIRY_MS) {
                    pendingOwnerRegistrations[key] = req;
                }
            }
        }

        logger.info('Registration', `Loaded ${Object.keys(pilotRequests).length} pilot request(s) and ${Object.keys(pendingOwnerRegistrations).length} owner registration request(s) from disk.`);
    } catch (err) {
        logger.error('Registration', 'Error loading registration requests', err);
    }
}

// ── Configuration ──
export const REG_PANEL_CUSTOM_ID = 'reg_panel';
export const BUTTON_IDS = {
    register: 'reg_register',
    registerPilot: 'reg_registerpilot',
    removePilot: 'reg_removepilot',
    sync: 'reg_sync',
    help: 'reg_help'
};

// ── Fixed-message embed titles (used to recover existing messages after a restart) ──
export const WELCOME_EMBED_TITLE = '👋 Welcome to the Server!';
export const REG_PANEL_EMBED_TITLE = '🎮 Character Registration System';

/** Build a branded embed consistent with the registration panel: colored bar, separator-ready description, footer with bot avatar + timestamp. @param {string} title @param {string} color @param {string} description @param {string} [footerText] @returns {import('discord.js').EmbedBuilder} */
export function regEmbed(title, color, description, footerText) {
    return new EmbedBuilder()
        .setTitle(title)
        .setColor(color)
        .setDescription(description)
        .setFooter({
            text: footerText || 'Character Registration System',
            iconURL: client?.user?.displayAvatarURL()
        })
        .setTimestamp();
}

/** Clean up expired pilot requests (call periodically). */
export function cleanupExpiredPilotRequests() {
    const now = Date.now();
    let changed = false;
    for (const [key, request] of Object.entries(pilotRequests)) {
        if (now - request.timestamp > REQUEST_EXPIRY_MS) {
            delete pilotRequests[key];
            changed = true;
        }
    }
    if (changed) saveRegistrationRequests();
}

/** Clean up expired pending owner registrations (48h expiry). */
export function cleanupExpiredOwnerRegistrations() {
    const now = Date.now();
    let changed = false;
    for (const [key, request] of Object.entries(pendingOwnerRegistrations)) {
        if (now - request.timestamp > REQUEST_EXPIRY_MS) {
            delete pendingOwnerRegistrations[key];
            changed = true;
        }
    }
    if (changed) saveRegistrationRequests();
}

// Run cleanup every 5 minutes
setInterval(cleanupExpiredPilotRequests, 300000);
setInterval(cleanupExpiredOwnerRegistrations, 300000);
