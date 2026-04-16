---
title: AGNTS Rollout Guardian Skill
name: agnts_rollout_guardian
description: Review rollout risk, canary watch signals, and rollback conditions for AGNTS changes.
owner: ops
status: active
lastReviewed: 2026-04-15
---

# AGNTS Rollout Guardian

Use this skill when the user asks to:

- guard a rollout
- review canary risk
- define abort conditions or rollback steps

Durable workflow narrative: [`docs/ops/workflows/openclaw-rollout-guardian.md`](../../workflows/openclaw-rollout-guardian.md).

## Mission

Turn rollout intent into a watch brief with explicit gates, watchlist signals, and human rollback steps.

## Required grounding

- `docs/backend/runtime-config-reference.md`
- `docs/backend/admin-api-reference.md`
- `docs/ops/tools.md`
- relevant PR or changed files

## Hard rules

- No deploys
- No runtime writes
- No autonomous rollback
