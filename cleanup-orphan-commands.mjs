// ============================================================
// 🧹 CLEANUP ORPHAN SLASH COMMANDS
// Lists and optionally deletes guild slash commands that are
// no longer registered by the bot.
//
// Commands the bot STILL registers are read from the registration
// sources (src/core/ranking-deploy.js + src/deploy-commands.cjs)
// and are NEVER deleted — only the leftovers are offered.
//
// USAGE:
//   node cleanup-orphan-commands.mjs                # dry-run: list commands
//   node cleanup-orphan-commands.mjs --delete       # delete orphans (asks confirmation)
//   node cleanup-orphan-commands.mjs --delete --yes # delete without confirmation
//   node cleanup-orphan-commands.mjs --only-known   # restrict to names confirmed removed from the bot
//
// ENV (from .env or shell):
//   CLIENT_ID         — bot application (client) ID
//   DISCORD_TOKEN     — bot token (or TOKEN)
//   DISCORD_SERVER_ID — guild ID (or pass --guild <id>)
// ============================================================

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const API = "https://discord.com/api/v10";

// ─── Command names confirmed REMOVED from the bot ─────────
// Kept only to label orphans as "known" vs "legacy". Safety does NOT rely on
// this list: anything the bot still registers is protected automatically from
// the registration sources below. Never add a live command here.
const KNOWN_ORPHANS = new Set([
  // Removed with the old admin commands
  "cleandb",
  // Removed by request (member-role-only bot)
  "syncroles",
  "syncperms",
  "nuke",
  "notify",
  "setup",
  "scanrebuild",
  "scanimport",
  "scanimport_status",
  "elderguide",
  "autoregister",
  // Older version (may still linger if never cleaned)
  "register",
  "pilot",
  "removepilot",
]);

// ─── CLI flags ───────────────────────────────────────────────
const args = process.argv.slice(2);
const DO_DELETE = args.includes("--delete");
const AUTO_YES = args.includes("--yes");
const ONLY_KNOWN = args.includes("--only-known");

const token = process.env.DISCORD_TOKEN || process.env.TOKEN;
const clientId = process.env.CLIENT_ID;
let guildId = process.env.DISCORD_SERVER_ID;

// --guild <id> overrides env
const guildIdx = args.indexOf("--guild");
if (guildIdx !== -1 && args[guildIdx + 1]) guildId = args[guildIdx + 1];

if (!token) {
  console.error("❌ Missing DISCORD_TOKEN / TOKEN in .env or environment.");
  process.exit(1);
}
if (!clientId) {
  console.error("❌ Missing CLIENT_ID in .env or environment.");
  process.exit(1);
}
if (!guildId) {
  console.error("❌ Missing DISCORD_SERVER_ID in .env or pass --guild <id>.");
  process.exit(1);
}

// ─── Helpers ─────────────────────────────────────────────────

// Maximum retries when Discord rate-limits us (HTTP 429)
const MAX_RETRIES = 5;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Discord API request with automatic 429 rate-limit handling.
 * Respects the server-provided `retry_after` and retries with backoff.
 */
async function api(path, options = {}, retries = 0) {
  const res = await fetch(`${API}${path}`, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (res.status === 429) {
    if (retries >= MAX_RETRIES) {
      throw new Error(`Rate limited after ${MAX_RETRIES} retries on ${path}`);
    }
    let retryAfterMs = 1000; // default fallback
    try {
      const body = await res.json();
      retryAfterMs = Math.ceil((body.retry_after || 1) * 1000);
    } catch {
      // fall back to default
    }
    console.log(`⏳ Rate limited — waiting ${(retryAfterMs / 1000).toFixed(1)}s before retry...`);
    await sleep(retryAfterMs);
    return api(path, options, retries + 1);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Discord API ${res.status} on ${path}: ${text.slice(0, 300)}`);
  }
  return res.status === 204 ? null : res.json();
}

// ─── Registered commands (still deployed by the bot) ─────────

const ROOT_DIR = path.dirname(fileURLToPath(import.meta.url));

// Files that define the slash commands the bot registers. Every name found here
// is treated as live and is never deleted. Options objects
// (`{ type: 6, name: 'member' }`) start with `type:` and are skipped, so only
// top-level command definitions are collected.
const REGISTRATION_SOURCES = [
  "src/core/ranking-deploy.js",
  "src/deploy-commands.cjs",
];

function loadRegisteredCommandNames() {
  const names = new Set();
  const objectRe = /\{\s*(type:\s*\d+\s*,\s*)?name:\s*['"]([^'"]+)['"]/g;
  for (const rel of REGISTRATION_SOURCES) {
    const file = path.join(ROOT_DIR, rel);
    if (!fs.existsSync(file)) continue;
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(objectRe)) {
      if (match[1]) continue; // option object ({ type: N, name: '...' })
      names.add(match[2]);
    }
  }
  return names;
}

// ─── Main ────────────────────────────────────────────────────

async function main() {
  console.log("🔍 Fetching guild slash commands...\n");

  const commands = await api(`/applications/${clientId}/guilds/${guildId}/commands`);

  if (commands.length === 0) {
    console.log("✅ No guild slash commands registered — nothing to clean up.");
    return;
  }

  // Commands the bot still registers are NEVER orphans. Fail closed when the
  // registration sources cannot be read, so live commands are never wiped.
  const registered = loadRegisteredCommandNames();
  if (registered.size === 0) {
    console.error(`❌ No registered command found in: ${REGISTRATION_SOURCES.join(", ")}`);
    console.error("   Refusing to delete anything (fail-safe). Run this from the project root.");
    process.exitCode = 1;
    return;
  }

  console.log(`🔒 ${registered.size} command(s) still registered by the bot — always kept:`);
  console.log("   " + [...registered].sort().map((n) => `/${n}`).join(", ") + "\n");

  const orphans = [];
  let liveCount = 0;
  console.log(`Found ${commands.length} guild slash command(s):\n`);
  console.log("  " + "─".repeat(66));

  for (const cmd of commands) {
    if (registered.has(cmd.name)) {
      liveCount++;
      console.log(`  ${"🔒 LIVE (kept)".padEnd(22)} /${cmd.name}  (id: ${cmd.id})`);
      continue;
    }
    const known = KNOWN_ORPHANS.has(cmd.name);
    const tag = known ? "🗑️  ORPHAN (known)" : "⚠️  ORPHAN (legacy)";
    console.log(`  ${tag.padEnd(22)} /${cmd.name}  (id: ${cmd.id})`);
    orphans.push({ ...cmd, known });
  }

  console.log("  " + "─".repeat(66));
  console.log(`\n📊 Summary: ${commands.length} total, ${liveCount} live (kept), ${orphans.length} orphaned.`);

  // Filter for deletion
  let toDelete = orphans;
  if (ONLY_KNOWN) {
    toDelete = orphans.filter((o) => o.known);
    console.log(`   (--only-known: restricting to ${toDelete.length} confirmed name(s))`);
  }

  if (toDelete.length === 0) {
    console.log("\n✅ Nothing to delete.");
    return;
  }

  if (!DO_DELETE) {
    console.log("\nℹ️  Dry-run — nothing deleted.");
    console.log("   Run with `--delete` to remove the commands above.");
    return;
  }

  if (!AUTO_YES) {
    console.log(`\n⚠️  About to DELETE ${toDelete.length} command(s):`);
    for (const cmd of toDelete) console.log(`      - /${cmd.name}`);
    const readline = await import("node:readline/promises");
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question("\nType 'yes' to confirm: ");
    rl.close();
    if (answer.trim().toLowerCase() !== "yes") {
      console.log("❌ Cancelled — nothing deleted.");
      return;
    }
  }

  let deleted = 0;
  let failed = 0;
  for (const cmd of toDelete) {
    // Belt and braces: never delete a command the bot still registers.
    if (registered.has(cmd.name)) {
      console.log(`⏭️  Skipped /${cmd.name} — still registered by the bot.`);
      continue;
    }
    try {
      await api(`/applications/${clientId}/guilds/${guildId}/commands/${cmd.id}`, { method: "DELETE" });
      console.log(`🗑️  Deleted /${cmd.name}`);
      deleted++;
    } catch (err) {
      failed++;
      console.error(`⚠️  Failed to delete /${cmd.name}: ${err.message}`);
    }
  }

  console.log(`\n✅ Done — ${deleted} deleted, ${failed} failed.`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`\n❌ Failed: ${err.message}`);
  process.exit(1);
});
