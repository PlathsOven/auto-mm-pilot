# Auto-MM-Pilot

A multi-agent LLM coding pipeline built on Boris Cherny's "Claude Code" philosophy, optimized for running multiple concurrent AI agents (Cascade tabs) within a single workspace.

## How It Works

The pipeline uses **compounding knowledge** (`.windsurfrules`) and **surgical commits** to let several AI agents safely work in parallel without stepping on each other.

## Multi-Tab Strategy

Open multiple Cascade tabs in Windsurf — each tab is an independent AI agent that can work on a separate part of the codebase simultaneously.

| Tab | Assigned Lane | Example Prompt |
|-----|--------------|----------------|
| 1   | `src/data/`  | "Build the data ingestion engine. You are restricted to `src/data/`." |
| 2   | `src/api/`   | "Implement the REST API layer. You are restricted to `src/api/`." |
| 3   | `src/ui/`    | "Build the dashboard UI. You are restricted to `src/ui/`." |

## Assigning Lanes

For each tab, issue a prompt that includes a **strict directory restriction**:

> Build the data ingestion engine. You are restricted to `src/data/`.

The agent will:
1. **Auto-plan** — output a step-by-step implementation plan (it will NOT write code yet).
2. **Pause** — wait for your explicit approval.
3. **Execute** — implement the approved plan in one shot, touching only files in its lane.

## The Loop

```
Assign task with lane restriction
        │
        ▼
Agent outputs plan (no code yet)
        │
        ▼
You review & approve the plan
        │
        ▼
Agent executes in one shot
        │
        ▼
Run surgical commit script
```

### Surgical Commit

After an agent finishes, commit only the files it touched:

```bash
.cascade/commands/commit-push-pr.sh "feat: add data ingestion pipeline" src/data/ingest.py src/data/schema.py
```

This prevents race conditions — each agent only stages its own files, never `git add .`.

## Key Files

| File | Purpose |
|------|---------|
| `.windsurfrules` | Core directives: auto-planning, continuous learning, parallel guardrails |
| `.cascade/commands/commit-push-pr.sh` | Surgical commit-push script (stages only named files) |

## Rules of Engagement

1. **Never** use `git add .` or `git commit -a`.
2. **Never** modify files outside your assigned lane.
3. **Always** plan before coding — wait for approval.
4. **Always** update `.windsurfrules` when a convention is corrected.
5. If a file changes unexpectedly, **stop** and ask for conflict resolution.
