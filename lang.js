import fs from 'fs';
import path from 'path';

const LANG_MAP = {
  en: 'lang.json',
  pt: 'lang-pt.json'
};

const langPathEn = path.resolve('./lang.json');
const langPathPt = path.resolve('./lang-pt.json');

// Store both language dictionaries
let langCache = { en: {}, pt: {} };

// Currently active language (default: en)
let currentLang = 'en';

function loadLanguageFile(lang) {
  const filePath = lang === 'pt' ? langPathPt : langPathEn;
  try {
    langCache[lang] = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return true;
  } catch (e) {
    console.error(`❌ Error loading ${lang} language file:`, e.message);
    return false;
  }
}

// Load both on init
loadLanguageFile('en');
loadLanguageFile('pt');

export function getMsg(pathStr, vars = {}) {
    const langDict = langCache[currentLang] || langCache.en;
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

export function setLanguage(lang) {
  if (lang !== 'en' && lang !== 'pt') return false;
  currentLang = lang;
  // Reload the language file in case it was updated
  loadLanguageFile(lang);
  return true;
}

export function getCurrentLanguage() {
  return currentLang;
}

export function reloadLanguage() {
    return loadLanguageFile(currentLang);
}

export function getArray(pathStr) {
    const langDict = langCache[currentLang] || langCache.en;
    const keys = pathStr.split('.');
    let target = langDict;
    for (const key of keys) {
        if (target === undefined || target === null) return [];
        target = target[key];
    }
    return Array.isArray(target) ? target : [];
}
