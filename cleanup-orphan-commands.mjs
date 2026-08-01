// ============================================================
// 🧹 CLEANUP ORPHAN SLASH COMMANDS
// Lists and optionally deletes guild slash commands that are
// no longer registered by the bot.
//
// The claim-only bot registers NO slash commands anymore, so
// EVERY command still present on the guild is orphaned.
//
// USAGE:
//   node cleanup-orphan-commands.mjs                # dry-run: list commands
//   node cleanup-orphan-commands.mjs --delete       # delete orphans (asks confirmation)
//   node cleanup-orphan-commands.mjs --delete --yes # delete without confirmation
//   node cleanup-orphan-commands.mjs --only-known   # restrict to names recovered from git history
//
// ENV (from .env or shell):
//   CLIENT_ID         — bot application (client) ID
//   DISCORD_TOKEN     — bot token (or TOKEN)
//   DISCORD_SERVER_ID — guild ID (or pass --guild <id>)
// ============================================================

import "dotenv/config";

const API = "https://discord.com/api/v10";

// ─── Command names confirmed removed via git history ─────────
// Recovered from the deleted commands-definitions.js.
const KNOWN_ORPHANS = new Set([
  // Latest version (active before removal)
  "forcesync",
  "manualregister",
  "manualpilot",
  "cleandb",
  "manage",
  "manualremove",
  "manualremovepilot",
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

async function api(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Discord API ${res.status} on ${path}: ${text.slice(0, 300)}`);
  }
  return res.status === 204 ? null : res.json();
}

// ─── Main ────────────────────────────────────────────────────

async function main() {
  console.log("🔍 Fetching guild slash commands...\n");

  const commands = await api(`/applications/${clientId}/guilds/${guildId}/commands`);

  if (commands.length === 0) {
    console.log("✅ No guild slash commands registered — nothing to clean up.");
    return;
  }

  // The claim-only bot registers NO slash commands, so every
  // command present on the guild is orphaned. Distinguish the
  // ones we know from git history vs. any legacy leftovers.
  const orphans = [];
  console.log(`Found ${commands.length} guild slash command(s):\n`);
  console.log("  " + "─".repeat(66));

  for (const cmd of commands) {
    const known = KNOWN_ORPHANS.has(cmd.name);
    const tag = known ? "🗑️  ORPHAN (known)" : "⚠️  ORPHAN (legacy)";
    console.log(`  ${tag.padEnd(22)} /${cmd.name}  (id: ${cmd.id})`);
    orphans.push({ ...cmd, known });
  }

  console.log("  " + "─".repeat(66));
  console.log(`\n📊 Summary: ${commands.length} total, ALL orphaned (bot registers none).`);

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
