#!/usr/bin/env node
// ==========================================
// 👤 WEB ACCOUNTS CLI — run by the admin
//
//   node src/web/adduser.mjs add <username> <password> [--uid <id>] [--name <display>] [--admin] [--mod]
//   node src/web/adduser.mjs list
//   node src/web/adduser.mjs remove <username>
//   node src/web/adduser.mjs passwd <username> <newpassword>
//
//   --uid: claim identity. Use the member's Discord ID so claims made on the
//          website merge with their Discord claims. Omit for members without
//          Discord (a synthetic web:<username> identity is used).
// ==========================================

import crypto from "node:crypto";
import { loadAccounts, saveAccounts, findAccount, hashPassword } from "./accounts.js";

function usage() {
    console.log(`
Usage:
  adduser add <username> <password> [--uid <id>] [--name <display>] [--admin] [--mod]
  adduser list
  adduser remove <username>
  adduser passwd <username> <newpassword>

Options:
  --uid <id>   Claim identity: the member's Discord ID (merges with Discord
               claims) or any stable ID for non-Discord members.
  --name <name> Display name shown on claim panels (defaults to username).
  --admin      Grants admin access (implies mod: can force-cancel any claim).
  --mod        Grants mod access (can force-cancel any claim).
`);
}

function argValue(args, flag, def) {
    const idx = args.indexOf(flag);
    return idx > -1 && args[idx + 1] ? args[idx + 1] : def;
}

function addAccount(args) {
    const username = String(args[0] || "").trim();
    const password = String(args[1] || "");
    if (!username || password.length < 4) {
        console.error("❌ Usage: add <username> <password> [--uid <id>] [--name <name>] [--admin] [--mod]");
        process.exit(1);
    }
    if (findAccount(username)) {
        console.error(`❌ Account "${username}" already exists.`);
        process.exit(1);
    }

    const uid = (argValue(args, "--uid", "") || `web:${username}`).trim();
    const accounts = loadAccounts();
    if (accounts.some(a => a.uid === uid)) {
        console.error(`❌ Another account already uses uid "${uid}".`);
        process.exit(1);
    }

    const salt = crypto.randomBytes(16).toString("hex");
    const account = {
        username,
        displayName: argValue(args, "--name", "") || username,
        uid,
        isAdmin: args.includes("--admin"),
        isMod: args.includes("--mod") || args.includes("--admin"),
        salt,
        hash: hashPassword(password, salt),
        createdAt: new Date().toISOString()
    };
    accounts.push(account);
    saveAccounts(accounts);
    console.log(`✅ Account "${username}" created.`);
    console.log(`   Display name : ${account.displayName}`);
    console.log(`   Claim uid    : ${account.uid}${uid.startsWith("web:") ? " (synthetic — no Discord)" : " (Discord ID — claims merge)"}`);
    console.log(`   Access       : ${account.isAdmin ? "admin" : account.isMod ? "mod" : "member"}`);
}

function listAccounts() {
    const accounts = loadAccounts();
    if (accounts.length === 0) {
        console.log("No accounts yet. Create one with: node src/web/adduser.mjs add <username> <password> --admin");
        return;
    }
    console.log("Accounts:");
    for (const a of accounts) {
        console.log(`  - ${a.username} | name: ${a.displayName} | uid: ${a.uid} | ${a.isAdmin ? "admin" : a.isMod ? "mod" : "member"}`);
    }
}

function removeAccount(args) {
    const username = String(args[0] || "").trim();
    const accounts = loadAccounts();
    const idx = accounts.findIndex(a => String(a.username).toLowerCase() === username.toLowerCase());
    if (idx === -1) {
        console.error(`❌ Account "${username}" not found.`);
        process.exit(1);
    }
    const [removed] = accounts.splice(idx, 1);
    saveAccounts(accounts);
    console.log(`✅ Account "${removed.username}" removed.`);
}

function changePassword(args) {
    const username = String(args[0] || "").trim();
    const newPassword = String(args[1] || "");
    if (!newPassword || newPassword.length < 4) {
        console.error("❌ Usage: passwd <username> <newpassword>");
        process.exit(1);
    }
    const accounts = loadAccounts();
    const account = accounts.find(a => String(a.username).toLowerCase() === username.toLowerCase());
    if (!account) {
        console.error(`❌ Account "${username}" not found.`);
        process.exit(1);
    }
    account.salt = crypto.randomBytes(16).toString("hex");
    account.hash = hashPassword(newPassword, account.salt);
    saveAccounts(accounts);
    console.log(`✅ Password updated for "${account.username}".`);
}

const [cmd, ...args] = process.argv.slice(2);
switch (cmd) {
    case "add": addAccount(args); break;
    case "list": listAccounts(); break;
    case "remove": removeAccount(args); break;
    case "passwd": changePassword(args); break;
    default: usage(); break;
}
