# Agent maintenance contract

- Skill identifier: `manage-task-context`. Preserve the installed invocation name.
- Author repository: `https://github.com/xingyun7842/xignyun-manage-task-context`; branch `main`; visibility `public`.
- A repository URL is not authority to write: confirm the caller owns the target or use the caller-authorized fork.
- For each completed skill iteration, record the problem/reason, the change, actual validation and known limits in the independent commit or version note.
- Synchronize only the reviewed skill package. Keep local archives, credentials, account/device state, business records and caches outside the package.
- Follow `skill-publish.json`; preserve local-to-release source mapping. Verify the remote commit and read back the changed files before reporting synchronization complete.
- Update `llms.txt` when entry points, dependencies or output claims change.
- Rejected or unknown remote writes must be reconciled; do not automatically recreate a repository or overwrite remote history.
