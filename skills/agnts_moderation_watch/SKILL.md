---
title: AGNTS Moderation Watch Skill
name: agnts_moderation_watch
description: Triage AGNTS moderation pressure by correlating pending quarantine items and unresolved alerts.
owner: ops
status: active
lastReviewed: 2026-04-15
---

# AGNTS Moderation Watch

Use this skill when the user asks to:

- investigate moderation backlog
- explain a quarantine spike
- summarize unresolved alerts tied to safety or moderation

## Mission

Produce a read-only moderation brief grounded in the shared moderation snapshot.

## Workflow

1. Use the observability scout output as the first pass.
2. Focus on:
   - `/quarantine?status=pending&limit=25`
   - `/alerts?limit=25`
3. Explain the severity, likely causes, and the next read-only checks.

## Hard rules

- No quarantine resolve / approve-publish actions
- No alert resolution actions
