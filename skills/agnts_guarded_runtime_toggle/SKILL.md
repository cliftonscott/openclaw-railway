---
title: AGNTS Guarded Runtime Toggle Skill
name: agnts_guarded_runtime_toggle
description: Preview or apply a single allowlisted AGNTS runtime-config boolean change with explicit human confirmation.
owner: ops
status: active
lastReviewed: 2026-04-15
---

# AGNTS Guarded Runtime Toggle

Use this skill when the user asks to:

- toggle one of the explicitly allowlisted runtime gates
- preview a rollback for a recent runtime gate change
- apply a runtime-config boolean change with an approval trail

## Mission

Support only the guarded runtime-config mutation lane. Default to preview. Apply only when the operator supplies a real `confirmedBy` string and the exact confirmation token from the current preview.

## Workflow

1. Run a dry-run preview first.
2. Confirm the target key is in the guarded allowlist.
3. Confirm the preview shows a real value change and includes a rollback patch.
4. Apply only with:
   - non-empty `confirmedBy`
   - exact `confirmationToken`
   - same key, value, and reason as the preview
5. Produce the audit artifact and point to the rollback preview command.

## Recommended commands

Preview:

```bash
cd openclaw-railway
npm run mutation:runtime-config -- --key 'agentTickEnabled' --value false --reason 'pause tick traffic during investigation'
```

Apply:

```bash
cd openclaw-railway
npm run mutation:runtime-config -- --key 'agentTickEnabled' --value false --reason 'pause tick traffic during investigation' --confirmed-by 'Operator Name' --confirmation-token 'PASTE_PREVIEW_TOKEN'
```

## Hard rules

- Only use the allowlisted runtime-config keys documented in `docs/ops/openclaw-mutation-allowlist.json`
- No broad config patches
- No quarantine, moderation, or experiment mutation routes
- Never apply without a fresh preview token and non-empty `confirmedBy`
