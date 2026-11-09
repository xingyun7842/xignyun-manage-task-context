#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const ROOT = process.env.AI_CONTEXT_HOME || path.join(os.homedir(), "Documents", "AI任务记忆");
const PROFILE = process.env.AI_CONTEXT_PROFILE || "shared";

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

function cleanId(value, fallback) {
  const cleaned = String(value || fallback || "unknown").replace(/[^A-Za-z0-9._-]/g, "_");
  return cleaned.slice(0, 160) || "unknown";
}

function statePath(platform, session) {
  return path.join(ROOT, "tasks", cleanId(platform, "codex"), cleanId(session, "unknown"), "TASK_STATE.md");
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function observedTurns(platform, session) {
  if (platform === "hermes") {
    const meta = readJson(path.join(ROOT, "tasks", "hermes", cleanId(session), "meta.json"), {});
    return Number(meta.turn_count || 0);
  }
  const manifest = readJson(path.join(ROOT, "runtime", "codex-manifest.json"), { entries: {} });
  let turns = 0;
  for (const entry of Object.values(manifest.entries || {})) {
    if (entry && entry.threadId === session) turns = Math.max(turns, Number(entry.userTurns || 0));
  }
  return turns;
}

function frontMatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  const data = {};
  if (!match) return { data, body: text, raw: "" };
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx > 0) data[line.slice(0, idx).trim()] = parseYamlScalar(line.slice(idx + 1).trim());
  }
  return { data, body: text.slice(match[0].length), raw: match[0] };
}

function parseYamlScalar(value) {
  const text = String(value || "").trim();
  if (text === "") return "";
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return Number(text);
  if (text === "true") return true;
  if (text === "false") return false;
  if (text === "null") return "";
  if (text.startsWith('"') && text.endsWith('"')) {
    let decoded = text;
    for (let depth = 0; depth < 8; depth += 1) {
      if (!(typeof decoded === "string" && decoded.startsWith('"') && decoded.endsWith('"'))) break;
      try {
        const next = JSON.parse(decoded);
        if (next === decoded) break;
        decoded = next;
      } catch {
        break;
      }
    }
    if (decoded !== text) return decoded;
    return text.slice(1, -1);
  }
  if (text.startsWith("'") && text.endsWith("'")) {
    return text.slice(1, -1);
  }
  return text;
}

function yamlScalar(value) {
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return JSON.stringify(String(value));
}

function renderFront(data) {
  const order = ["schema_version", "platform", "session_id", "account_profile", "workspace", "source_turns", "last_checkpoint_turn", "updated_at"];
  const lines = ["---"];
  for (const key of order) {
    if (data[key] !== undefined && data[key] !== "") lines.push(key + ": " + yamlScalar(data[key]));
  }
  lines.push("---", "");
  return lines.join("\n");
}

function template(platform, session, title, workspace, turns) {
  const data = {
    schema_version: 1,
    platform,
    session_id: session,
    account_profile: PROFILE,
    workspace: workspace || "",
    source_turns: turns,
    last_checkpoint_turn: 0,
    updated_at: new Date().toISOString()
  };
  return renderFront(data) + [
    "# 1. 需求",
    "",
    "## 目标与范围",
    "",
    "- [R-001] " + (title || "待从当前对话确认任务目标"),
    "",
    "## 约束与偏好",
    "",
    "- [R-002] 关键约束不得只存在于自动压缩摘要中。",
    "",
    "## 验收标准",
    "",
    "- [AC-001] 交付结果满足已确认需求，并有可核验的文件、命令或测试证据。",
    "",
    "## 待确认问题",
    "",
    "- 无",
    "",
    "# 2. 执行思路",
    "",
    "## 当前焦点",
    "",
    "- 明确需求并开始执行。",
    "",
    "## 已完成与证据",
    "",
    "- 已创建任务状态文档。",
    "",
    "## 关键决策",
    "",
    "- [D-001] 以本文件为任务权威状态；完整聊天仅按需检索。",
    "",
    "## 下一步",
    "",
    "- [T-001] 根据当前对话更新需求、执行状态与技术证据。",
    "",
    "## 阻塞、失败与变更记录",
    "",
    "- 无",
    "",
    "# 3. 技术",
    "",
    "## 架构与数据流",
    "",
    "- TASK_STATE + 最近对话 + 按需检索片段 + 不可变原始会话。",
    "",
    "## 文件、命令与环境",
    "",
    "- 状态文件：" + statePath(platform, session),
    "",
    "## 测试与验证",
    "",
    "- 待记录。",
    "",
    "## 风险、回滚与来源",
    "",
    "- 原始会话保持不变，可用于恢复和核验。",
    ""
  ].join("\n");
}

function ensure(opts) {
  const platform = cleanId(opts.platform, "codex");
  const session = cleanId(opts.session || process.env.CODEX_THREAD_ID, "unknown");
  const file = statePath(platform, session);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, template(platform, session, opts.title, opts.workspace, observedTurns(platform, session)), "utf8");
  }
  return file;
}

function validate(file) {
  if (!fs.existsSync(file)) throw new Error("State file not found: " + file);
  const text = fs.readFileSync(file, "utf8");
  const required = ["# 1. 需求", "# 2. 执行思路", "# 3. 技术"];
  const top = text.split(/\r?\n/).filter((line) => /^# /.test(line));
  const errors = [];
  if (JSON.stringify(top) !== JSON.stringify(required)) errors.push("Top-level headings must be exactly: " + required.join(" | "));
  for (const heading of required) {
    if (!text.includes(heading)) errors.push("Missing heading: " + heading);
  }
  for (const id of ["R-", "AC-", "D-"]) {
    if (!text.includes("[" + id)) errors.push("Missing stable identifier family: " + id);
  }
  const fm = frontMatter(text).data;
  for (const key of ["schema_version", "platform", "session_id", "source_turns", "last_checkpoint_turn", "updated_at"]) {
    if (fm[key] === undefined) errors.push("Missing front matter key: " + key);
  }
  return { ok: errors.length === 0, errors, file };
}

function rewriteFront(file, updates) {
  const text = fs.readFileSync(file, "utf8");
  const parsed = frontMatter(text);
  const data = { ...parsed.data, ...updates, updated_at: new Date().toISOString() };
  for (const key of ["schema_version", "source_turns", "last_checkpoint_turn"]) {
    if (data[key] !== undefined) data[key] = Number(data[key]);
  }
  const tmp = file + ".tmp-" + process.pid;
  fs.writeFileSync(tmp, renderFront(data) + parsed.body, "utf8");
  fs.renameSync(tmp, file);
}

const command = process.argv[2] || "status";
const opts = argsOf(process.argv.slice(3));
const platform = cleanId(opts.platform, "codex");
const session = cleanId(opts.session || process.env.CODEX_THREAD_ID, "unknown");

try {
  if (command === "ensure") {
    process.stdout.write(ensure({ ...opts, platform, session }) + "\n");
  } else if (command === "locate") {
    process.stdout.write(statePath(platform, session) + "\n");
  } else if (command === "validate") {
    const file = opts.file || statePath(platform, session);
    const result = validate(file);
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    if (!result.ok) process.exitCode = 2;
  } else if (command === "status") {
    const file = ensure({ ...opts, platform, session });
    const text = fs.readFileSync(file, "utf8");
    const fm = frontMatter(text).data;
    const turns = observedTurns(platform, session);
    const checkpoint = Number(fm.last_checkpoint_turn || 0);
    process.stdout.write(JSON.stringify({ file, source_turns: turns, last_checkpoint_turn: checkpoint, turns_since_checkpoint: Math.max(0, turns - checkpoint), checkpoint_due: turns - checkpoint >= 20 }, null, 2) + "\n");
  } else if (command === "checkpoint") {
    const file = ensure({ ...opts, platform, session });
    const turns = observedTurns(platform, session);
    const result = validate(file);
    if (!result.ok) throw new Error("Refusing checkpoint; validation failed: " + result.errors.join("; "));
    rewriteFront(file, { source_turns: turns, last_checkpoint_turn: turns });
    process.stdout.write(JSON.stringify({ ok: true, file, last_checkpoint_turn: turns }, null, 2) + "\n");
  } else {
    throw new Error("Unknown command: " + command);
  }
} catch (error) {
  process.stderr.write(String(error && error.stack ? error.stack : error) + "\n");
  process.exitCode = 1;
}
