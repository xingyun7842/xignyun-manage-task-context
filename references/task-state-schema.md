# Task State Schema

The document has exactly three top-level sections. Front matter and lower-level headings are allowed.

## Required layout

```markdown
---
schema_version: 1
platform: codex | hermes
session_id: <stable id>
source_turns: <number of user turns observed>
last_checkpoint_turn: <number included in this state>
updated_at: <ISO-8601 timestamp>
---

# 1. 需求
## 目标与范围
- [R-001] ...
## 约束与偏好
- [R-002] ...
## 验收标准
- [AC-001] ...
## 待确认问题
- 无

# 2. 执行思路
## 当前焦点
- ...
## 已完成与证据
- ...
## 关键决策
- [D-001] ...
## 下一步
- [T-001] ...
## 阻塞、失败与变更记录
- ...

# 3. 技术
## 架构与数据流
- ...
## 文件、命令与环境
- ...
## 测试与验证
- ...
## 风险、回滚与来源
- ...
```

## Preservation rules

- `R-*`, `AC-*`, and `D-*` identifiers are append-stable. Do not renumber them.
- Completed or superseded items remain briefly with status and evidence; do not erase the history needed to understand current behavior.
- Keep current state concise. Put verbose transcripts and large tool output in the archive, then cite their path.
- Record facts as facts, decisions as decisions, and hypotheses as hypotheses.
- Every changed technical claim should have a file, command, test, or transcript source when feasible.
- The state is operational, not literary: prefer precise bullets over narrative summaries.

