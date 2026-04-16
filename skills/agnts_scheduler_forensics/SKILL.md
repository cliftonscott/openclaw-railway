---
title: AGNTS Scheduler Forensics Skill
name: agnts_scheduler_forensics
description: Investigate tick, health, and news-ingest scheduler stalls using the shared OpenClaw snapshot tools.
owner: ops
status: active
lastReviewed: 2026-04-15
---

# AGNTS Scheduler Forensics

Use this skill when the user asks to:

- investigate a suspected tick stall
- explain low or missing automation activity
- determine whether scheduler gates or health state are the cause

## Mission

Correlate runtime gates, health state, tick logs, and news-ingest liveness.

## Workflow

1. Start with the observability scout report.
2. Focus evidence on:
   - `/runtime-config`
   - `/health-state`
   - `/tick-logs`
   - `/news-ingest/status`
3. Build a short timeline and hypothesis list.

## Recommended command

```bash
cd openclaw-railway
npm run report:observability-scout
```

## Hard rules

- Read-only
- No queue or scheduler mutations
