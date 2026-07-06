// ==========================================
// 🌐 CLAIM WEBSITE SERVER
// Allows users to make claims via web browser
// for regions where Discord is blocked
// ==========================================

import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import axios from 'axios';
import cookieParser from 'cookie-parser';
import 'dotenv/config';

import { db, saveLocalStorage } from './state.js';
import {
    hasActiveClaim,
    hasActiveQueue,
    checkPunishment,
    applyFiveMinCooldown,
    removeUserFromQueue,
    freeFloorAndActivateNextGracePeriod,
    freeAntidemonRoom,
    getAntidemonRoomKeys,
    getAntidemonRoomName,
    getSummonRoomKeys,
    getEventGroupKeys
} from './claim-core.js';
import { refreshVisualPanel, notifyUserDM } from './panel-utils.js';
import { pushToDailyLogs } from './daily-logs.js';
import { getLocalTime, getFormattedTime12h, parseStringToDate } from './time-utils.js';
import { STATUS_AVAILABLE, STATUS_CLAIMED, STATUS_OPEN } from './constants.js';

// ==========================================
// ⚙️ Configuration
// ==========================================

const PORT = parseInt(process.env.CLAIM_SITE_PORT || '3002', 10);
const BASE_URL = process.env.CLAIM_SITE_URL || `http://localhost:${PORT}`;

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || '';
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || '';
const DISCORD_REDIRECT_URI = `${BASE_URL}/auth/discord/callback`;

const SESSION_MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours

// ==========================================
// 🍪 Session Store (in-memory)
// ==========================================

const sessions = new Map();

function createSession(discordUser) {
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, {
        discordId: discordUser.id,
        username: discordUser.username,
        globalName: discordUser.global_name || discordUser.username,
        avatar: discordUser.avatar,
        discriminator: discordUser.discriminator,
        createdAt: Date.now(),
        lastAccess: Date.now()
    });
    // Clean expired sessions
    for (const [t, s] of sessions) {
        if (Date.now() - s.createdAt > SESSION_MAX_AGE) {
            sessions.delete(t);
        }
    }
    return token;
}

function getSession(token) {
    if (!token) return null;
    const session = sessions.get(token);
    if (!session) return null;
    if (Date.now() - session.createdAt > SESSION_MAX_AGE) {
        sessions.delete(token);
        return null;
    }
    session.lastAccess = Date.now();
    return session;
}

// ==========================================
// 🚀 Express App Setup
// ==========================================

const app = express();
app.use(express.json());
app.use(cookieParser());

// ==========================================
// 📁 Static Files
// ==========================================

const publicDir = path.resolve('./public');
if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
}
app.use(express.static(publicDir));

// ==========================================
// 🔐 Auth Middleware
// ==========================================

function requireAuth(req, res, next) {
    const token = req.cookies?.session_token;
    const session = getSession(token);
    if (!session) {
        return res.status(401).json({ error: 'Not authenticated', loginUrl: '/auth/discord' });
    }
    req.user = session;
    next();
}

// Store OAuth state tokens temporarily
const oauthStates = new Map();

// ==========================================
// 🔑 Discord OAuth2 Routes
// ==========================================

// GET /auth/discord — Redirect to Discord OAuth2
app.get('/auth/discord', (req, res) => {
    if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET) {
        return res.status(500).send('Discord OAuth2 not configured. Set DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET in .env');
    }
    
    // Generate random state parameter to prevent CSRF on the callback
    const state = crypto.randomBytes(16).toString('hex');
    oauthStates.set(state, Date.now());
    
    // Clean old state tokens (10 min TTL)
    for (const [s, t] of oauthStates) {
        if (Date.now() - t > 600000) oauthStates.delete(s);
    }
    
    const authorizeUrl = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(DISCORD_REDIRECT_URI)}&response_type=code&scope=identify&state=${state}`;
    res.redirect(authorizeUrl);
});

// GET /auth/discord/callback — Handle Discord OAuth2 callback
app.get('/auth/discord/callback', async (req, res) => {
    const { code, error, state } = req.query;
    
    // Verify state parameter to prevent CSRF
    if (!state || !oauthStates.has(state)) {
        console.warn('⚠️ OAuth state mismatch — possible CSRF attack');
        return res.redirect('/?auth=error');
    }
    oauthStates.delete(state);
    
    if (error || !code) {
        return res.redirect('/?auth=error');
    }

    try {
        // Exchange code for access token
        const tokenResp = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
            client_id: DISCORD_CLIENT_ID,
            client_secret: DISCORD_CLIENT_SECRET,
            grant_type: 'authorization_code',
            code,
            redirect_uri: DISCORD_REDIRECT_URI
        }), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        const accessToken = tokenResp.data.access_token;

        // Fetch user info
        const userResp = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        const discordUser = userResp.data;
        const sessionToken = createSession(discordUser);

        // Set session cookie
        res.cookie('session_token', sessionToken, {
            httpOnly: true,
            secure: BASE_URL.startsWith('https'),
            sameSite: 'lax',
            maxAge: SESSION_MAX_AGE
        });

        res.redirect('/');
    } catch (err) {
        console.error('❌ Discord OAuth2 error:', err.message);
        res.redirect('/?auth=error');
    }
});

// GET /auth/logout — Clear session
app.get('/auth/logout', (req, res) => {
    const token = req.cookies?.session_token;
    if (token) sessions.delete(token);
    res.clearCookie('session_token');
    res.redirect('/');
});

// GET /auth/me — Get current user info
app.get('/auth/me', requireAuth, (req, res) => {
    res.json({
        user: {
            id: req.user.discordId,
            username: req.user.username,
            globalName: req.user.globalName,
            avatar: req.user.avatar
        }
    });
});

// ==========================================
// 📊 Helper: Build simplified panel data for API
// ==========================================

function buildPanelSummary(key, current) {
    if (!current) return null;

    const summary = {
        key,
        title: current.title || key,
        type: current.type || 'unknown',
        ownerId: current.ownerId || null,
        ownerName: current.ownerName || null,
        timeWindow: current.timeWindow || '',
        hasQueue: !!(current.next),
        queueCount: 0,
        status: 'available',
        rooms: {}
    };

    // Calculate queue count
    if (current.next) {
        let ptr = current.next;
        while (ptr) {
            summary.queueCount++;
            ptr = ptr.nextQueue;
        }
    }

    if (summary.ownerId) summary.status = 'claimed';
    else if (summary.hasQueue) summary.status = 'has_queue';

    if (current.type === 'event_group') {
        const events = getEventGroupKeys(current);
        summary.events = {};
        for (const ev of events) {
            const evData = current[ev];
            summary.events[ev] = {
                name: evData.name,
                type: evData.type,
                ownerId: evData.ownerId || null,
                ownerName: evData.ownerName || null,
                timeWindow: evData.timeWindow || '',
                nextId: evData.nextId || null,
                nextName: evData.nextName || null,
                status: evData.status || STATUS_AVAILABLE,
                schedules: evData.schedules || null,
                scheduleMinutes: evData.scheduleMinutes || 0
            };
        }
    } else if (current.type === 'antidemon') {
        const roomKeys = getAntidemonRoomKeys(key);
        for (const rm of roomKeys) {
            const rData = current[rm];
            if (rData) {
                summary.rooms[rm] = {
                    name: getAntidemonRoomName(key, rm),
                    status: rData.status || STATUS_AVAILABLE,
                    ownerId: rData.ownerId || null,
                    ownerName: rData.ownerName || null,
                    timeWindow: rData.timeWindow || '',
                    nextId: rData.nextId || null,
                    nextName: rData.nextName || null,
                    password: rData.password || '',
                    hasQueue: !!rData.nextId
                };
            }
        }
    } else if (current.type === 'summon') {
        const summonProps = getSummonRoomKeys(key);
        for (const loc of summonProps) {
            const rData = current[loc];
            if (rData) {
                summary.rooms[loc] = {
                    name: rData.name,
                    status: rData.status || STATUS_AVAILABLE,
                    ownerId: rData.ownerId || null,
                    ownerName: rData.ownerName || null,
                    timeWindow: rData.timeWindow || '',
                    nextId: rData.nextId || null,
                    nextName: rData.nextName || null,
                    hasQueue: !!rData.nextId
                };
            }
        }
    } else if (current.type === 'peak' || current.type === 'normal') {
        for (const prop in current) {
            if (['title', 'timeWindow', 'next', 'ownerId', 'ownerName', 'type', 'schedules', '_claimTimestamp', 'scheduleMinutes'].includes(prop)) continue;
            const bossData = current[prop];
            if (bossData && typeof bossData === 'object') {
                summary.rooms[prop] = {
                    name: bossData.name,
                    status: bossData.status || STATUS_AVAILABLE,
                    cooldown: bossData.cooldown || 0,
                    _freeSince: bossData._freeSince || 0,
                    _lastKilledAt: bossData._lastKilledAt || 0
                };
            }
        }
    }

    return summary;
}

function getAllPanels() {
    const panels = {};
    for (const key in db) {
        if (key.startsWith('_') || !db[key]) continue;
        const summary = buildPanelSummary(key, db[key]);
        if (summary) panels[key] = summary;
    }
    return panels;
}

// ==========================================
// 📡 API Routes
// ==========================================

// GET /api/panels — Get all panels
app.get('/api/panels', (req, res) => {
    const panels = getAllPanels();
    res.json({ panels });
});

// GET /api/user/me — Get user info + active claims
app.get('/api/user/me', requireAuth, (req, res) => {
    const uid = req.user.discordId;
    const punishment = checkPunishment(uid);
    
    const activeClaims = [];
    const activeQueues = [];

    for (const key in db) {
        if (key.startsWith('_') || !db[key]) continue;
        const current = db[key];
        
        if (current.type === 'event_group') {
            const events = getEventGroupKeys(current);
            for (const ev of events) {
                const evData = current[ev];
                if (evData?.ownerId === uid) {
                    activeClaims.push({ panelKey: key, title: `${current.title} - ${evData.name}`, roomKey: ev, type: 'event_group' });
                }
                if (evData?.nextId === uid) {
                    activeQueues.push({ panelKey: key, title: `${current.title} - ${evData.name} (Queue)`, roomKey: ev, type: 'event_group' });
                }
            }
        } else if (current.type === 'antidemon') {
            const roomKeys = getAntidemonRoomKeys(key);
            for (const rm of roomKeys) {
                const rData = current[rm];
                if (rData?.ownerId === uid) {
                    activeClaims.push({ panelKey: key, title: `${current.title} - ${getAntidemonRoomName(key, rm)}`, roomKey: rm, type: 'antidemon' });
                }
                if (rData?.nextId === uid) {
                    activeQueues.push({ panelKey: key, title: `${current.title} - ${getAntidemonRoomName(key, rm)} (Queue)`, roomKey: rm, type: 'antidemon' });
                }
            }
        } else if (current.type === 'summon') {
            const summonProps = getSummonRoomKeys(key);
            for (const loc of summonProps) {
                const rData = current[loc];
                if (rData?.ownerId === uid) {
                    activeClaims.push({ panelKey: key, title: `${current.title} - ${rData.name}`, roomKey: loc, type: 'summon' });
                }
                if (rData?.nextId === uid) {
                    activeQueues.push({ panelKey: key, title: `${current.title} - ${rData.name} (Queue)`, roomKey: loc, type: 'summon' });
                }
            }
        } else {
            if (current.ownerId === uid) {
                activeClaims.push({ panelKey: key, title: current.title, roomKey: null, type: current.type });
            }
            if (current.next) {
                let ptr = current.next;
                while (ptr) {
                    if (ptr.userId === uid) {
                        activeQueues.push({ panelKey: key, title: `${current.title} (Queue)`, roomKey: null, type: current.type });
                    }
                    ptr = ptr.nextQueue;
                }
            }
        }
    }

    res.json({
        user: { id: uid, username: req.user.globalName || req.user.username },
        punishment,
        activeClaims,
        activeQueues
    });
});

// ==========================================
// 🎯 Claim Endpoints
// ==========================================

// POST /api/claim/floor — Claim a normal/peak floor
app.post('/api/claim/floor', requireAuth, async (req, res) => {
    const uid = req.user.discordId;
    const uName = req.user.globalName || req.user.username;
    const { panelKey } = req.body;

    if (!panelKey || !db[panelKey]) {
        return res.status(400).json({ error: 'Invalid panel key' });
    }

    const targetObj = db[panelKey];

    // Checks
    const pStr = checkPunishment(uid);
    if (pStr) return res.status(400).json({ error: pStr });

    if (hasActiveClaim(uid)) {
        return res.status(400).json({ error: 'You already have an active claim.' });
    }
    if (hasActiveQueue(uid) && targetObj.type !== 'peak') {
        return res.status(400).json({ error: 'You already have an active queue position.' });
    }

    // Check if reserved for someone else
    if (targetObj.next && targetObj.next.userId !== uid) {
        return res.status(400).json({ error: 'This floor is reserved for another player.' });
    }

    // Check if already claimed
    if (targetObj.ownerId) {
        return res.status(400).json({ error: 'This floor is already claimed.' });
    }

    // Perform claim (30 min window for normal, same for peak floors)
    const start = getLocalTime();
    const end = new Date(start.getTime() + 18e5); // 30 min
    const windowStr = `${getFormattedTime12h(start)} ~ ${getFormattedTime12h(end)}`;

    targetObj.ownerId = uid;
    targetObj.ownerName = uName;
    targetObj.timeWindow = windowStr;
    targetObj._claimTimestamp = start.getTime();

    // Remove from queue if they were next
    if (targetObj.next && targetObj.next.userId === uid) {
        targetObj.next = targetObj.next.nextQueue || null;
    }

    pushToDailyLogs('CLAIM_START', uName, targetObj.title, `Via Web: ${windowStr}`);
    notifyUserDM(uid, `🌐 **Claim Active (Web)**\n\nYou now control **${targetObj.title}**.\n⏳ Duration: **${windowStr}**.`);

    saveLocalStorage();
    await refreshVisualPanel(panelKey);

    res.json({ success: true, message: `✅ ${targetObj.title} claimed successfully!`, timeWindow: windowStr });
});

// POST /api/claim/antidemon — Claim an antidemon room
app.post('/api/claim/antidemon', requireAuth, async (req, res) => {
    const uid = req.user.discordId;
    const uName = req.user.globalName || req.user.username;
    const { panelKey, roomKey, tickets } = req.body;

    if (!panelKey || !db[panelKey] || !roomKey) {
        return res.status(400).json({ error: 'Invalid parameters' });
    }

    const targetFloor = db[panelKey];
    const rData = targetFloor[roomKey];
    if (!rData) return res.status(400).json({ error: 'Room not found' });

    const ticketValue = parseInt(tickets) || 1;
    if (ticketValue < 1 || ticketValue > 3) {
        return res.status(400).json({ error: 'Invalid ticket value (1-3)' });
    }

    // Checks
    const pStr = checkPunishment(uid);
    if (pStr) return res.status(400).json({ error: pStr });
    if (hasActiveClaim(uid)) return res.status(400).json({ error: 'You already have an active claim.' });

    // Check if room is taken
    if (rData.ownerId) {
        return res.status(400).json({ error: `${getAntidemonRoomName(panelKey, roomKey)} is already claimed.` });
    }
    // Check priority reservation
    if (rData.nextId && rData.nextId !== uid) {
        return res.status(400).json({ error: 'This room is reserved for another player.' });
    }

    const calcMinutes = 30 * ticketValue;
    const startTime = getLocalTime();
    const endTime = new Date(startTime.getTime() + 6e4 * calcMinutes);
    const rangeStr = `${getFormattedTime12h(startTime)} ~ ${getFormattedTime12h(endTime)}`;

    // Clear queue if they were next
    if (rData.nextId === uid) {
        rData.nextId = null;
        rData.nextName = null;
        rData.endLimit = null;
        rData.formattedTimeNext = '';
    }

    rData.status = STATUS_CLAIMED;
    rData.ownerId = uid;
    rData.ownerName = uName;
    rData.time = `${getFormattedTime12h(startTime)}\nto  ${getFormattedTime12h(endTime)}`;
    rData.timeWindow = rangeStr;

    const roomDisplay = getAntidemonRoomName(panelKey, roomKey);
    pushToDailyLogs('CLAIM_START', uName, `${targetFloor.title} - ${roomDisplay}`, `Via Web - ${ticketValue} ticket(s)`);
    notifyUserDM(uid, `🌐 **Claim Active (Web)**\n\nYou now control **${targetFloor.title} - ${roomDisplay}**.\n⏳ Duration: **${rangeStr}**.`);

    saveLocalStorage();
    await refreshVisualPanel(panelKey);

    res.json({ success: true, message: `✅ ${roomDisplay} claimed! (${ticketValue} ticket(s))`, timeWindow: rangeStr });
});

// POST /api/claim/summon — Claim a summon location
app.post('/api/claim/summon', requireAuth, async (req, res) => {
    const uid = req.user.discordId;
    const uName = req.user.globalName || req.user.username;
    const { panelKey, roomKey, tickets } = req.body;

    if (!panelKey || !db[panelKey] || !roomKey) {
        return res.status(400).json({ error: 'Invalid parameters' });
    }

    const targetFloor = db[panelKey];
    const rData = targetFloor[roomKey];
    if (!rData) return res.status(400).json({ error: 'Location not found' });

    const ticketValue = parseInt(tickets) || 1;
    if (ticketValue < 1 || ticketValue > 3) {
        return res.status(400).json({ error: 'Invalid ticket value (1-3)' });
    }

    // Checks
    const pStr = checkPunishment(uid);
    if (pStr) return res.status(400).json({ error: pStr });
    if (hasActiveClaim(uid)) return res.status(400).json({ error: 'You already have an active claim.' });

    if (rData.ownerId) {
        return res.status(400).json({ error: `${rData.name} is already claimed.` });
    }
    if (rData.nextId && rData.nextId !== uid) {
        return res.status(400).json({ error: 'This location is reserved for another player.' });
    }

    const calcMinutes = 30 * ticketValue;
    const startTime = getLocalTime();
    const endTime = new Date(startTime.getTime() + 6e4 * calcMinutes);
    const rangeStr = `${getFormattedTime12h(startTime)} ~ ${getFormattedTime12h(endTime)}`;

    if (rData.nextId === uid) {
        rData.nextId = null;
        rData.nextName = null;
        rData.endLimit = null;
        rData.formattedTimeNext = '';
    }

    rData.status = STATUS_CLAIMED;
    rData.ownerId = uid;
    rData.ownerName = uName;
    rData.time = `${getFormattedTime12h(startTime)}\nto  ${getFormattedTime12h(endTime)}`;
    rData.timeWindow = rangeStr;

    pushToDailyLogs('CLAIM_START', uName, `${targetFloor.title} - ${rData.name}`, `Via Web - ${ticketValue} ticket(s)`);
    notifyUserDM(uid, `🌐 **Claim Active (Web)**\n\nYou now control **${targetFloor.title} - ${rData.name}**.\n⏳ Duration: **${rangeStr}**.`);

    saveLocalStorage();
    await refreshVisualPanel(panelKey);

    res.json({ success: true, message: `✅ ${rData.name} claimed! (${ticketValue} ticket(s))`, timeWindow: rangeStr });
});

// POST /api/claim/event — Claim an event in an event_group
app.post('/api/claim/event', requireAuth, async (req, res) => {
    const uid = req.user.discordId;
    const uName = req.user.globalName || req.user.username;
    const { panelKey, eventKey, tickets } = req.body;

    if (!panelKey || !db[panelKey] || !eventKey) {
        return res.status(400).json({ error: 'Invalid parameters' });
    }

    const targetFloor = db[panelKey];
    const evData = targetFloor[eventKey];
    if (!evData) return res.status(400).json({ error: 'Event not found' });

    const pStr = checkPunishment(uid);
    if (pStr) return res.status(400).json({ error: pStr });
    if (hasActiveClaim(uid)) return res.status(400).json({ error: 'You already have an active claim.' });

    if (evData.ownerId) {
        return res.status(400).json({ error: `${evData.name} is already claimed.` });
    }

    if (evData.type === 'schedule') {
        // Schedule-type (Red Boss) — direct claim
        const now = getLocalTime();
        evData.ownerId = uid;
        evData.ownerName = uName;
        evData._claimTimestamp = now.getTime();

        pushToDailyLogs('CLAIM_START', uName, `${targetFloor.title} - ${evData.name}`, 'Via Web - Red Boss');
        notifyUserDM(uid, `🌐 **Claim Active (Web)**\n\nYou now control **${targetFloor.title} - ${evData.name}**.`);

        saveLocalStorage();
        await refreshVisualPanel(panelKey);
        res.json({ success: true, message: `✅ ${evData.name} claimed!` });
    } else if (evData.type === 'fixed') {
        // Fixed-type (Fury/Frenzy/Random Event)
        const now = getLocalTime();
        const minuteOffset = evData.scheduleMinutes || 0;
        
        // Find current event start
        let eventStart;
        const nowMinutes = now.getHours() * 60 + now.getMinutes();
        let foundHour = null;
        for (const h of (evData.schedules || [])) {
            const startMin = h * 60 + minuteOffset;
            const endMin = startMin + 60;
            if (nowMinutes >= startMin && nowMinutes < endMin) { foundHour = h; break; }
        }
        if (foundHour !== null) {
            eventStart = new Date(now.getTime());
            eventStart.setHours(foundHour, minuteOffset, 0, 0);
        } else {
            return res.status(400).json({ error: 'This event is not currently open.' });
        }

        const eventEnd = new Date(eventStart.getTime() + 60 * 60 * 1000);
        const windowStr = `${getFormattedTime12h(eventStart)} ~ ${getFormattedTime12h(eventEnd)}`;

        evData.ownerId = uid;
        evData.ownerName = uName;
        evData.timeWindow = windowStr;
        evData._claimTimestamp = now.getTime();

        pushToDailyLogs('CLAIM_START', uName, `${targetFloor.title} - ${evData.name}`, `Via Web - Fixed: ${windowStr}`);
        notifyUserDM(uid, `🌐 **Claim Active (Web)**\n\nYou now control **${targetFloor.title} - ${evData.name}**.\n⏳ Duration: **${windowStr}**.`);

        saveLocalStorage();
        await refreshVisualPanel(panelKey);
        res.json({ success: true, message: `✅ ${evData.name} secured!`, timeWindow: windowStr });
    } else if (evData.type === 'summon') {
        // Summon-type (Goblin) — need ticket selection
        const ticketValue = parseInt(tickets) || 1;
        if (ticketValue < 1 || ticketValue > 3) {
            return res.status(400).json({ error: 'Invalid ticket value (1-3)' });
        }

        const calcMinutes = 30 * ticketValue;
        const startTime = getLocalTime();
        const endTime = new Date(startTime.getTime() + 6e4 * calcMinutes);
        const rangeStr = `${getFormattedTime12h(startTime)} ~ ${getFormattedTime12h(endTime)}`;

        if (evData.nextId === uid) {
            evData.nextId = null;
            evData.nextName = null;
            evData.endLimit = null;
            evData.formattedTimeNext = '';
        }

        evData.status = STATUS_CLAIMED;
        evData.ownerId = uid;
        evData.ownerName = uName;
        evData.time = `${getFormattedTime12h(startTime)}\nto  ${getFormattedTime12h(endTime)}`;
        evData.timeWindow = rangeStr;

        pushToDailyLogs('CLAIM_START', uName, `${targetFloor.title} - ${evData.name}`, `Via Web - ${ticketValue} ticket(s)`);
        notifyUserDM(uid, `🌐 **Claim Active (Web)**\n\nYou now control **${targetFloor.title} - ${evData.name}**.\n⏳ Duration: **${rangeStr}**.`);

        saveLocalStorage();
        await refreshVisualPanel(panelKey);
        res.json({ success: true, message: `✅ ${evData.name} claimed!`, timeWindow: rangeStr });
    } else {
        res.status(400).json({ error: 'Unknown event type.' });
    }
});

// ==========================================
// 🚪 Cancel Endpoints
// ==========================================

// POST /api/cancel — Cancel a claim or queue position
app.post('/api/cancel', requireAuth, async (req, res) => {
    const uid = req.user.discordId;
    const uName = req.user.globalName || req.user.username;
    const { panelKey, roomKey } = req.body;

    if (!panelKey || !db[panelKey]) {
        return res.status(400).json({ error: 'Invalid panel key' });
    }

    const current = db[panelKey];
    let actionTaken = false;
    let penalized = false;

    if (current.type === 'event_group' && roomKey) {
        const evData = current[roomKey];
        if (!evData) return res.status(400).json({ error: 'Event not found' });

        if (evData.ownerId === uid) {
            pushToDailyLogs('CANCEL', evData.ownerName || uName, `${current.title} - ${evData.name}`, 'Via Web');
            notifyUserDM(uid, `🌐 **Claim Removed (Web)**\n\nYour claim on **${current.title} - ${evData.name}** has been canceled.`);

            if (evData.type === 'summon') {
                evData.status = STATUS_AVAILABLE;
                evData.ownerId = null;
                evData.ownerName = null;
                evData.time = '';
                evData.timeWindow = '';
                if (evData.nextId) {
                    const nid = evData.nextId, nname = evData.nextName;
                    evData.nextId = null;
                    evData.nextName = null;
                    evData.formattedTimeNext = '';
                    evData.ownerId = nid;
                    evData.ownerName = nname;
                    const grace = new Date(getLocalTime().getTime() + 3e5);
                    evData.timeWindow = `${getFormattedTime12h(new Date())} ~ ${getFormattedTime12h(grace)}`;
                    evData.status = STATUS_OPEN;
                    notifyUserDM(nid, `🟢 **Your Turn!**\n\n**${current.title} - ${evData.name}** is ready.`).catch(() => {});
                }
            } else {
                evData.ownerId = null;
                evData.ownerName = null;
                evData.timeWindow = '';
                if (evData._claimTimestamp) delete evData._claimTimestamp;
            }
            applyFiveMinCooldown(uid);
            penalized = true;
            actionTaken = true;
        }

        if (evData.nextId === uid) {
            pushToDailyLogs('CANCEL', evData.nextName || uName, `${current.title} - ${evData.name} (Queue)`, 'Via Web');
            notifyUserDM(uid, `🌐 **Queue Removed (Web)**\n\nYour queue position in **${current.title} - ${evData.name}** has been canceled.`);
            evData.nextId = null;
            evData.nextName = null;
            evData.endLimit = null;
            evData.formattedTimeNext = '';
            actionTaken = true;
        }
    } else if ((current.type === 'antidemon' || current.type === 'summon') && roomKey) {
        const rData = current[roomKey];
        if (!rData) return res.status(400).json({ error: 'Room not found' });

        if (rData.ownerId === uid) {
            const roomDisplay = current.type === 'antidemon' ? getAntidemonRoomName(panelKey, roomKey) : rData.name;
            pushToDailyLogs('CANCEL', rData.ownerName || uName, `${current.title} - ${roomDisplay}`, 'Via Web');
            notifyUserDM(uid, `🌐 **Claim Removed (Web)**\n\nYour claim on **${current.title} - ${roomDisplay}** has been canceled.`);
            freeAntidemonRoom(current, roomKey);
            applyFiveMinCooldown(uid);
            penalized = true;
            actionTaken = true;
        }

        if (rData.nextId === uid) {
            const roomDisplay = current.type === 'antidemon' ? getAntidemonRoomName(panelKey, roomKey) : rData.name;
            pushToDailyLogs('CANCEL', rData.nextName || uName, `${current.title} - ${roomDisplay} (Queue)`, 'Via Web');
            notifyUserDM(uid, `🌐 **Queue Removed (Web)**\n\nYour queue position in **${current.title} - ${roomDisplay}** has been canceled.`);
            rData.nextId = null;
            rData.nextName = null;
            rData.endLimit = null;
            rData.formattedTimeNext = '';
            if (rData.status === STATUS_OPEN) rData.status = STATUS_AVAILABLE;
            actionTaken = true;
        }
    } else {
        // Floor-level cancel
        if (current.ownerId === uid) {
            pushToDailyLogs('CANCEL', current.ownerName, current.title, 'Via Web');
            notifyUserDM(uid, `🌐 **Claim Removed (Web)**\n\nYour claim on **${current.title}** has been canceled.`);
            freeFloorAndActivateNextGracePeriod(current);
            applyFiveMinCooldown(uid);
            penalized = true;
            actionTaken = true;
        }

        if (current.next) {
            let ptr = current.next;
            while (ptr) {
                if (ptr.userId === uid) {
                    pushToDailyLogs('CANCEL', uName, current.title, 'Via Web - Queue');
                    notifyUserDM(uid, `🌐 **Queue Removed (Web)**\n\nYour queue position in **${current.title}** has been canceled.`);
                    removeUserFromQueue(current, uid);
                    actionTaken = true;
                    break;
                }
                ptr = ptr.nextQueue;
            }
        }
    }

    if (actionTaken) {
        saveLocalStorage();
        await refreshVisualPanel(panelKey);
        res.json({
            success: true,
            message: penalized ? '✅ Claim canceled (5min cooldown applied).' : '✅ Action completed.'
        });
    } else {
        res.status(400).json({ error: 'No active claim or queue found for you.' });
    }
});

// ==========================================
// ⏭️ Queue Endpoints
// ==========================================

// POST /api/queue/join — Join a queue
app.post('/api/queue/join', requireAuth, async (req, res) => {
    const uid = req.user.discordId;
    const uName = req.user.globalName || req.user.username;
    const { panelKey, roomKey } = req.body;

    if (!panelKey || !db[panelKey]) {
        return res.status(400).json({ error: 'Invalid panel key' });
    }

    const pStr = checkPunishment(uid);
    if (pStr) return res.status(400).json({ error: pStr });
    if (hasActiveClaim(uid)) return res.status(400).json({ error: 'You already have an active claim.' });
    if (hasActiveQueue(uid)) return res.status(400).json({ error: 'You already have an active queue position.' });

    const current = db[panelKey];

    if (current.type === 'event_group' && roomKey) {
        const evData = current[roomKey];
        if (!evData) return res.status(400).json({ error: 'Event not found' });
        if (evData.type !== 'summon') return res.status(400).json({ error: 'Only summon events support queue.' });
        if (evData.nextId) return res.status(400).json({ error: 'Someone is already in queue.' });
        if (!evData.ownerId) return res.status(400).json({ error: 'This event is not currently claimed.' });
        if (evData.ownerId === uid) return res.status(400).json({ error: 'You already own this.' });

        evData.nextId = uid;
        evData.nextName = uName;
        evData.formattedTimeNext = getFormattedTime12h(getLocalTime());
        evData.endLimit = null;

        pushToDailyLogs('QUEUE_JOIN', uName, `${current.title} - ${evData.name}`, 'Via Web');
        notifyUserDM(uid, `🌐 **Queue Joined (Web)**\n\nYou are now in line for **${current.title} - ${evData.name}**.`);
    } else if ((current.type === 'antidemon' || current.type === 'summon') && roomKey) {
        const rData = current[roomKey];
        if (!rData) return res.status(400).json({ error: 'Room not found' });
        if (rData.nextId) return res.status(400).json({ error: 'Someone is already in queue.' });
        if (rData.status !== STATUS_CLAIMED) return res.status(400).json({ error: 'This room is not currently claimed.' });
        if (rData.ownerId === uid) return res.status(400).json({ error: 'You already own this.' });

        const baseTime = getLocalTime();
        rData.nextId = uid;
        rData.nextName = uName;
        rData.formattedTimeNext = getFormattedTime12h(baseTime);
        rData.endLimit = null;

        const roomDisplay = current.type === 'antidemon' ? getAntidemonRoomName(panelKey, roomKey) : rData.name;
        pushToDailyLogs('QUEUE_JOIN', uName, `${current.title} - ${roomDisplay}`, 'Via Web');
        notifyUserDM(uid, `🌐 **Queue Joined (Web)**\n\nYou are now in line for **${current.title} - ${roomDisplay}**.`);
    } else {
        // Floor-level queue
        if (current.type === 'peak') return res.status(400).json({ error: 'Peak floors do not support queue.' });
        if (current.ownerId === uid) return res.status(400).json({ error: 'You already own this floor.' });

        // Check if already in queue
        let inQueue = false;
        let ptr = current.next;
        while (ptr) {
            if (ptr.userId === uid) { inQueue = true; break; }
            ptr = ptr.nextQueue;
        }
        if (inQueue) return res.status(400).json({ error: 'You are already in the queue.' });

        const expectedTime = current.timeWindow
            ? (parseStringToDate(current.timeWindow.split(' ~ ')[1]) || getLocalTime())
            : getLocalTime();

        const node = {
            userId: uid,
            userName: uName,
            formattedTime: getFormattedTime12h(expectedTime),
            endLimit: null,
            nextQueue: null
        };

        if (current.next) {
            let lastNode = current.next;
            while (lastNode.nextQueue) lastNode = lastNode.nextQueue;
            lastNode.nextQueue = node;
        } else {
            current.next = node;
        }

        pushToDailyLogs('QUEUE_JOIN', uName, current.title, 'Via Web');
        notifyUserDM(uid, `🌐 **Queue Joined (Web)**\n\nYou are now in line for **${current.title}**.`);
    }

    saveLocalStorage();
    await refreshVisualPanel(panelKey);
    res.json({ success: true, message: '✅ Joined the queue!' });
});

// ==========================================
// 🎨 Serve Frontend
// ==========================================

// Serve the main HTML for all non-API routes
app.get('/', (req, res) => {
    const indexPath = path.resolve(publicDir, 'index.html');
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.status(200).send('Claim website not yet built. Run the bot to initialize.');
    }
});

// ==========================================
// 🌍 Global Error Handler
// ==========================================

app.use((err, req, res, _next) => {
    console.error('❌ [Claim Web Server Error]', err.message);
    if (process.env.NODE_ENV !== 'production') {
        console.error(err.stack);
    }
    res.status(500).json({ error: 'Internal server error' });
});

// ==========================================
// 🚀 Start Server
// ==========================================

let serverInstance = null;

export function startClaimWebServer() {
    if (serverInstance) {
        console.log('⚠️ Claim web server already running.');
        return;
    }

    if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET) {
        console.warn('⚠️ CLAIM SITE: Discord OAuth2 not configured.');
        console.warn('   To enable the claim website, add these to your .env file:');
        console.warn('   ┌─────────────────────────────────────────────────────┐');
        console.warn('   │ DISCORD_CLIENT_ID=your_app_client_id               │');
        console.warn('   │ DISCORD_CLIENT_SECRET=your_app_client_secret       │');
        console.warn('   │ CLAIM_SITE_URL=https://your-public-url.com         │');
        console.warn('   │ CLAIM_SITE_PORT=3002                               │');
        console.warn('   └─────────────────────────────────────────────────────┘');
        console.warn('   Discord Developer Portal → OAuth2 → Add redirect:');
        console.warn(`   ${BASE_URL}/auth/discord/callback`);
        console.warn('   The claim website will not work without authentication.');
    }

    serverInstance = app.listen(PORT, () => {
        console.log(`🌐 Claim website server running on ${BASE_URL}`);
        console.log(`📌 Login URL: ${BASE_URL}/auth/discord`);
        console.log(`📌 API: ${BASE_URL}/api/panels`);
        if (DISCORD_CLIENT_ID) {
            console.log(`📌 Discord OAuth2 Redirect URI: ${DISCORD_REDIRECT_URI}`);
        }
    });
}

export function stopClaimWebServer() {
    if (serverInstance) {
        serverInstance.close();
        serverInstance = null;
        console.log('🌐 Claim web server stopped.');
    }
}

export default {
    startClaimWebServer,
    stopClaimWebServer
};
