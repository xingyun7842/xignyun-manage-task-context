#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def redact(text: str) -> str:
    patterns = [
        (r"sk-[A-Za-z0-9_\-]{20,}", "sk-[REDACTED]"),
        (r"(api[_-]?key|token|secret|password)\s*[:=]\s*[^\s`'\"，。；;]+", r"\1=[REDACTED]"),
        (r"Bearer\s+[A-Za-z0-9._\-]+", "Bearer [REDACTED]"),
    ]
    out = text
    for pattern, replacement in patterns:
        out = re.sub(pattern, replacement, out, flags=re.IGNORECASE)
    return out


def safe_id(value: Any) -> str:
    raw = str(value or "unknown").strip()
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", raw)[:160]
    return cleaned or "unknown"


def ts(value: Any) -> str:
    try:
        return datetime.fromtimestamp(float(value), tz=timezone.utc).isoformat()
    except Exception:
        return ""


def one_line(value: str, limit: int = 120) -> str:
    return re.sub(r"\s+", " ", value or "").strip()[:limit]


def render_session(db_path: Path, session: sqlite3.Row, messages: list[sqlite3.Row], profile: str) -> tuple[str, dict[str, Any]]:
    user_turns = 0
    projected = 0
    first_user = ""
    rows: list[str] = [
        "---",
        "platform: hermes",
        "session_id: " + json.dumps(session["id"], ensure_ascii=False),
        "account_profile: " + json.dumps(profile, ensure_ascii=False),
        "raw_source: " + json.dumps(str(db_path), ensure_ascii=False),
        "source: " + json.dumps(session["source"] or "", ensure_ascii=False),
        "title: " + json.dumps(session["title"] or session["display_name"] or "", ensure_ascii=False),
        "started_at: " + json.dumps(ts(session["started_at"]), ensure_ascii=False),
        "ended_at: " + json.dumps(ts(session["ended_at"]), ensure_ascii=False),
        "generated_at: " + json.dumps(now(), ensure_ascii=False),
        "---",
        "",
    ]
    for msg in messages:
        role = (msg["role"] or "").lower()
        content = redact((msg["content"] or "").strip())
        if not content or role not in {"user", "assistant"}:
            continue
        if role == "user":
            user_turns += 1
            if not first_user:
                first_user = content
        projected += 1
    title = one_line(session["title"] or first_user or f"Hermes session {session['id']}")
    rows.append("# " + (title or f"Hermes session {session['id']}"))
    rows.extend(
        [
            "",
            "> SQLite read-only search projection. User/assistant visible messages only; system prompts, hidden reasoning, and tool payload columns are intentionally excluded. Verify decisive facts against raw_source and message id.",
            "",
            f"User turns: {user_turns}",
            f"Projected messages: {projected}",
            "",
        ]
    )
    turn = 0
    for msg in messages:
        role = (msg["role"] or "").lower()
        content = redact((msg["content"] or "").strip())
        if not content or role not in {"user", "assistant"}:
            continue
        if role == "user":
            turn += 1
        label = "User" if role == "user" else "Assistant"
        rows.extend(
            [
                f"## Turn {max(turn, 1)} - {label}",
                "",
                f"Source: message_id={msg['id']} timestamp={ts(msg['timestamp'])}",
                "",
                content,
                "",
            ]
        )
    meta = {
        "session_id": session["id"],
        "source": session["source"],
        "title": title,
        "user_turns": user_turns,
        "projected_messages": projected,
    }
    return "\n".join(rows), meta


def export(db_path: Path, root: Path, profile: str) -> dict[str, Any]:
    out_dir = root / "transcripts" / "hermes"
    runtime_dir = root / "runtime"
    out_dir.mkdir(parents=True, exist_ok=True)
    runtime_dir.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    sessions = con.execute("select * from sessions order by started_at").fetchall()
    entries = []
    changed = 0
    for session in sessions:
        messages = con.execute(
            "select id, role, content, timestamp from messages where session_id=? order by id",
            (session["id"],),
        ).fetchall()
        text, meta = render_session(db_path, session, messages, profile)
        dest = out_dir / f"{safe_id(session['id'])}-sqlite.md"
        old = dest.read_text(encoding="utf-8") if dest.exists() else ""
        if old != text:
            tmp = dest.with_suffix(dest.suffix + f".tmp-{os.getpid()}")
            tmp.write_text(text, encoding="utf-8")
            tmp.replace(dest)
            changed += 1
        entries.append({**meta, "destination": str(dest)})
    con.close()
    manifest = {"version": 1, "raw_source": str(db_path), "profile": profile, "updated_at": now(), "entries": entries}
    (runtime_dir / "hermes-sqlite-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"sessions": len(sessions), "changed": changed, "destination": str(out_dir)}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default=str(Path.home() / "AppData" / "Local" / "hermes" / "state.db"))
    parser.add_argument("--root", default=os.environ.get("AI_CONTEXT_HOME", str(Path.home() / "Documents" / "AI任务记忆")))
    parser.add_argument("--profile", default=os.environ.get("AI_CONTEXT_PROFILE", "shared"))
    args = parser.parse_args()
    print(json.dumps(export(Path(args.db), Path(args.root), args.profile), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
