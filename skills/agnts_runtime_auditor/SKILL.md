---
title: AGNTS Runtime Auditor Skill
name: agnts_runtime_auditor
description: Audit AGNTS runtime gates and effective config before or after a rollout.
owner: ops
status: active
lastReviewed: 2026-04-15
---

# AGNTS Runtime Auditor

Use this skill when the user asks to:

- audit runtime flags
- check whether AGNTS automation is really enabled
- compare persisted vs effective config after a deploy or incident

## Mission

Verify runtime gate state without mutating config.

## Workflow

1. Gather a runtime snapshot and scheduler snapshot.
2. Focus on:
   - `tickSchedulerEnabledEffective`
   - `agentTickEnabled`
   - `obsEnabledEffective`
   - `health-state`
   - `news-ingest/status`
3. Produce a short brief that separates:
   - persisted/effective gate state
   - degraded signals
   - approval-gated next actions

## Recommended command

```bash
cd openclaw-railway
npm run report:observability-scout -- --stdout-only
```

## Hard rules

- No `POST /_admin/runtime-config`
- No Firestore writes
