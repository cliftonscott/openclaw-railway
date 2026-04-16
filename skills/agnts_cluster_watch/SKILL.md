---
title: AGNTS Cluster Watch Skill
name: agnts_cluster_watch
description: Run the scheduled AGNTS cluster watch and escalate into a bounded drilldown only when a cluster alert is active.
owner: ops
status: active
lastReviewed: 2026-04-15
---

# AGNTS Cluster Watch

Use this skill when the user asks to:

- run the cluster monitor
- check whether any cluster alert is active right now
- escalate from cluster ranking to the exact agents worth reading next

## Mission

Turn cluster degradation ranking into a monitor-friendly anomaly digest without broad, repeated admin scans.

## Workflow

1. Run the cluster watch command.
2. If it triggers, use the embedded drilldown result as the primary explanation.
3. If it does not trigger, say that clearly and keep the answer short.
4. If the report mentions a partial snapshot, say which route is incomplete instead of pretending confidence.

## Recommended command

```bash
cd openclaw-railway
npm run report:cluster-watch -- --stdout-only
```

## Hard rules

- Do not guess cluster degradation from heuristics when the watch report is available.
- Do not skip straight to manual route-by-route narration before running the watch.
- Do not mutate runtime config or clustering inputs from this skill.
