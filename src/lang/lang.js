import fs from 'fs';
import path from 'path';

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
        output = output.replace(new RegExp(`{${k}}`, 'g'), v);
    }
    return output;
}

