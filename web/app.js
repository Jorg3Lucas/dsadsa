// ==========================================
// 🎮 MIR4 Claim — frontend logic (English)
// Hero stats, searchable status-colored cards,
// a detail drawer, history and admin views.
// Drives the SAME claim handlers the bot uses.
// ==========================================

"use strict";

const $ = id => document.getElementById(id);

let user = null;
let panels = [];
let upcomingEvents = [];
let historyCache = null;
let pollTimer = null;
let activeTab = "panels";
let openPanelKey = null;
let searchQuery = "";
let historyType = "all";
let animateCards = true; // only animate on first load / search, not on polls
let kickOpen = false;   // admin: kick list toggle in the drawer

// Pending multi-step flows per panel (menus / password modal)
const pendingFlows = new Map();

// ── Toast ──────────────────────────────────
let toastTimer = null;
function toast(message, kind = "") {
    const el = $("toast");
    if (!message) { el.classList.add("hidden"); return; }
    el.textContent = message;
    el.className = `toast ${kind}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add("hidden"), 5000);
}

async function api(path, options = {}) {
    const res = await fetch(path, {
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        ...options
    });
    let data = {};
    try { data = await res.json(); } catch { /* empty */ }
    if (!res.ok) {
        const err = new Error(data.error || `HTTP ${res.status}`);
        err.status = res.status;
        throw err;
    }
    return data;
}

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
}

// ── Auth ───────────────────────────────────
$("login-form").addEventListener("submit", async e => {
    e.preventDefault();
    const btn = $("login-btn");
    btn.disabled = true;
    $("login-error").textContent = "";
    try {
        const data = await api("/api/login", {
            method: "POST",
            body: JSON.stringify({
                username: $("username").value.trim(),
                password: $("password").value
            })
        });
        user = data.user;
        startApp();
    } catch (err) {
        $("login-error").textContent = err.message;
    } finally {
        btn.disabled = false;
    }
});

$("logout-btn").addEventListener("click", async () => {
    try { await api("/api/logout", { method: "POST" }); } catch { /* ignore */ }
    user = null;
    stopApp();
    showLogin();
    $("password").value = "";
});

async function checkSession() {
    try {
        const data = await api("/api/me");
        user = data.user;
        startApp();
    } catch {
        showLogin();
    }
}

function showLogin() {
    $("view-login").classList.remove("hidden");
    $("app").classList.add("hidden");
}

// ── App loop ───────────────────────────────
function startApp() {
    $("view-login").classList.add("hidden");
    $("app").classList.remove("hidden");
    $("user-name").textContent = user.displayName || user.username;
    $("tab-admin").classList.toggle("hidden", !user.isAdmin);
    switchTab("panels");
    clearInterval(pollTimer);
    pollTimer = setInterval(refreshAll, 15000);
}

function stopApp() {
    clearInterval(pollTimer);
    pollTimer = null;
    pendingFlows.clear();
    closeDrawer();
}

async function refreshAll() {
    try {
        const data = await api("/api/panels");
        panels = data.panels || [];
        upcomingEvents = data.upcomingEvents || [];
        setLive(true);
        renderCurrent();
    } catch (err) {
        if (err.status === 401) {
            stopApp();
            showLogin();
            return;
        }
        setLive(false);
    }
}

// ── Live indicator ────────────────────────
function setLive(ok) {
    const ind = $("live-indicator");
    if (!ind) return;
    ind.classList.toggle("offline", !ok);
    if (ok) {
        $("updated-at").textContent = `live · ${new Date().toLocaleTimeString("en-US", { hour12: false })}`;
    } else {
        $("updated-at").textContent = "offline";
    }
}

// ── Tabs ───────────────────────────────────
function switchTab(name) {
    activeTab = name;
    for (const tab of ["panels", "events", "history", "admin"]) {
        $(`tab-${tab}`).classList.toggle("active", tab === name);
    }
    renderCurrent();
}

$("tab-panels").addEventListener("click", () => switchTab("panels"));
$("tab-events").addEventListener("click", () => switchTab("events"));
$("tab-history").addEventListener("click", () => { switchTab("history"); loadHistory(); });
$("tab-admin").addEventListener("click", () => { switchTab("admin"); loadAdminAccounts(); });

function renderCurrent() {
    if (activeTab === "panels") renderPanels();
    if (activeTab === "events") renderEvents();
    if (openPanelKey) renderDrawer(openPanelKey);
}

// ── Panels grid ────────────────────────────
const GROUP_META = {
    peak: { label: "Secret Peak", icon: "🏔️" },
    normal: { label: "Magic Square", icon: "🗺️" },
    antidemon: { label: "Antidemon", icon: "👹" },
    summon: { label: "Summons", icon: "🌀" },
    event_group: { label: "Events", icon: "🎉" },
    fixed: { label: "Random Event", icon: "🎲" }
};
const OTHER_META = { label: "Other", icon: "🗂️" };

function panelMeta(panel) {
    return GROUP_META[panel.type] || OTHER_META;
}

function floorNum(panel) {
    const m = (panel.key || "").match(/^(\d+)/);
    return m ? parseInt(m[1], 10) : 99;
}

function panelCompare(a, b) {
    const fa = floorNum(a), fb = floorNum(b);
    if (fa !== fb) return fa - fb;
    return (a.title || "").localeCompare(b.title || "");
}

function statusClass(color) {
    if (!color) return "st-default";
    const c = color.toLowerCase();
    if (c === "#5865f2") return "st-occupied";
    if (c === "#fee75c") return "st-queue";
    if (c === "#57f287") return "st-open";
    return "st-default";
}

function statusLabel(panel) {
    switch (statusClass(panel.color)) {
        case "st-occupied": return "Occupied";
        case "st-queue": return "Queued";
        case "st-open": return "Open";
        default: return "Available";
    }
}

function renderPanels() {
    const main = $("main");
    main.textContent = "";

    // First load — skeletons while data arrives
    if (!panels.length) {
        const grid = el("div", "panel-grid");
        for (let i = 0; i < 8; i++) {
            const sk = el("div", "panel-card skeleton");
            sk.appendChild(el("div", "sk-line sk-title"));
            sk.appendChild(el("div", "sk-line"));
            sk.appendChild(el("div", "sk-line sk-short"));
            grid.appendChild(sk);
        }
        main.appendChild(grid);
        return;
    }

    const col = el("div", "panels-col");
    col.appendChild(renderHero());

    // Search bar
    const searchBar = el("div", "search-bar");
    const input = el("input");
    input.type = "text";
    input.placeholder = "🔎 Search panels...";
    input.value = searchQuery;
    input.addEventListener("input", () => {
        searchQuery = input.value.trim().toLowerCase();
        animateCards = true;
        renderPanels();
    });
    searchBar.appendChild(input);
    col.appendChild(searchBar);

    const filtered = panels.filter(p => {
        if (!searchQuery) return true;
        return `${p.title} ${p.key} ${p.type}`.toLowerCase().includes(searchQuery);
    });

    if (!filtered.length) {
        const empty = el("div", "empty-state");
        empty.appendChild(el("div", "empty-icon", "🔍"));
        empty.appendChild(el("p", null, "No panels match your search."));
        col.appendChild(empty);
        main.appendChild(col);
        return;
    }

    const groups = new Map();
    for (const panel of filtered) {
        const meta = panelMeta(panel);
        const key = `${meta.icon} ${meta.label}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(panel);
    }

    let index = 0;
    for (const [label, list] of groups) {
        list.sort(panelCompare);
        const head = el("div", "group-title");
        head.appendChild(el("span", null, label));
        head.appendChild(el("span", "group-count", String(list.length)));
        col.appendChild(head);
        const grid = el("div", "panel-grid");
        for (const panel of list) {
            const card = renderPanelCard(panel);
            if (animateCards) card.style.animationDelay = `${Math.min(index * 25, 300)}ms`;
            grid.appendChild(card);
            index++;
        }
        col.appendChild(grid);
    }
    animateCards = false;

    main.appendChild(col);
}

function renderHero() {
    let total = 0, occupied = 0, queued = 0, open = 0;
    for (const p of panels) {
        total++;
        switch (statusClass(p.color)) {
            case "st-occupied": occupied++; break;
            case "st-queue": queued++; break;
            case "st-open": open++; break;
        }
    }
    const hero = el("div", "hero");
    const item = (num, label, cls) => {
        const d = el("div", `hero-item ${cls}`);
        d.appendChild(el("span", "hero-num", String(num)));
        d.appendChild(el("span", "hero-label", label));
        return d;
    };
    hero.append(
        item(total, "Panels", ""),
        item(occupied, "Occupied", "occupied"),
        item(queued, "Queued", "queue"),
        item(open, "Open", "open")
    );
    return hero;
}

// ── Events tab (dedicated — live spawn countdowns) ──
const SOURCE_META = {
    respawn: { icon: "💀", label: "Boss respawns", cls: "src-respawn" },
    spawn: { icon: "⏰", label: "Scheduled events", cls: "src-spawn" },
    open: { icon: "🚪", label: "Event openings", cls: "src-open" },
    world: { icon: "🌍", label: "World bosses", cls: "src-world" },
    weekly: { icon: "📅", label: "Weekly events", cls: "src-weekly" }
};
const SOURCE_ORDER = ["respawn", "spawn", "open", "world", "weekly"];

function formatCountdown(ms) {
    if (ms <= 0) return "now";
    const total = Math.floor(ms / 1000);
    const d = Math.floor(total / 86400);
    const h = Math.floor((total % 86400) / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
    if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
    return `${s}s`;
}

function renderEvents() {
    const main = $("main");
    main.textContent = "";
    const view = el("div", "events-view");

    if (!upcomingEvents.length) {
        const empty = el("div", "empty-state");
        empty.appendChild(el("div", "empty-icon", "⏰"));
        empty.appendChild(el("p", null, "No upcoming events."));
        view.appendChild(empty);
        main.appendChild(view);
        return;
    }

    // Header strip: the very next spawn highlighted
    const next = upcomingEvents[0];
    const head = el("div", "events-head");
    const nextBox = el("div", "events-next");
    nextBox.appendChild(el("span", "en-label", "🎯 Next spawn"));
    nextBox.appendChild(el("span", "en-name", `${(SOURCE_META[next.source] || {}).icon || "•"} ${next.name}`));
    nextBox.appendChild(el("span", "en-panel", next.panel));
    const nextCd = el("span", "ev-countdown en-countdown", formatCountdown(next.date - Date.now()));
    nextCd.dataset.date = String(next.date);
    nextBox.appendChild(nextCd);
    head.appendChild(nextBox);
    head.appendChild(el("span", "events-total", `${upcomingEvents.length} upcoming events`));
    view.appendChild(head);

    for (const src of SOURCE_ORDER) {
        const list = upcomingEvents.filter(e => e.source === src);
        if (!list.length) continue;
        const meta = SOURCE_META[src] || { icon: "•", label: src, cls: "" };
        const gtitle = el("div", "group-title");
        gtitle.appendChild(el("span", null, `${meta.icon} ${meta.label}`));
        gtitle.appendChild(el("span", "group-count", String(list.length)));
        view.appendChild(gtitle);
        for (const ev of list) view.appendChild(renderEventRow(ev, ev.date === upcomingEvents[0].date));
    }

    main.appendChild(view);
    updateCountdowns();
}

function renderEventRow(ev, isNext) {
    const meta = SOURCE_META[ev.source] || { icon: "•", cls: "" };
    const row = el("div", `event-row${isNext ? " next" : ""} ${meta.cls || ""}`);
    const icon = el("span", "ev-icon", meta.icon);
    row.appendChild(icon);
    const info = el("div", "ev-info");
    info.appendChild(el("div", "ev-name", ev.name));
    info.appendChild(el("div", "ev-panel", ev.panel));
    row.appendChild(info);
    row.appendChild(el("span", "ev-time", ev.timeLabel));
    const cd = el("span", "ev-countdown", formatCountdown(ev.date - Date.now()));
    cd.dataset.date = String(ev.date);
    row.appendChild(cd);
    return row;
}

// Live ticking countdowns — 1s tick, only while the Events tab is open
function updateCountdowns() {
    document.querySelectorAll(".ev-countdown").forEach(cd => {
        const target = parseInt(cd.dataset.date || "0", 10);
        if (!target) return;
        const text = formatCountdown(target - Date.now());
        if (cd.textContent !== text) cd.textContent = text;
    });
}
setInterval(() => {
    if (activeTab === "events") updateCountdowns();
}, 1000);

function renderPanelCard(panel) {
    const card = el("div", `panel-card ${statusClass(panel.color)}${animateCards ? "" : " no-anim"}`);
    const head = el("div", "card-head");
    head.appendChild(el("span", "card-icon", panelMeta(panel).icon));
    head.appendChild(el("h3", null, panel.embed && panel.embed.title ? panel.embed.title : panel.title));
    card.appendChild(head);

    const summary = el("div", "summary", panel.summary || "🟢 Available");
    card.appendChild(summary);

    const foot = el("div", "card-foot");
    const cls = statusClass(panel.color);
    foot.appendChild(el("span", `status-chip ${cls}`, statusLabel(panel)));
    foot.appendChild(el("span", "card-hint", "details →"));
    card.appendChild(foot);

    card.addEventListener("click", () => openDrawer(panel.key));
    return card;
}

// ── Detail drawer ──────────────────────────
function openDrawer(panelKey) {
    openPanelKey = panelKey;
    $("drawer-backdrop").classList.remove("hidden");
    $("drawer").classList.remove("hidden");
    renderDrawer(panelKey);
    // Fresh per-panel history for the detail view
    api("/api/history").then(data => {
        historyCache = data;
        if (openPanelKey === panelKey) renderDrawerHistory(panelKey);
    }).catch(() => {});
}

function closeDrawer() {
    openPanelKey = null;
    kickOpen = false;
    $("drawer-backdrop").classList.add("hidden");
    $("drawer").classList.add("hidden");
}

$("drawer-close").addEventListener("click", closeDrawer);
$("drawer-backdrop").addEventListener("click", closeDrawer);
document.addEventListener("keydown", e => {
    if (e.key === "Escape" && openPanelKey) closeDrawer();
});

function getPanel(key) {
    return panels.find(p => p.key === key) || null;
}

function renderDrawer(panelKey) {
    const panel = getPanel(panelKey);
    if (!panel) { closeDrawer(); return; }

    $("drawer-title").textContent = panel.embed && panel.embed.title ? panel.embed.title : panel.title;

    // Color accent by panel state
    const drawer = $("drawer");
    drawer.classList.remove("accent-occupied", "accent-queue", "accent-open", "accent-default");
    drawer.classList.add(`accent-${statusClass(panel.color).replace("st-", "")}`);

    const body = $("drawer-body");
    body.textContent = "";

    // Type badge
    const meta = panelMeta(panel);
    const badgeRow = el("div", "drawer-badges");
    badgeRow.appendChild(el("span", "type-badge", `${meta.icon} ${meta.label}`));
    badgeRow.appendChild(el("span", `status-chip ${statusClass(panel.color)}`, statusLabel(panel)));
    body.appendChild(badgeRow);

    // Live status
    const status = el("div", "detail-status");
    const desc = (panel.embed.description || "").replace(/^Status Overview\s*$/m, "").trim();
    if (desc) status.appendChild(el("div", null, desc));
    for (const field of panel.embed.fields || []) {
        const f = el("div", "detail-field");
        if (field.name) f.appendChild(el("div", "df-name", field.name));
        f.appendChild(el("div", "df-value", field.value));
        status.appendChild(f);
    }
    if (!status.childNodes.length) status.appendChild(el("div", null, "🟢 Available"));
    body.appendChild(status);

    // Buttons — the exact same ones as the Discord panel
    const actions = el("div", "detail-actions");
    for (const btn of panel.buttons || []) {
        const b = el("button", discordStyleClass(btn.style), `${btn.emoji || ""} ${btn.label || ""}`.trim());
        if (btn.disabled) b.disabled = true;
        b.title = btn.customId;
        b.addEventListener("click", () => postAction(panel.key, { customId: btn.customId, type: "button" }, b));
        actions.appendChild(b);
    }
    if (actions.childNodes.length) body.appendChild(actions);

    // Multi-step flow (menus / password)
    if (pendingFlows.has(panel.key)) {
        body.appendChild(renderFlow(panel.key, pendingFlows.get(panel.key)));
    }

    // Admin tools (mods/admins only) — reset, kick, reserve
    if (user && (user.isMod || user.isAdmin)) {
        body.appendChild(renderAdminTools(panel));
    }

    // Per-panel recent history
    body.appendChild(el("div", "detail-section-title", "🕘 Panel history"));
    const histBox = el("div");
    histBox.id = "drawer-history";
    histBox.appendChild(el("p", "hint", "Loading..."));
    body.appendChild(histBox);
    if (historyCache) renderDrawerHistory(panelKey);
}

function renderDrawerHistory(panelKey) {
    const panel = getPanel(panelKey);
    const box = $("drawer-history");
    if (!box || !panel || !historyCache) return;

    box.textContent = "";
    const title = (panel.title || "").toLowerCase();
    const entries = (historyCache.logs || []).filter(log => {
        const room = (log.targetRoom || "").toLowerCase();
        return room.includes(title) || title.includes(room);
    }).slice(0, 20);

    if (!entries.length) {
        box.appendChild(el("p", "hint", "No recent activity for this panel."));
        return;
    }
    for (const entry of entries) box.appendChild(renderLogEntry(entry));
}

// ── Admin tools (drawer) ───────────────────
function renderAdminTools(panel) {
    const box = el("div", "admin-tools");
    box.appendChild(el("div", "detail-section-title", "🛠️ Admin tools"));

    // Reset panel(s)
    const resetRow = el("div", "detail-actions");
    const resetBtn = el("button", "btn-ghost-b", "🔄 Reset this panel");
    resetBtn.addEventListener("click", () => postAction(panel.key, { customId: "admin-reset-menu", type: "select", value: panel.key }));
    const resetAllBtn = el("button", "btn-ghost-b", "🧹 Reset ALL");
    resetAllBtn.addEventListener("click", () => {
        if (!confirm("Reset ALL panels to defaults?")) return;
        postAction(panel.key, { customId: "admin-reset-menu", type: "select", value: "__all__" });
    });
    resetRow.append(resetBtn, resetAllBtn);
    box.appendChild(resetRow);

    // Kick user (from this panel's current claims)
    const kickBtn = el("button", "btn-ghost-b", "👢 Kick user");
    kickBtn.addEventListener("click", () => {
        kickOpen = !kickOpen;
        renderDrawer(panel.key);
    });
    box.appendChild(kickBtn);
    if (kickOpen) {
        const kickList = el("div", "kick-list");
        const options = buildKickOptions(panel);
        if (!options.length) {
            kickList.appendChild(el("p", "hint", "No active claims to kick."));
        }
        for (const opt of options) {
            const row = el("div", "kick-row");
            row.appendChild(el("span", null, opt.label));
            const b = el("button", "btn-cancel", "Kick");
            b.addEventListener("click", () => postAction(panel.key, { customId: "admin-kick-menu", type: "select", value: opt.value }));
            row.appendChild(b);
            kickList.appendChild(row);
        }
        box.appendChild(kickList);
    }

    // Reserve Fury / Frenzy
    const reserveRow = el("div", "detail-actions");
    for (const [ev, label] of [["fury", "📅 Reserve Fury"], ["frenzy", "📅 Reserve Frenzy"]]) {
        const b = el("button", "btn-ghost-b", label);
        b.addEventListener("click", () => postAction(panel.key, { customId: "reserve-select-event", type: "select", value: ev }));
        reserveRow.appendChild(b);
    }
    box.appendChild(reserveRow);

    return box;
}

function buildKickOptions(panel) {
    const opts = [];
    if (panel.ownerId && panel.ownerName) {
        opts.push({ label: `${panel.ownerName} (floor)`, value: `kick-${panel.key}-floor-${panel.ownerId}` });
    }
    for (const sub of panel.subs || []) {
        if (sub.ownerId && sub.ownerName) {
            opts.push({ label: `${sub.ownerName} — ${sub.name}`, value: `kick-${panel.key}-${sub.room}-${sub.ownerId}` });
        }
    }
    return opts;
}

// ── Actions ────────────────────────────────
function discordStyleClass(style) {
    switch (style) {
        case 3: return "btn-claim";    // Success (green)
        case 4: return "btn-cancel";   // Danger (red)
        case 1: return "btn-next";     // Primary (accent)
        default: return "btn-ghost-b"; // Secondary (gray)
    }
}

async function postAction(panelKey, payload, btn) {
    const original = btn ? btn.textContent : null;
    if (btn) {
        btn.disabled = true;
        btn.textContent = "...";
    }
    try {
        const result = await api("/api/action", { method: "POST", body: JSON.stringify(payload) });
        handleActionResult(panelKey, result);
    } catch (err) {
        toast(`❌ ${err.message}`, "error");
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = original;
        }
    }
}

function handleActionResult(panelKey, result) {
    if (result.message) toast(result.message, result.menu || result.modal ? "" : "success");
    if (result.menu || result.modal) {
        pendingFlows.set(panelKey, { menu: result.menu || [], modal: result.modal || null });
    } else {
        pendingFlows.delete(panelKey);
    }
    refreshAll();
}

// ── Flow rendering (selects / buttons / password modal) ──
function renderFlow(panelKey, flow) {
    const box = el("div", "flow");

    if (flow.modal) {
        const input = el("input");
        input.type = "text";
        input.placeholder = flow.modal.fields[0]?.label || "Type...";
        box.appendChild(input);
        const submit = el("button", "btn-claim", "✅ Confirm");
        submit.addEventListener("click", () => {
            postAction(panelKey, {
                customId: flow.modal.customId,
                type: "modal",
                password: input.value.trim()
            });
        });
        box.appendChild(submit);
        return box;
    }

    for (const item of flow.menu) {
        if (item.kind === "select") {
            const select = el("select");
            for (const opt of item.options) {
                const option = el("option");
                option.value = opt.value;
                option.textContent = opt.emoji ? `${opt.emoji} ${opt.label}` : opt.label;
                select.appendChild(option);
            }
            box.appendChild(select);
            const confirm = el("button", "btn-claim", "✅ Confirm");
            confirm.addEventListener("click", () => {
                postAction(panelKey, {
                    customId: item.customId,
                    type: "select",
                    value: select.value
                });
            });
            box.appendChild(confirm);
        } else if (item.kind === "button") {
            const row = el("div", "flow-buttons");
            const btn = el("button", "btn-ghost-b", `${item.emoji || ""} ${item.label || ""}`.trim());
            btn.addEventListener("click", () => {
                postAction(panelKey, { customId: item.customId, type: "button" });
            });
            row.appendChild(btn);
            box.appendChild(row);
        }
    }

    return box;
}

// ── DM toggle ──────────────────────────────
$("dm-btn").addEventListener("click", async () => {
    try {
        const result = await api("/api/action", {
            method: "POST",
            body: JSON.stringify({ customId: "dmoptout", type: "button" })
        });
        toast(result.message || "DM preference updated.", "success");
    } catch (err) {
        toast(`❌ ${err.message}`, "error");
    }
});

// ── History view ───────────────────────────
const LOG_ICONS = { CLAIM_START: "🟢", CLAIM_END: "🔴", CANCEL: "🟠", QUEUE_JOIN: "🟨", DEATH_MARK: "💀" };
const LOG_LABELS = {
    CLAIM_START: "Claim started",
    CLAIM_END: "Claim ended",
    CANCEL: "Canceled",
    QUEUE_JOIN: "Joined queue",
    DEATH_MARK: "Death mark"
};

function renderLogEntry(entry) {
    const row = el("div", "log-entry");
    const head = el("div", "log-head");
    head.appendChild(el("span", "log-icon", LOG_ICONS[entry.type] || "•"));
    head.appendChild(el("span", "log-label", LOG_LABELS[entry.type] || entry.type));
    head.appendChild(el("span", "log-time", `${entry.date || ""} ${entry.timestamp || ""}`.trim()));
    row.appendChild(head);
    row.appendChild(el("div", "log-body", `${entry.user} → ${entry.targetRoom}`));
    if (entry.context) row.appendChild(el("div", "log-ctx", entry.context));
    return row;
}

async function loadHistory() {
    const main = $("main");
    main.textContent = "";
    main.appendChild(el("p", "hint", "Loading..."));
    try {
        const data = await api("/api/history");
        historyCache = data;

        const punCard = el("div", "admin-card");
        punCard.appendChild(el("h3", null, "⏱️ Active punishments"));
        const punList = el("div");
        if (!data.punishments || !data.punishments.length) {
            punList.appendChild(el("p", "hint", "No active punishments. ✅"));
        } else {
            for (const p of data.punishments) {
                const row = el("div", "admin-account");
                const info = el("div", "acc-info");
                info.appendChild(el("div", "acc-name", p.name));
                info.appendChild(el("div", "acc-meta", `uid: ${p.uid}`));
                row.appendChild(info);
                row.appendChild(el("div", "acc-meta", `⏱️ ${p.remaining}`));
                punList.appendChild(row);
            }
        }
        punCard.appendChild(punList);

        const logsCard = el("div", "admin-card");
        logsCard.appendChild(el("h3", null, "🕘 Recent activity"));

        // Type filter chips
        const types = new Map();
        for (const entry of data.logs || []) {
            types.set(entry.type, (types.get(entry.type) || 0) + 1);
        }
        const chips = el("div", "hist-chips");
        const allChip = el("button", `chip ${historyType === "all" ? "active" : ""}`, `All (${data.logs.length || 0})`);
        allChip.addEventListener("click", () => { historyType = "all"; renderHistoryLogs(); });
        chips.appendChild(allChip);
        for (const [type, count] of types) {
            const chip = el("button", `chip ${historyType === type ? "active" : ""}`, `${LOG_ICONS[type] || "•"} ${LOG_LABELS[type] || type} (${count})`);
            chip.addEventListener("click", () => { historyType = type; renderHistoryLogs(); });
            chips.appendChild(chip);
        }
        logsCard.appendChild(chips);

        const logsList = el("div");
        logsList.id = "history-logs-list";
        logsCard.appendChild(logsList);
        main.append(punCard, logsCard);
        renderHistoryLogs();
    } catch (err) {
        main.textContent = "";
        main.appendChild(el("p", "error", `❌ ${err.message}`));
    }
}

function renderHistoryLogs() {
    const list = $("history-logs-list");
    if (!list || !historyCache) return;
    list.textContent = "";
    const entries = (historyCache.logs || []).filter(e => historyType === "all" || e.type === historyType);
    if (!entries.length) {
        list.appendChild(el("p", "hint", "No activity of this type."));
        return;
    }
    for (const entry of entries) list.appendChild(renderLogEntry(entry));
}

// ── Admin view ─────────────────────────────
async function loadAdminAccounts() {
    const main = $("main");
    main.textContent = "";

    const createCard = el("div", "admin-card");
    createCard.appendChild(el("h3", null, "➕ Create account"));
    const form = el("form");
    form.id = "admin-create-form";
    form.autocomplete = "off";
    form.innerHTML = `
        <div class="form-row">
            <div class="form-field"><label>Username *</label><input type="text" id="new-username" required autocomplete="off"></div>
            <div class="form-field"><label>Password *</label><input type="text" id="new-password" required autocomplete="new-password" placeholder="min. 4 characters"></div>
        </div>
        <div class="form-row">
            <div class="form-field"><label>Display name</label><input type="text" id="new-display" autocomplete="off" placeholder="name shown on panels"></div>
            <div class="form-field"><label>UID (Discord ID)</label><input type="text" id="new-uid" autocomplete="off" placeholder="empty = no Discord"></div>
        </div>
        <div class="form-row checks">
            <label class="check"><input type="checkbox" id="new-mod"> Mod</label>
            <label class="check"><input type="checkbox" id="new-admin"> Admin</label>
        </div>
        <p class="hint">💡 Use the member's Discord ID so their website claims merge with their Discord claims.</p>
        <button type="submit" class="btn-claim" id="admin-create-btn">Create account</button>
    `;
    createCard.appendChild(form);
    form.addEventListener("submit", onAdminCreate);

    const listCard = el("div", "admin-card");
    listCard.appendChild(el("h3", null, "📋 Accounts"));
    const listEl = el("div");
    listEl.id = "admin-accounts-list";
    listEl.appendChild(el("p", "hint", "Loading..."));
    listCard.appendChild(listEl);

    main.append(createCard, listCard);

    try {
        const data = await api("/api/admin/accounts");
        listEl.textContent = "";
        if (!data.accounts.length) {
            listEl.appendChild(el("p", "hint", "No accounts yet."));
            return;
        }
        for (const acc of data.accounts) listEl.appendChild(renderAccountRow(acc));
    } catch (err) {
        listEl.textContent = "";
        listEl.appendChild(el("p", "error", `❌ ${err.message}`));
    }
}

function roleTag(acc) {
    if (acc.isAdmin) return el("span", "role-tag role-admin", "admin");
    if (acc.isMod) return el("span", "role-tag role-mod", "mod");
    return el("span", "role-tag", "member");
}

function renderAccountRow(acc) {
    const row = el("div", "admin-account");
    const info = el("div", "acc-info");
    const name = el("div", "acc-name", acc.displayName || acc.username);
    name.appendChild(roleTag(acc));
    info.appendChild(name);
    info.appendChild(el("div", "acc-meta", `@${acc.username} · uid: ${acc.uid}`));
    row.appendChild(info);

    const actions = el("div", "acc-actions");
    const pwdBtn = el("button", "btn-ghost-b", "Password");
    pwdBtn.addEventListener("click", () => changeAccountPassword(acc));
    const delBtn = el("button", "btn-cancel", "Remove");
    delBtn.addEventListener("click", () => removeAccount(acc));
    actions.append(pwdBtn, delBtn);
    row.appendChild(actions);
    return row;
}

async function onAdminCreate(e) {
    e.preventDefault();
    const btn = $("admin-create-btn");
    btn.disabled = true;
    try {
        await api("/api/admin/accounts/create", {
            method: "POST",
            body: JSON.stringify({
                username: $("new-username").value.trim(),
                password: $("new-password").value,
                displayName: $("new-display").value.trim(),
                uid: $("new-uid").value.trim(),
                isMod: $("new-mod").checked,
                isAdmin: $("new-admin").checked
            })
        });
        toast("✅ Account created!", "success");
        loadAdminAccounts();
    } catch (err) {
        toast(`❌ ${err.message}`, "error");
    } finally {
        btn.disabled = false;
    }
}

async function removeAccount(acc) {
    if (!confirm(`Remove account "${acc.username}"?`)) return;
    try {
        await api("/api/admin/accounts/remove", {
            method: "POST",
            body: JSON.stringify({ username: acc.username })
        });
        toast(`✅ Account "${acc.username}" removed.`, "success");
        loadAdminAccounts();
    } catch (err) {
        toast(`❌ ${err.message}`, "error");
    }
}

async function changeAccountPassword(acc) {
    const newPassword = prompt(`New password for "${acc.username}" (min. 4 characters):`);
    if (newPassword === null) return;
    try {
        await api("/api/admin/accounts/passwd", {
            method: "POST",
            body: JSON.stringify({ username: acc.username, password: newPassword })
        });
        toast(`✅ Password for "${acc.username}" updated.`, "success");
    } catch (err) {
        toast(`❌ ${err.message}`, "error");
    }
}

// ── Boot ───────────────────────────────────
checkSession();
