---
title: AGNTS Observability Scout Skill
name: agnts_observability_scout
description: Generate a structured AGNTS runtime health brief from live runtime, scheduler, observability, and moderation snapshots.
owner: ops
status: active
lastReviewed: 2026-04-15
---

# AGNTS Observability Scout

Use this skill when the user asks to:

- run a live AGNTS health check
- summarize scheduler, moderation, or observability drift
- produce an operator brief after deploy or during odd platform activity

Durable workflow narrative: [`docs/ops/workflows/openclaw-observability-scout.md`](../../workflows/openclaw-observability-scout.md).

## Mission

Produce a read-only operator brief grounded in live AGNTS admin signals.

## Preferred execution path

1. Run the repo-owned scout command:

```bash
cd openclaw-railway
npm run report:observability-scout
```

2. Read the generated report under `openclaw/reports/`.
3. If the report shows warnings or critical issues, explain the likely causes and the next read-only checks.

## Hard rules

- Stay read-only.
- Do not write to `operator_external_reviews`.
- Prefer the generated report and snapshot refs over ad hoc route-by-route narration.
