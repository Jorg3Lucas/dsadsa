// ==========================================
// 🧠 CLAIM CORE — Room Keys & Names
// Extracted from claim-core.js
// ==========================================

const SUMMON_PROPS_INTERNAL = ["sp2", "sp4", "sp7"];

// Rooms for expanded antidemon panels
// MS9/MS10: 1-1, 1-2 each with LEFT/MID/RIGHT (6 rooms)
// MS11/MS12: 1-1, 1-2, 1-3 each with LEFT/MID/RIGHT (9 rooms)
const ANTIDEMON_9_10_ROOMS = [
    { key: "v1l", name: "1-1 LEFT" }, { key: "v1m", name: "1-1 MID" }, { key: "v1r", name: "1-1 RIGHT" },
    { key: "v2l", name: "1-2 LEFT" }, { key: "v2m", name: "1-2 MID" }, { key: "v2r", name: "1-2 RIGHT" }
];
const ANTIDEMON_11_12_ROOMS = [
    { key: "v1l", name: "1-1 LEFT" }, { key: "v1m", name: "1-1 MID" }, { key: "v1r", name: "1-1 RIGHT" },
    { key: "v2l", name: "1-2 LEFT" }, { key: "v2m", name: "1-2 MID" }, { key: "v2r", name: "1-2 RIGHT" },
    { key: "v3l", name: "1-3 LEFT" }, { key: "v3m", name: "1-3 MID" }, { key: "v3r", name: "1-3 RIGHT" }
];
const ANTIDEMON_9_10_KEYS = ANTIDEMON_9_10_ROOMS.map(r => r.key);
const ANTIDEMON_11_12_KEYS = ANTIDEMON_11_12_ROOMS.map(r => r.key);

// Returns sub-event keys for an event_group panel (excludes system properties)
export function getEventGroupKeys(current) {
    if (!current || "event_group" !== current.type) return [];
    const sysProps = ["type", "title"];
    return Object.keys(current).filter(k => !sysProps.includes(k));
}

// Returns room keys for a summon panel based on its key
export function getSummonRoomKeys(panelKey) {
    // Individual goblin panels (each has its own single room)
    if (panelKey === "11goblin") return ["sp11"];
    if (panelKey === "12goblin") return ["sp12"];
    if (panelKey === "11msgoblin") return ["ms11"];
    if (panelKey === "12msgoblin") return ["ms12"];
    // Combined summon panel uses the default rooms
    return SUMMON_PROPS_INTERNAL;
}

// Returns room key array for an antidemon panel based on its key
export function getAntidemonRoomKeys(panelKey) {
    const floor = panelKey?.match(/^(\d+)/)?.[1];
    if (floor === "9" || floor === "10") return ANTIDEMON_9_10_KEYS;
    if (floor === "11" || floor === "12") return ANTIDEMON_11_12_KEYS;
    return ["left", "mid", "right"];
}

// Returns the display name for a room key in a given panel
export function getAntidemonRoomName(panelKey, roomKey) {
    if (roomKey === "left") return "LEFT ROOM";
    if (roomKey === "mid") return "MID ROOM";
    if (roomKey === "right") return "RIGHT ROOM";
    const found = ANTIDEMON_11_12_ROOMS.find(r => r.key === roomKey);
    return found ? found.name : roomKey.toUpperCase();
}
