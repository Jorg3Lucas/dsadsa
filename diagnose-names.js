// ==========================================
// 🔍 DIAGNOSE NAMES — diagnostica por que um jogador está
//    sendo identificado errado / perdendo o cargo de membro.
//
// Uso (na pasta do bot, onde ficam ranking_cache.json e database_ranking.json):
//   node diagnose-names.js "Beshal ツ" "Dinizメ"
//
// Somente LEITURA — não altera nenhum arquivo.
// ==========================================
import fs from 'node:fs';
import { WORLD_IDS, ensureConfig } from './src/core/ranking-constants.js';
import {
    getLocalRankingCache,
    findAllNicknameMatchesInCache,
    findTopNicknamesInCache,
    cleanNickname
} from './src/core/ranking-cache.js';
import { lookupNickname, isAlliedClanName } from './src/core/ranking-service.js';

const names = process.argv.slice(2);
if (names.length === 0) {
    console.log('Uso: node diagnose-names.js "Nome1" "Nome2" ...');
    process.exit(0);
}

// ── Carrega o banco (para a config de clãs aliados) ──
let db = { users: {} };
try {
    if (fs.existsSync('./database_ranking.json')) {
        db = JSON.parse(fs.readFileSync('./database_ranking.json', 'utf8'));
        console.log(`📂 database_ranking.json carregado (${Object.keys(db.users || {}).length} usuários)`);
    } else {
        console.log('⚠️ database_ranking.json não encontrado — sem config de clãs aliados.');
    }
} catch (e) {
    console.log(`⚠️ Erro ao ler database_ranking.json: ${e.message}`);
}
ensureConfig(db);

// ── Carrega o cache do ranking ──
const cache = getLocalRankingCache();
if (!cache) {
    console.log('❌ ranking_cache.json não encontrado/inválido — rode um sync antes de diagnosticar.');
    process.exit(0);
}
console.log(`📂 ranking_cache.json carregado (${Object.keys(cache).length} mundos)`);

function alliedOf(worldId, clan) {
    const list = db.config?.alliedClans?.[worldId];
    if (!list || !clan) return { allied: false };
    // Mesma comparação tolerante usada pelo bot (exata + variações de decoração).
    return { allied: isAlliedClanName(clan, list) };
}

function listAllied(worldId) {
    const list = db.config?.alliedClans?.[worldId] || [];
    return list.length ? `[${list.join(', ')}]` : '(nenhum configurado)';
}

for (const name of names) {
    console.log(`\n════════════════════════════════════════════════════`);
    console.log(`👤 ${name}`);
    const users = Object.entries(db.users || {}).filter(
        ([, u]) => cleanNickname(u.nickname || '') === cleanNickname(name)
    );
    if (users.length) {
        users.forEach(([id, u]) => console.log(`   📋 registro: ID ${id} → nickname="${u.nickname}"${u.tempUntil ? ` (temp até ${u.tempUntil})` : ''}${u.manualPermanent ? ' (manualPermanent)' : ''}`));
    } else {
        console.log(`   📋 (nenhum usuário registrado com esse nome no banco)`);
    }

    console.log(`   ── Matches EXATOS no cache ──`);
    const exacts = findAllNicknameMatchesInCache(name, cache);
    if (!exacts.length) console.log('      (nenhum)');
    for (const m of exacts) {
        const a = alliedOf(m.worldId, m.clanName);
        console.log(`      • ${WORLD_IDS[m.worldId] || m.worldId} → clã "${m.clanName}" ${a.allied ? '✅ ALIADO' : '❌ não aliado'}   (aliados do mundo: ${listAllied(m.worldId)})`);
    }

    console.log(`   ── Candidatos FUZZY (top 5) ──`);
    const fuzz = findTopNicknamesInCache(name, cache, 5);
    if (!fuzz.length) console.log('      (nenhum)');
    for (const m of fuzz) {
        const a = alliedOf(m.worldId, m.clanName);
        console.log(`      • ${WORLD_IDS[m.worldId] || m.worldId} → "${m.nickname}" (clã "${m.clanName}", ${(m.score * 100).toFixed(0)}%) ${a.allied ? '✅ ALIADO' : '❌ não aliado'}`);
    }

    const oldRes = exacts[0] || null; // comportamento antigo: primeiro match exato
    const newRes = lookupNickname(name, db, cache);
    console.log('   ── Resolução do bot ──');
    if (oldRes) {
        const a = alliedOf(oldRes.worldId, oldRes.clanName);
        console.log(`      ANTIGO: ${WORLD_IDS[oldRes.worldId] || oldRes.worldId} / "${oldRes.clanName}" ${a.allied ? '✅ aliado' : '❌ não aliado'}`);
    } else {
        console.log('      ANTIGO: sem match exato');
    }
    if (newRes.found) {
        console.log(`      NOVO:   ${newRes.serverName} / "${newRes.clanName}" ${newRes.inAlliedClan ? '✅ aliado' : '❌ não aliado'} ${newRes.exactMatch ? '(match exato)' : `(fuzzy → "${newRes.fuzzySuggestion}")`}`);
    } else {
        console.log('      NOVO:   não encontrado em nenhum mundo');
    }

    // ── Veredito ──
    if (newRes.found && newRes.inAlliedClan) {
        console.log(`   ✅ Com a correção, este jogador MANTERIA o cargo.`);
    } else if (!newRes.found) {
        console.log(`   ⚠️ Não está no ranking (top 1000 de nenhum mundo) — a remoção de cargo é o comportamento esperado aqui.`);
    } else {
        const alliedFuzzy = fuzz.some(m => alliedOf(m.worldId, m.clanName).allied);
        console.log(`   ❌ Ainda resolve para clã NÃO aliado (${newRes.serverName} / "${newRes.clanName}").`);
        if (alliedFuzzy) {
            console.log(`      Há candidato fuzzy em clã ALIADO, mas existe match exato não-aliado em outro mundo.`);
            console.log(`      Confira se o nome REGISTRADO no banco tem os mesmos caracteres decorativos do personagem no jogo (ex.: "Beshal ツ").`);
        } else {
            console.log(`      O clã não casa com nenhum clã aliado configurado deste mundo.`);
            console.log(`      Compare a grafia no fórum (com decorações como シ, ツ, 战争, acentos) com a config — ex.: aliados de ${newRes.worldId} = ${listAllied(newRes.worldId)}.`);
        }
    }
}
