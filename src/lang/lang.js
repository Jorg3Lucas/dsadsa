import fs from 'node:fs';
import path from 'node:path';

const langPath = path.join(import.meta.dirname, 'lang.json');
let langDict = {};

try {
    langDict = JSON.parse(fs.readFileSync(langPath, 'utf8'));
} catch (e) {
    console.error('❌ Error loading language file:', e.message);
}

export function getMsg(pathStr, vars = {}) {
    const keys = pathStr.split('.');
    let target = langDict;
    for (const key of keys) {
        if (target === undefined || target === null) return pathStr;
        target = target[key];
    }
    let output = typeof target === 'string' ? target : pathStr;
    for (const [k, v] of Object.entries(vars)) {
        // split/join replaces EVERY occurrence without compiling a new RegExp per
        // call. getMsg is the bot's highest-frequency pure-CPU call (it runs per
        // member during syncs), and `new RegExp` per variable per call was the
        // dominant micro-cost in that loop. Placeholders are plain `{key}` with no
        // regex metacharacters, so split/join is behavior-identical to the old
        // global-regex replace.
        output = output.split(`{${k}}`).join(v);
    }
    return output;
}

