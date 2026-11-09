#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";
import { spawnSync } from "node:child_process";

const HOME = os.homedir();
const ROOT = process.env.AI_CONTEXT_HOME || path.join(HOME, "Documents", "AI任务记忆");
const TRANSCRIPTS = path.join(ROOT, "transcripts");
const RUNTIME = path.join(ROOT, "runtime");
const LOGS = path.join(ROOT, "logs");
const MANIFEST_FILE = path.join(RUNTIME, "codex-manifest.json");
const PROFILE = process.env.AI_CONTEXT_PROFILE || "shared";
const WORKSPACE = process.env.AI_CONTEXT_WORKSPACE || process.cwd();
const QMD_CACHE_HOME = process.env.XDG_CACHE_HOME || path.join(WORKSPACE, ".qmd-cache");
const QMD_CONFIG_HOME = process.env.XDG_CONFIG_HOME || path.join(WORKSPACE, ".qmd-config");
const QMD_NODE = process.env.QMD_NODE || "C:\\AIContextTools\\node22\\node_modules\\node\\bin\\node.exe";
const QMD_CLI = process.env.QMD_CLI || "C:\\AIContextTools\\qmd\\node_modules\\@tobilu\\qmd\\dist\\cli\\qmd.js";
const CJK_EMBED = "hf:Qwen/Qwen3-Embedding-0.6B-GGUF/Qwen3-Embedding-0.6B-Q8_0.gguf";

function argsOf(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith("--")) {
      out._.push(item);
      continue;
    }
    const key = item.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function ensureLayout() {
  for (const dir of [ROOT, TRANSCRIPTS, path.join(TRANSCRIPTS, "codex"), path.join(TRANSCRIPTS, "hermes"), path.join(ROOT, "tasks", "codex"), path.join(ROOT, "tasks", "hermes"), RUNTIME, LOGS]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function atomicJson(file, value) {
  const tmp = file + ".tmp-" + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(tmp, file);
}

function log(message) {
  ensureLayout();
  fs.appendFileSync(path.join(LOGS, "archive-watcher.log"), new Date().toISOString() + " " + message + "\n", "utf8");
}

function walk(dir, suffix, out) {
  if (!fs.existsSync(dir)) return out;
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, suffix, out);
    else if (entry.isFile() && full.toLowerCase().endsWith(suffix)) out.push(full);
  }
  return out;
}

function textOf(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((item) => textOf(item && (item.text ?? item.content ?? item))).filter(Boolean).join("\n");
  if (value && typeof value === "object") return textOf(value.text ?? value.content ?? value.message ?? "");
  return "";
}

function threadIdFromFile(file) {
  const match = path.basename(file).match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  return match ? match[1] : path.basename(file, path.extname(file));
}

async function parseCodex(file) {
  const messages = [];
  const responseMessages = [];
  const meta = { threadId: threadIdFromFile(file), cwd: "", originator: "Codex", startedAt: "" };
  let invalidLines = 0;
  let lineNo = 0;
  const input = fs.createReadStream(file, { encoding: "utf8" });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    lineNo += 1;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      invalidLines += 1;
      continue;
    }
    if (row.type === "session_meta" && row.payload) {
      meta.threadId = row.payload.session_id || row.payload.id || meta.threadId;
      meta.cwd = row.payload.cwd || "";
      meta.originator = row.payload.originator || row.payload.source || "Codex";
      meta.startedAt = row.payload.timestamp || row.timestamp || meta.startedAt;
      continue;
    }
    // New desktop histories retain visible messages in response_item but no
    // longer emit legacy user_message/agent_message events. Read only explicit
    // user/assistant text blocks; never project reasoning or tool payloads.
    if (row.type === "response_item" && row.payload?.type === "message") {
      const p = row.payload;
      if (["user", "assistant"].includes(p.role) &&
          !["analysis", "summary"].includes(p.channel) &&
          !["analysis", "summary"].includes(p.phase)) {
        const expectedType = p.role === "user" ? "input_text" : "output_text";
        const content = (Array.isArray(p.content) ? p.content : [])
          .filter((block) => block?.type === expectedType && typeof block.text === "string")
          .map((block) => block.text.trim())
          .filter((text) => text && !(p.role === "user" &&
            /^(?:<recommended_plugins>|<environment_context>|<skills_instructions>|<INSTRUCTIONS>|# AGENTS\.md instructions(?:\s|$))/.test(text)))
          .join("\n");
        if (content) responseMessages.push({ role: p.role, content, timestamp: row.timestamp || "", line: lineNo, phase: p.role === "user" ? "user" : p.phase || "assistant" });
      }
      continue;
    }
    if (row.type !== "event_msg" || !row.payload) continue;
    if (row.payload.type === "user_message") {
      const content = textOf(row.payload.message).trim();
      if (content) messages.push({ role: "user", content, timestamp: row.timestamp || "", line: lineNo, phase: "user" });
    } else if (row.payload.type === "agent_message") {
      const content = textOf(row.payload.message).trim();
      if (content) messages.push({ role: "assistant", content, timestamp: row.timestamp || "", line: lineNo, phase: row.payload.phase || "assistant" });
    }
  }
  return { meta, messages: messages.length ? messages : responseMessages, invalidLines };
}

function oneLine(value, max) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max || 100);
}

function renderTranscript(file, parsed) {
  const userTurns = parsed.messages.filter((message) => message.role === "user").length;
  const titleSource = parsed.messages.find((message) => message.role === "user");
  const title = oneLine(titleSource ? titleSource.content : "Codex task", 100) || "Codex task";
  const rows = [
    "---",
    "platform: codex",
    "session_id: " + JSON.stringify(parsed.meta.threadId),
    "account_profile: " + JSON.stringify(PROFILE),
    "raw_source: " + JSON.stringify(file),
    "workspace: " + JSON.stringify(parsed.meta.cwd || ""),
    "started_at: " + JSON.stringify(parsed.meta.startedAt || ""),
    "user_turns: " + userTurns,
    "projected_messages: " + parsed.messages.length,
    "invalid_raw_lines: " + parsed.invalidLines,
    "generated_at: " + JSON.stringify(new Date().toISOString()),
    "---",
    "",
    "# " + title,
    "",
    "> Search projection of the complete visible conversation. System/developer instructions, hidden reasoning, credentials, and bulk tool output are intentionally excluded. Verify decisive details against `raw_source` and the recorded line number.",
    ""
  ];
  let turn = 0;
  for (const message of parsed.messages) {
    if (message.role === "user") turn += 1;
    const label = message.role === "user" ? "User" : "Assistant (" + message.phase + ")";
    rows.push("## Turn " + Math.max(turn, 1) + " · " + label, "", "Source: raw line " + message.line + " · " + (message.timestamp || "timestamp unavailable"), "", message.content, "");
  }
  return { text: rows.join("\n"), userTurns, title };
}

function statSignature(file) {
  const stat = fs.statSync(file);
  return { size: stat.size, mtimeMs: Math.trunc(stat.mtimeMs) };
}

async function syncCodex(opts) {
  ensureLayout();
  const roots = [path.join(HOME, ".codex", "sessions"), path.join(HOME, ".codex", "archived_sessions")];
  let files = roots.flatMap((root) => walk(root, ".jsonl", []));
  const current = opts.current === true ? process.env.CODEX_THREAD_ID : opts.current;
  if (current) files = files.filter((file) => file.includes(String(current)));
  const manifest = readJson(MANIFEST_FILE, { version: 1, entries: {}, totalUserTurns: 0, lastEmbeddedUserTurns: 0 });
  let changed = 0;
  for (const file of files) {
    let signature;
    try {
      signature = statSignature(file);
    } catch {
      continue;
    }
    const previous = manifest.entries[file];
    if (!opts.force && previous && previous.size === signature.size && previous.mtimeMs === signature.mtimeMs) continue;
    const parsed = await parseCodex(file);
    const rendered = renderTranscript(file, parsed);
    const destination = path.join(TRANSCRIPTS, "codex", parsed.meta.threadId + ".md");
    const tmp = destination + ".tmp-" + process.pid;
    fs.writeFileSync(tmp, rendered.text, "utf8");
    fs.renameSync(tmp, destination);
    manifest.entries[file] = {
      ...signature,
      threadId: parsed.meta.threadId,
      accountProfile: PROFILE,
      destination,
      userTurns: rendered.userTurns,
      projectedMessages: parsed.messages.length,
      invalidLines: parsed.invalidLines,
      title: rendered.title,
      syncedAt: new Date().toISOString()
    };
    changed += 1;
  }
  manifest.totalUserTurns = Object.values(manifest.entries).reduce((sum, entry) => sum + Number(entry.userTurns || 0), 0);
  manifest.updatedAt = new Date().toISOString();
  atomicJson(MANIFEST_FILE, manifest);
  return { changed, filesSeen: files.length, totalUserTurns: manifest.totalUserTurns, manifest };
}

function qmdAvailable() {
  return fs.existsSync(QMD_NODE) && fs.existsSync(QMD_CLI);
}

function runQmd(args, timeout) {
  if (!qmdAvailable()) return { status: 127, stdout: "", stderr: "qmd runtime unavailable" };
  return spawnSync(QMD_NODE, [QMD_CLI, ...args], {
    encoding: "utf8",
    timeout: timeout || 120000,
    windowsHide: true,
    env: {
      ...process.env,
      XDG_CACHE_HOME: QMD_CACHE_HOME,
      XDG_CONFIG_HOME: QMD_CONFIG_HOME,
      QMD_EMBED_MODEL: process.env.QMD_EMBED_MODEL || CJK_EMBED
    }
  });
}

function ensureCollection(name, folder, description) {
  const listed = runQmd(["collection", "list"], 30000);
  if (!String(listed.stdout || "").includes(name)) {
    const added = runQmd(["collection", "add", folder, "--name", name], 60000);
    if (added.status !== 0) throw new Error("qmd collection add failed: " + String(added.stderr || added.stdout));
  }
  const contexts = runQmd(["context", "list"], 30000);
  if (!String(contexts.stdout || "").includes("qmd://" + name)) {
    runQmd(["context", "add", "qmd://" + name, description], 30000);
  }
}

function indexArchives(embed) {
  ensureLayout();
  ensureCollection("ai-task-transcripts", TRANSCRIPTS, "Codex and Hermes complete visible chat transcripts, with timestamps and provenance. Use for exact historical evidence and prior decisions; Chinese and English content.");
  ensureCollection("ai-task-states", path.join(ROOT, "tasks"), "Canonical three-section task state documents containing requirements, execution status, technical decisions, tests, risks, and source references.");
  const updated = runQmd(["update"], 180000);
  if (updated.status !== 0) throw new Error("qmd update failed: " + String(updated.stderr || updated.stdout));
  if (embed) {
    const embedded = runQmd(["embed", "--max-docs-per-batch", "32", "--max-batch-mb", "32"], 3600000);
    if (embedded.status !== 0) throw new Error("qmd embed failed: " + String(embedded.stderr || embedded.stdout));
    return { update: updated.stdout, embed: embedded.stdout };
  }
  return { update: updated.stdout };
}

function snippets(text, query, limit) {
  const terms = Array.from(new Set(String(query).toLowerCase().match(/[a-z0-9_.-]{2,}|[\u3400-\u9fff]{1,4}/g) || [])).slice(0, 20);
  const lower = text.toLowerCase();
  let score = 0;
  let first = -1;
  for (const term of terms) {
    let pos = lower.indexOf(term);
    while (pos >= 0) {
      score += term.length > 1 ? term.length : 1;
      if (first < 0 || pos < first) first = pos;
      pos = lower.indexOf(term, pos + Math.max(1, term.length));
    }
  }
  if (!score) return null;
  const start = Math.max(0, first - 500);
  return { score, excerpt: text.slice(start, start + 1800).trim() };
}

function fallbackSearch(query, limit) {
  const files = walk(TRANSCRIPTS, ".md", []);
  const results = [];
  for (const file of files) {
    let text = "";
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const hit = snippets(text, query, limit);
    if (hit) results.push({ file, ...hit });
  }
  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

function searchArchives(opts) {
  const query = String(opts.query || opts._.join(" ")).trim();
  if (!query) throw new Error("--query is required");
  const limit = Math.max(1, Math.min(10, Number(opts.limit || 5)));
  if (qmdAvailable() && !opts.fallback) {
    const mode = opts.mode === "hybrid" ? "query" : opts.mode === "semantic" ? "vsearch" : "search";
    const result = runQmd([mode, query, "--collection", "ai-task-transcripts", "--format", "json", "-n", String(limit)], mode === "query" ? 120000 : 45000);
    if (result.status === 0) return String(result.stdout || "[]");
  }
  return JSON.stringify(fallbackSearch(query, limit), null, 2);
}

async function watch() {
  ensureLayout();
  const lock = path.join(RUNTIME, "archive-watcher.pid");
  if (fs.existsSync(lock)) {
    const oldPid = Number(fs.readFileSync(lock, "utf8").trim());
    try {
      process.kill(oldPid, 0);
      throw new Error("Archive watcher is already running as PID " + oldPid);
    } catch (error) {
      if (String(error.message || error).includes("already running")) throw error;
    }
  }
  fs.writeFileSync(lock, String(process.pid), "utf8");
  const cleanup = () => {
    try { fs.unlinkSync(lock); } catch {}
  };
  process.on("exit", cleanup);
  process.on("SIGINT", () => { cleanup(); process.exit(0); });
  process.on("SIGTERM", () => { cleanup(); process.exit(0); });
  log("watcher started pid=" + process.pid);
  let ticks = 0;
  while (true) {
    try {
      const result = await syncCodex({});
      if (result.changed > 0) {
        const manifest = result.manifest;
        ensureCollection("ai-task-transcripts", TRANSCRIPTS, "Codex and Hermes complete visible chat transcripts with provenance.");
        ensureCollection("ai-task-states", path.join(ROOT, "tasks"), "Canonical three-section task state documents.");
        runQmd(["update"], 180000);
        if (manifest.totalUserTurns - Number(manifest.lastEmbeddedUserTurns || 0) >= 20) {
          const embedded = runQmd(["embed", "--max-docs-per-batch", "32", "--max-batch-mb", "32"], 3600000);
          if (embedded.status === 0) {
            manifest.lastEmbeddedUserTurns = manifest.totalUserTurns;
            atomicJson(MANIFEST_FILE, manifest);
          } else {
            log("embed failed: " + String(embedded.stderr || embedded.stdout).slice(0, 1000));
          }
        }
        log("synced changed=" + result.changed + " totalUserTurns=" + result.totalUserTurns);
      } else if (ticks % 20 === 0) {
        runQmd(["update"], 180000);
      }
    } catch (error) {
      log("watch error: " + String(error && error.stack ? error.stack : error));
    }
    ticks += 1;
    await new Promise((resolve) => setTimeout(resolve, 30000));
  }
}

const command = process.argv[2] || "sync";
const opts = argsOf(process.argv.slice(3));

try {
  if (command === "parse") {
    if (!opts.file) throw new Error("parse requires --file");
    process.stdout.write(JSON.stringify(await parseCodex(path.resolve(opts.file)), null, 2) + "\n");
  } else if (command === "sync") {
    const result = await syncCodex(opts);
    process.stdout.write(JSON.stringify({ changed: result.changed, filesSeen: result.filesSeen, totalUserTurns: result.totalUserTurns, root: ROOT }, null, 2) + "\n");
  } else if (command === "index") {
    process.stdout.write(JSON.stringify(indexArchives(Boolean(opts.embed)), null, 2) + "\n");
  } else if (command === "embed") {
    process.stdout.write(JSON.stringify(indexArchives(true), null, 2) + "\n");
  } else if (command === "search") {
    process.stdout.write(searchArchives(opts) + "\n");
  } else if (command === "watch") {
    await watch();
  } else {
    throw new Error("Unknown command: " + command);
  }
} catch (error) {
  process.stderr.write(String(error && error.stack ? error.stack : error) + "\n");
  process.exitCode = 1;
}
