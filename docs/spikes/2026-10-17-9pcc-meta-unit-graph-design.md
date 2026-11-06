# 9pcc Design: public, guarded meta unit graphs

- **Status:** design for review; no implementation yet
- **Issue:** `monocloud#9pcc`
- **Scope:** `rpiv-pi`, `rpiv-workflow`, and the `rpiv-praxis` host in this fork

## Problem

`defineUnitGraph` already compiles a declarative unit list into the meta
workflow, but consumers reach it through a deep source path. The graph also
does not carry a complete authoring contract into the runner: issue attribution,
budget ceilings, sensitive-unit declarations, and human parking are implicit or
absent. Two meta checks can also report green for work that predates the current
unit, and acceptance evidence can be skipped without a count in the gate record.

## Decisions

- Expose the authoring API at the stable import `@juicesharp/rpiv-pi/meta`.
- Keep `defineUnitGraph` in `rpiv-pi`; the compiler is built from Pi-side
  authoring helpers. The common workflow package carries only the serialized
  runtime metadata and guard contract it needs.
- Keep acceptance items with explicit `manual` or `deferred` dispositions
  legal, but count and report each one. Missing or malformed dispositions fail.
- Use a host-provided client-data authorizer, never an environment variable or
  graph-authored self-authorization. The host rechecks it on every sensitive
  unit entry, including after resume, and denies by default.
- Keep independent runner/time ceilings configurable and add one aggregate
  dollar budget. `maxCostUsd` defaults to `$3`; there is no separate token cap.
- Keep 13ks (grader non-convergence) out of scope for this change.

## Authoring contract

The public subpath exports the compiler, public graph/unit/check types, and the
supported deterministic check helpers. It does not expose internal compiler
stages or routing records.

`UnitGraphSpec` requires a valid `kata` attribution and `human: "park"`. The
`kata` value identifies the issue that owns the authored graph; it is not the
task issue for every future execution. A run's task context remains separate.
The spec may declare a graph-level default `model` and a `caps` object.
`UnitSpec` may override the graph model and mark a unit `clientData: true`.
Existing `maxRounds` and `onExhausted` remain per-unit loop policy; they are not
replaced by run caps.

```ts
defineUnitGraph({
  name: "example",
  kata: "abcd",
  model: "provider/model-id",
  human: "park",
  caps: {
    maxCostUsd: 3,
    maxMinutes: 30,
    maxIterations: 24,
    maxLaps: 8,
    maxBackwardJumps: 12,
  },
  units: [
    ["research", { skill: "research", output: "research" }],
    ["implement", { skill: "implement", clientData: true }],
  ],
});
```

The accepted cap fields are `maxCostUsd`, `maxMinutes`, `maxIterations`,
`maxLaps`, and `maxBackwardJumps`, validated by the same bounds as the
corresponding runtime. If `maxCostUsd` is omitted, the compiler supplies `$3`.
Other omitted values preserve existing engine defaults. A stricter caller/host
cap always wins; a caller cannot raise the graph's ceiling.

`kata` is source-level provenance for the authored graph, not a replacement for
the task/issue supplied in a particular workflow run. `clientData: true` marks
the unit that crosses that boundary; the compiler records the exact set of unit
names in runtime metadata. A model default applies to prompt stages, while a
unit-specific model overrides it; script/check/gate stages remain model-free.

## Runtime and resume behavior

The compiler places a versioned `rpiv` metadata object on the returned
`Workflow`: kata attribution, effective caps, sensitive unit names, and the
human policy. `rpiv-workflow` validates and persists this object with the run
snapshot. Existing workflows without this metadata remain valid.

Before a fresh run starts, and before each declared client-data unit is entered,
the host calls its authorization callback with the run, workflow, and unit
identity. The callback receives the run id, workflow/kata identity, unit name,
and whether this is a resume. The host denies if no callback exists or if it
returns false. A graph with no client-data units does not require the callback.
On resume, the guard is called again before a sensitive unit runs. The effective
sensitive-unit set is the union of the run-start declaration and the current
workflow declaration, so a later edit cannot remove a guard from an in-flight
run. A denied check stops before dispatch; no model session or side effect is
started for that unit. The default Praxis CLI policy denies unless a trusted
host adapter supplies an authorizer; workflow prompt/input cannot grant access.

The effective run caps are the strictest of the run-start snapshot, the current
workflow declaration, any stricter CLI limits, and the engine's hard ceiling.
The cost and elapsed-time totals continue across resumes using Praxis's existing
run ledger. A later resume cannot raise a cap or reset accumulated usage.

`human: "park"` makes an `AskUserQuestion` a persisted park/resume boundary,
using Praxis's existing question lifecycle and exit code. A host that cannot
park must fail closed rather than guess or continue. Resuming a parked run
retains the policy and rechecks client-data authorization before any sensitive
unit.

The built-in meta graph keeps its acceptance producer. It must emit the frozen
`a1…` item IDs; downstream planning and validation receive the same collected
acceptance artifact as `--acceptance <path>`, without regenerating the
inventory. The acceptance command check records executed and skipped items.
`manual`/`deferred` are explicit skips, not failures, but missing or invalid
dispositions fail the deterministic check. The internal check result accepts
the existing `Failure[]` form and adds an optional structured `skipped` list;
the gate record persists executed/skipped counts and item ids.

## Freshness checks

Each producer/corrector attempt gets a durable start checkpoint before any
model work. It records a working-tree digest and the relevant output-bucket
artifact snapshot in run state.

- `treeChanged` compares the post-attempt digest with this checkpoint. Existing
  dirty or untracked work from before the unit does not satisfy the check.
- `artifactWritten` requires the collected artifact to be new or changed in the
  current stage window; a stale file that merely exists is red. A missing
  checkpoint is an integrity failure for meta checks, not a green fallback.
- Checkpoint state survives resume and is refreshed for each producer/fix
  attempt. Existing collector stage-window freshness remains the collection
  boundary; the check independently verifies the final artifact.

## Failure behavior

- Invalid/missing kata metadata, invalid client-data declarations, invalid cap
  values, or a workflow that cannot honor `human: "park"` fail at
  load/compile time.
- Missing/denied client-data authorization stops before the protected unit and
  records a policy denial; it does not silently downgrade to a normal run.
- A host that cannot measure cost cannot claim the aggregate USD ceiling was
  enforced. A graph with `maxCostUsd` must fail closed with a capability
  diagnostic unless its host can account for spend across the full run/resume
  ledger.
- Budget exhaustion uses Praxis's existing resumable budget termination. The
  persisted effective cap and usage ledger remain authoritative on resume.
- Missing freshness checkpoint or unchanged/stale output fails the unit's
  deterministic checks and enters the normal bounded correction/halt policy.
- Explicit acceptance skips are visible in the check result; undisposed IDs
  remain blocking.

## Verification plan

1. Package-surface tests import the graph compiler through
   `@juicesharp/rpiv-pi/meta`, including from an npm-packed package, while
   existing plugin and extension subpaths keep resolving.
2. Unit-graph tests validate required kata/human metadata, cap bounds/defaults,
   graph and unit model precedence, client-data unit names, park metadata, and
   acceptance ID threading.
3. Praxis tests cover fresh-run authorization, denial before dispatch, revoking
   authorization between a park and resume, aggregate cost/time across resume,
   and caps that cannot be raised by CLI arguments.
4. Meta-check tests cover pre-existing dirty work, changed/new work, stale
   artifacts, missing checkpoints, explicit manual/deferred skip counts, and
   undisposed acceptance IDs.
5. Run the full workspace check/test suite and the existing parked-question and
   run-ledger suites. Mutation-test the guards for authorization, cap
   preservation, freshness, and skip accounting.

## Non-goals

- Changing the grade-loop convergence policy from 13ks.
- Moving the meta compiler wholesale into `rpiv-workflow`.
- Adding a separate token ceiling or making the user configure model tokens.
- Touching `~/.cache/monocloud/rpiv-praxis`.
- Publishing a package release or merging the PR without separate approval.
