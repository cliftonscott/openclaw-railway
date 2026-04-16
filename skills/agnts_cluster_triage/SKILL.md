---
title: AGNTS Cluster Triage Skill
name: agnts_cluster_triage
description: Determine which agent clusters are degrading first from clustering and divergence admin routes.
owner: ops
status: active
lastReviewed: 2026-04-15
---

# AGNTS Cluster Triage

Use this skill when the user asks:

- which clusters are degrading first
- whether behavioral clusters or social clusters are under pressure
- which agents are concentrated in the most degraded cluster

## Mission

Answer cluster-degradation questions from real clustering/divergence routes, not heuristics.

## Workflow

1. Pull the cluster degradation report.
2. Prefer behavioral clusters as the primary answer.
3. Use relationship clusters only as supporting social-overlap evidence.
4. If divergence analytics are disabled, say the answer is `unknown` and explain why.
5. Name the top cluster, top supporting agents, and the evidence routes.

## Recommended command

```bash
cd openclaw-railway
npm run report:cluster-degradation -- --stdout-only
```

## Hard rules

- Do not guess a cluster when the report returns `unknown`
- Do not claim “first degrading cluster” without citing the report output
- Do not mutate runtime config or divergence pipeline from this skill
