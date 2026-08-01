// ==========================================
// 📋 CENTRALIZED DEBUG & ERROR LOGGER
// Enhanced logging with timestamps, stack traces,
// file persistence, and structured error output
// ==========================================

import fs from "fs";
import path from "path";

const LOG_DIR = path.resolve("./logs");
const ERROR_LOG_FILE = path.join(LOG_DIR, "error.log");
const DEBUG_LOG_FILE = path.join(LOG_DIR, "debug.log");
const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5MB per log file before rotation

// ─── Ensure log directory exists ─────────

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

// ─── Rotate log file if too large ─────────

function rotateIfNeeded(filePath) {
  try {
    if (fs.existsSync(filePath) && fs.statSync(filePath).size > MAX_LOG_SIZE) {
      const rotated = filePath.replace(/\.log$/, `_${Date.now()}.log`);
      fs.renameSync(filePath, rotated);
    }
  } catch {
    // Silently ignore rotation errors
  }
}

// ─── Write to log file ───────────────────

function writeToFile(filePath, message) {
  try {
    ensureLogDir();
    rotateIfNeeded(filePath);
    fs.appendFileSync(filePath, message + "\n", "utf8");
  } catch {
    // Silently ignore file write errors
  }
}

// ─── Format a stack trace ────────────────

function formatStack(stack) {
  if (!stack) return "";
  // Take first 8 lines of stack (caller + 7 frames) to avoid noise
  return stack
    .split("\n")
    .slice(0, 8)
    .map(line => `  ${line.trim()}`)
    .join("\n");
}

// ─── Format error object ────────────────

function formatError(err) {
  if (!err) return "Unknown error";
  if (err instanceof Error) {
    const parts = [`Message: ${err.message}`];
    if (err.code) parts.push(`Code: ${err.code}`);
    if (err.stack) parts.push(`Stack:\n${formatStack(err.stack)}`);
    return parts.join("\n");
  }
  // Try to extract useful info from objects
  try {
    return JSON.stringify(err, null, 2);
  } catch {
    return String(err);
  }
}

// ─── Get timestamp ──────────────────────

function getTimestamp() {
  return new Date().toISOString();
}

// ─── Build structured log entry ─────────

function buildEntry(level, component, message, data) {
  const timestamp = getTimestamp();
  let entry = `[${timestamp}] [${level}] [${component}] ${message}`;

  if (data !== undefined && data !== null) {
    if (data instanceof Error) {
      entry += `\n${formatError(data)}`;
    } else if (typeof data === "object") {
      try {
        entry += `\n  Data: ${JSON.stringify(data, null, 2)}`;
      } catch {
        entry += `\n  Data: ${String(data)}`;
      }
    } else {
      entry += `\n  Data: ${String(data)}`;
    }
  }

  return entry;
}

// ─── Console colors ─────────────────────

const colors = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
  dim: "\x1b[2m",
};

// ─── Logger object ──────────────────────

export const logger = {
  /**
   * Debug-level log (verbose development info)
   * Only written to debug.log file, not printed to console by default
   */
  debug(component, message, data) {
    const entry = buildEntry("DEBUG", component, message, data);
    writeToFile(DEBUG_LOG_FILE, entry);
  },

  /**
   * Info-level log (normal operation info)
   */
  info(component, message, data) {
    const entry = buildEntry("INFO", component, message, data);
    console.log(`${colors.green}[${component}]${colors.reset} ${message}`);
    writeToFile(DEBUG_LOG_FILE, entry);
  },

  /**
   * Warning-level log (non-critical issues)
   */
  warn(component, message, data) {
    const entry = buildEntry("WARN", component, message, data);
    const dataSuffix = data instanceof Error
      ? `\n${colors.dim}${formatError(data)}${colors.reset}`
      : "";
    console.warn(
      `${colors.yellow}⚠️ [${component}]${colors.reset} ${message}${dataSuffix}`
    );
    writeToFile(ERROR_LOG_FILE, entry);
  },

  /**
   * Error-level log (critical issues with full context)
   */
  error(component, message, err, context) {
    const timestamp = getTimestamp();
    const errStr = formatError(err);

    let entry = `[${timestamp}] [ERROR] [${component}] ${message}\n${errStr}`;
    if (context) {
      try {
        entry += `\n  Context: ${JSON.stringify(context, null, 2)}`;
      } catch {
        entry += `\n  Context: ${String(context)}`;
      }
    }

    // Console output with colors
    console.error(
      `${colors.red}❌ [${component}]${colors.reset} ${message}`
    );
    if (err instanceof Error && err.message) {
      console.error(`  ${colors.red}${err.message}${colors.reset}`);
      if (err.code) console.error(`  ${colors.gray}Code: ${err.code}${colors.reset}`);
    }
    if (err && err.stack) {
      console.error(`${colors.dim}${formatStack(err.stack)}${colors.reset}`);
    } else if (err && !(err instanceof Error)) {
      console.error(`  ${colors.gray}${String(err)}${colors.reset}`);
    }
    if (context) {
      try {
        console.error(`  ${colors.gray}Context: ${JSON.stringify(context)}${colors.reset}`);
      } catch {
        // ignore
      }
    }

    // Write to file
    writeToFile(ERROR_LOG_FILE, entry);
  },

  /**
   * Fatal-level log (unrecoverable errors, will trigger process warning)
   */
  fatal(component, message, err, context) {
    const entry = buildEntry("FATAL", component, message, err);
    let fileEntry = entry;
    if (context) {
      try {
        fileEntry += `\n  Context: ${JSON.stringify(context, null, 2)}`;
      } catch {
        fileEntry += `\n  Context: ${String(context)}`;
      }
    }

    console.error(
      `${colors.red}🔥 [FATAL] [${component}]${colors.reset} ${message}`
    );
    if (err instanceof Error) {
      console.error(`  ${colors.red}${err.message}${colors.reset}`);
      if (err.stack) console.error(formatStack(err.stack));
    }
    if (context) {
      try {
        console.error(`  ${colors.gray}Context: ${JSON.stringify(context)}${colors.reset}`);
      } catch {
        // ignore
      }
    }

    writeToFile(ERROR_LOG_FILE, fileEntry);
  },
};

// ─── Process-level error handlers ─────────

/**
 * Install global process handlers to catch uncaught errors
 * and prevent silent crashes
 */
export function installGlobalErrorHandlers() {
  // ── Unhandled Promise Rejections ────────────
  process.on("unhandledRejection", (reason) => {
    logger.fatal(
      "Process",
      "Unhandled Promise Rejection — this should be fixed!",
      reason instanceof Error ? reason : new Error(String(reason))
    );
  });

  // ── Uncaught Exceptions ────────────────────
  process.on("uncaughtException", (err, origin) => {
    logger.fatal(
      "Process",
      `Uncaught Exception (origin: ${origin}) — crash imminent`,
      err,
      { nodeVersion: process.version, pid: process.pid }
    );

    // Give the logger time to write, then crash
    setTimeout(() => {
      process.exit(1);
    }, 2000);
  });

  // ── Warning Events ─────────────────────────
  process.on("warning", (warning) => {
    logger.warn(
      "Process",
      `Warning: ${warning.name} — ${warning.message}`,
      warning.stack ? new Error(warning.stack) : null
    );
  });

  logger.info("Logger", "Global error handlers installed.");
}

// ─── Quick helper to wrap async routes ─────

/**
 * Wraps an async function with error logging and user notification
 * Use in interaction handlers to avoid unhandled rejections
 */
export default logger;
