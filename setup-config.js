import fs from 'fs';
import path from 'path';

const configPath = path.resolve('./setup-config.json');

export const CONTINENTS = {
  SA:   { label: 'SA',   offset: -5, displayName: { en: 'South America', pt: 'América do Sul' } },
  ASIA: { label: 'ASIA', offset: 6,  displayName: { en: 'Asia',         pt: 'Ásia' } },
  INMENA: { label: 'INMENA', offset: 4, displayName: { en: 'INMENA',     pt: 'INMENA' } },
  EU:   { label: 'EU',   offset: 0,  displayName: { en: 'Europe',       pt: 'Europa' } },
  NA:   { label: 'NA',   offset: -6, displayName: { en: 'North America',pt: 'América do Norte' } }
};

export let config = {
  language: 'en',
  continent: 'EU'
};

export function loadConfig() {
  try {
    if (fs.existsSync(configPath)) {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      config.language = data.language || 'en';
      config.continent = data.continent || 'EU';
    }
  } catch (e) {
    console.error('❌ Error loading setup config:', e.message);
  }
}

export function saveConfig() {
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  } catch (e) {
    console.error('❌ Error saving setup config:', e.message);
  }
}

export function updateConfig(updates) {
  if (updates.language !== undefined) config.language = updates.language;
  if (updates.continent !== undefined) config.continent = updates.continent;
  saveConfig();
}

export function getContinentOffset() {
  const c = CONTINENTS[config.continent];
  return c ? c.offset : 0;
}

export function getContinentLabel() {
  return config.continent;
}

export function getContinentDisplayName(lang) {
  const c = CONTINENTS[config.continent];
  return c ? (c.displayName[lang] || c.label) : 'EU';
}

export function getContinentOffsetStr(continentLabel) {
  const c = CONTINENTS[continentLabel];
  if (!c) return '';
  const offset = c.offset;
  const sign = offset >= 0 ? '+' : '';
  return `Berlin ${sign}${offset}h = ${c.label} local time`;
}

// Load config at module init
loadConfig();
