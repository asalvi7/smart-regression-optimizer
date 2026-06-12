# /docwork Skill

> A global Claude Code skill that captures session knowledge — decisions, logic, tradeoffs, and approach — into structured living documentation under the project's `documentation/` folder.

---

## 2026-06-12 — Designing and creating the skill

### Context
We wanted a way to preserve the *why* across Claude Code sessions, not just the *what*. Git history and code show what changed; nothing was capturing the reasoning, the rejected alternatives, or how the pieces relate. The ask was for a `/docwork` command that would act as a session-closing ritual: turn the conversation into a living doc.

### Decisions Made
- **Global skill (not project-level)**: Stored at `~/.claude/skills/docwork/SKILL.md` so it works across all projects, not just this one. Why: the need to document sessions is universal, not specific to this repo.
- **`documentation/{category}/{topic}.md` folder structure**: Mirrors how engineers naturally organize work knowledge — by domain, not by date. A flat list of dated files gets hard to navigate; a per-topic file that accumulates sessions stays coherent over time.
- **Append model for existing topics**: When a topic file already exists, new sessions add a dated section at the bottom rather than overwriting. Why: preserves the evolution of thinking — a decision that looks obvious now may have been hard-fought two sessions ago.
- **Skill instructs Claude to NOT document line-by-line code changes**: The skill explicitly tells Claude that code narration is not the goal. The code is already in git. What's worth preserving is the logic and reasoning that *won't* be obvious from reading the diff.

### Logic & Approach
The core insight: most documentation tools capture output (what was built), but not process (how we got there). This skill tries to fill that gap by treating each session as a unit of knowledge with its own context, decisions, and tradeoffs — not a list of tasks completed.

The skill acts as a structured prompt: it tells Claude what categories of information to extract from the conversation, where to store them, and how to write them (voice, level of detail, what to skip).

### Tradeoffs
- **Living file vs. immutable sessions**: We chose to append to topic files rather than create one file per session. This means the doc evolves but earlier sections can't be "seen in isolation" as easily. The alternative (one file per session, date-named) would be cleaner per-session but fragmented across topics.
- **Global vs. project skill**: A global skill means the structure (`documentation/`) is assumed. If a project doesn't have that folder or uses a different convention, the skill will still try to create it. Acceptable for now — the folder pattern is the convention we're establishing.
- **Requires session restart to activate**: Because this is a new skill directory created mid-session, Claude Code needs to restart before `/docwork` appears as a recognized command. The skill file is ready; it's a cold-start constraint from the tooling.

### Relationships
- Connects to the project memory system (`~/.claude/projects/.../memory/`) — memory is for Claude's internal state across sessions; `documentation/` is for human-readable project knowledge.
- The `documentation/` folder sits alongside the codebase. Future sessions working on architecture, feature design, or key decisions should all be docwork'd into their appropriate category folders.

### Open Questions
- Should there be a `documentation/README.md` that describes the folder structure and acts as an index? Useful as the folder grows.
- Should `/docwork` also update the project memory system (`project_context.md`) or is that a separate concern? Currently they're separate — memory is Claude's working state, docs are the shareable artifact.
