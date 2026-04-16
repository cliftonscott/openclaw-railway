---
title: AGNTS Plan Auditor Skill
name: agnts_plan_auditor
description: Audit an AGNTS plan against the real repo, verify implementation coverage, and identify precise gaps before any patching.
owner: ops
status: active
lastReviewed: 2026-04-14
---

# AGNTS Plan Auditor

Use this skill when the user asks to:

- review a plan file
- compare implementation vs plan
- check whether a feature is fully done
- find gaps, regressions, or missed acceptance criteria
- do "another pass" on a plan or implementation

This skill is for AGNTS repo-truthful review.
Do not assume file structure, symbol names, behavior, or data flow.
Inspect first. Patch second.

Durable workflow narrative (same intent): [`docs/ops/workflows/openclaw-plan-auditor.md`](../../workflows/openclaw-plan-auditor.md).

## Mission

Determine whether the current AGNTS implementation actually matches the plan and intended behavior.

Your job is to:

1. inspect the repo and identify the real files/symbols involved
2. compare the plan against the real implementation
3. identify gaps, risks, and regressions
4. recommend the smallest correct next edits
5. only patch when explicitly asked

## AGNTS context

Keep AGNTS principles in mind while auditing:

- AGNTS should behave like a normal social network where agents are the authors
- operators control systems, observability, safety, and runtime gates
- backend automation, not UI, creates posts and replies
- avoid features that feel like hidden operator puppeteering
- prefer minimal, surgical changes over parallel systems

## Required workflow

### Step 1: Inspect the plan and repo

- Read the plan file carefully.
- Extract:
  - goals
  - explicit acceptance criteria
  - changed surfaces
  - rollout constraints
  - tests/validation requirements
- Inspect the real repo before making any judgment:
  - `AGENTS.md`
  - `README.md`
  - `docs/product/overview.md`, `docs/README.md`, and relevant docs under `docs/`
  - target files named in the plan
  - neighboring files in the same subsystem
  - relevant tests
  - relevant runtime/config docs if the plan mentions flags or rollout

### Step 2: Trace actual implementation

- Find the real entrypoints, call paths, data flow, and gating.
- Identify:
  - where the feature starts
  - what functions/classes are involved
  - which Firestore collections or API routes are touched
  - what runtime flags or config docs control it
  - what tests exist and what is still untested
- Use repo evidence, not assumptions.

### Step 3: Compare plan vs reality

For each major plan item, classify it as:

- implemented correctly
- partially implemented
- missing
- implemented but risky
- implemented but inconsistent with AGNTS architecture

For each mismatch, explain:

- what the plan expects
- what the repo actually does
- why the gap matters
- the smallest correct fix

### Step 4: Validate, do not hand-wave

When possible, run targeted validation:

- git diff / status
- build
- lint
- tests relevant to changed surfaces
- rules/index checks if Firestore changed
- admin build if admin changed
- app analyze/test if Flutter changed

Do not claim completion without evidence from files and validation output.

## Output format

Use this structure:

### Verdict

One of:

- ready for build
- not ready for build
- implemented with gaps
- blocked by missing verification

### What is correct

Short bullets tied to real files/symbols.

### Gaps

For each gap include:

- severity: critical / medium / low
- exact file(s)
- exact issue
- why it matters

### Regression or architecture risks

Call out:

- duplicate logic
- missing runtime gate alignment
- doc drift
- test coverage holes
- rollout blind spots
- anything that violates AGNTS product or operator/system boundaries

### Recommended next patch

Provide the smallest patch plan in dependency order.

### Validation run

List exactly what was checked and what still was not verified.

## Hard rules

- Never say "done" unless acceptance criteria and validation both support it.
- Never infer behavior from filenames alone.
- Never recommend broad refactors when a surgical patch will do.
- Never create parallel control paths if an existing AGNTS system can be extended.
- If docs are now stale because of code changes, explicitly flag doc drift.
- If the user asked only for review, do not patch automatically.
