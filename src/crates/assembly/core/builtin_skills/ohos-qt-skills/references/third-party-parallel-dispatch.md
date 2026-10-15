# Third-party parallel dispatch

Gate-keeping and split/merge convention for parallelizing third-party
dependency work (judgment / fetch / cross-compile) with subagents. The
trigger is the portgraph closure evidence produced during the **inventory**
phase (see `SKILL.md` section 1): after `portgraph analyze|deps <app>`, the
`fetch-deps <app> --dry-run` preview and the real `fetch-deps <app>` run land,
dispatch third-party work according to this page instead of processing the
dependency list serially in the main conversation.

This is a speed-up of actions that the migration would perform anyway. It
must not change the decision logic, add new stages, or silently alter what
the closure says: the only difference is *who* executes each item (a
parallel subagent instead of the main conversation), never *what* items
exist.

## Phase-entry rules (run before any third-party work)

1. First decompose parallelizability with the three questions below; do not
   inherit serial habits from the previous phase.
2. Mechanical subtasks are not the same as judgment subtasks: all bottles
   `downloaded` by the deterministic CLI only covers the mechanical part;
   judgment work (per-item disposition) must be counted separately.
3. Any trigger condition met means **forced parallel dispatch** — soft
   wording like "should" / "can" does not apply. Even when the conclusion is
   "no parallel needed", output the candidate list plus per-item rationale,
   **and record each trigger's raw count with its source** (for example
   `judgment = analyze.blockers(3) + analyze.unknowns(0)`); never skip with a
   single sentence, and never state a threshold decision without the count
   behind it.
4. Todo items carry gate semantics (e.g. `third-party stage: obtain
   artifacts + per-item judgment of blockers/unknowns (≥3 items → parallel
   dispatch)`), never narrowed to "obtain dependency artifacts".
5. After a context compaction, re-verify judgment-class conclusions from the
   summary (distinguish `[tool output]` from `[judgment - recheck]`).

## Parallelizability decomposition (three questions)

① Which mutually disjoint **read-only** work exists? → parallelizable
   (judgment — reasoning type, `Explore`).

② Which **write** work has non-overlapping artifact directories? →
   parallelizable (fetch / cross-compile).

③ Which work writes the **same directory / produces the same file**? →
   **not parallelizable** — main agent holds it single-point, e.g. flattening
   N `.pc` files into one shared pkgconfig directory + generating a single
   `ohos-deps.cmake`, or installing several packages into one shared prefix
   (`brew install a b c` → `$HOME/.harmonybrew`): multiple agents writing
   inevitably conflicts.

## Trigger conditions (met → forced dispatch)

### Each trigger counts a different unit — never the number of libraries

| Scenario | Counting unit (from the closure output) | Threshold |
|----------|------------------------------------------|-----------|
| Judgment | `analyze` **`blockers` + `unknowns` rows** (platform-interface blockers such as ALSA / PulseAudio / X11 included) | ≥3 rows |
| Fetch | `cmd_only` / `failed` rows whose artifact lands in a **per-library directory** | ≥2 rows |
| Cross-compile | `need_port` rows **+** `failed` rows that could not be recovered | ≥1 row |

The judgment count is the one most easily mis-taken: it is the number of
*judgment items* in the closure report, **not** the number of third-party
libraries. A project with only two libraries can carry five platform blockers,
and the judgment trigger fires on the five. Count the rows the tools print,
quote the source of the count in the evidence, and never re-derive a count from
the library list — `judgment = analyze.blockers(3) + analyze.unknowns(0)` is
the form to record, so a miscount shows up in the ledger instead of silently
skipping the dispatch.

Based on the closure result from the phase-entry gate. Take the counts from the
**real** `fetch-deps` manifest: a `--dry-run` classifies every downloadable row
as `would_download` and can never report `failed`, yet `failed` is half of the
fetch threshold, so a row whose direct link is dead only becomes visible after
the real run has landed. The real run must therefore land before this decision
— never later, in the implementation phase:

- **Judgment (highest priority — this is the existing judgment action,
  parallelized):** per-item judgment follows the closure table's existing
  rows — blocked items look at guard evidence (`ohos-active` unconditional
  hit and core path → hard blocker; macro guard exclusion / file-level
  exclusion → optional branch, release); unknowns items check
  `fetch-ohos-third-party-lib` and `qt-harmonyos-third-party-libs` pages
  (bottle direct / source cross-compile / report to user). **Do not
  enumerate extra items** — judgment scope = blocked + unknowns rows in the
  closure list, same as before the change, not the full list. Judgment
  conclusion uses the four-way classification (optional-off / platform
  excluded / built-in fallback / true hard gap). **≥3 judgment items →
  forced parallel** (unit = judgment item, may be grouped, one subagent per
  group; upstream-downstream judgment of the same item must not cross
  subagents). The count is `analyze`'s `blockers` + `unknowns` row count —
  platform-interface blockers count too, and the size of the library list is
  irrelevant (two libraries with five blockers still means five judgment
  items). ≥2 libraries needing the `qt-harmonyos-third-party-libs` §6
  list compatibility evaluation also belong here. Platform blocker groups
  are highest value: under OHOS `Q_OS_OHOS` implies `Q_OS_LINUX`, so code
  "guarded only by `Q_OS_LINUX` but calling Linux-specific APIs" silently
  participates in compilation — must be exhaustively searched.
- **Fetch:** classify each closure row by **where its artifact lands**, then
  apply the threshold to that landing path — the parallel unit is the landing
  path, not the library:
  - `downloaded` / `already_local` / `covered` (statuses of the real-run
    manifest; a dry-run previews all of them as `would_download`): the
    deterministic CLI `fetch-deps <app>` already prefetches in parallel
    (`--jobs`) and lands everything under the shared `workspace/ohos-libs/`
    tree in one pass → **no dispatch** (mechanical, no LLM reasoning needed);
  - `cmd_only` / `failed` resolved into a **per-library directory**
    (`workspace/ohos-libs/<name>/`): fill version → construct direct bottle
    link / retry download / hand-fetch into that library's own directory;
    independent per item → **≥2 items forced parallel**;
  - **shared-prefix install** (`brew install <pkg>` into `$HOME/.harmonybrew`,
    or a `cmd_only` row resolved by running its `artifact_cmd`) → lands in one
    shared tree (question ③) → **main agent single-point, never dispatched**:
    run the whole batch as a single command and record the per-item rationale
    in the ledger. A shared-prefix batch **never counts toward the ≥2
    threshold** — do not dispatch workers for it, and do not report it as an
    ignored trigger;
  - global-rewrite landing (`.pc` flatten / prefix rewrite / generating a
    single cmake) → **forbidden to parallelize**, main agent holds it
    single-point.

  > The route decides, not the status label: one library can be
  > fetch-parallelizable through a direct link into `ohos-libs/<name>/` and
  > single-point through `brew install` (typical when the agent finds a live
  > bottle the closure did not report). Judge the route first, then apply the
  > threshold to the route.
- **Cross-compile:** after the closure, **first enumerate the full
  `need_port` gap list** (never only the first known item), together with any
  `failed` row whose retry and URL check did not recover it — the upstream
  disposition for `failed` is fall back to source compilation, so such a row
  joins this list instead of disappearing; **≥1 item forced dispatch**: ≥2
  items → one subagent per item in parallel (artifact directories disjoint);
  ==1 item → a single subagent (high verification intensity, main agent
  should not do it by hand); 0 items → skip.

## Split rule

The parallel unit is **one third-party library** (or one judgment item),
one subagent per item. The same library's analysis → fetch → cross-compile
has sequential dependencies and must not be split across subagents
(serial dependencies are not parallelized); only mutually independent
libraries / mutually independent judgment items are parallelized.

| Scenario | Per-item subtask | subagent_type | Write boundary |
|----------|------------------|---------------|----------------|
| Judgment | blocked/unknowns item judgment (guard evidence / path disposition) + four-way classification + §6 list compatibility evaluation; output `<item>|<class>|<evidence:file:line>|<close-method>|<confidence>` | Explore | read-only, no file modification |
| Fetch (cmd_only/failed → per-library dir) | fill version → construct bottle direct link / retry download / hand-fetch into the library's own directory; output link snippet | GeneralPurpose | write only that library's artifact directory `ohos-libs/<name>/`; shared-prefix installs (`brew install`) are main-agent single-point |
| Cross-compile | build with OHOS toolchain (`ohos.toolchain.cmake` + `-DOHOS_ARCH=arm64-v8a`), produce `.so`/`.a` + headers + CMake config, verify NEEDED closure | GeneralPurpose | write only that library's own build/install directory, no shared CMake cache |

## Parallel launch

Issue all N `Task` (spawn) calls in the same assistant message (subagent
mechanism provided by the runtime). Subagents have fresh context, so the
prompt must be self-contained:

```
subtask: <judgment/fetch/cross-compile> library or item <name> (version <ver>)
scope: <blocker/unknown item ID / formula name / manifest item ID / bottle install dir>
focus: judgment → blocked guard evidence? unknowns path? four-way classification
       (optional-off/excluded/fallback/hard-gap)? + §6 list + platform-limits hits;
       fetch → bottle existence + sha256 + runtime dependency recursion + link snippet;
       cross-compile → toolchain config + NEEDED closure + deploy to entry/libs/arm64-v8a/
output: judgment → `<item>|<class>|<evidence:file:line>|<close-method>|confidence`;
        others → conclusion + evidence (file:line / command output) + confidence(1-10)
do not: judgment subtask must not modify files;
        fetch/compile subtasks write only their own library's artifact directory
```

## Result merge

- All success → merge per-item conclusions (including close method
  `-D...=OFF`) + link snippets; feed the later CMake integration and
  packaging/deploy.
- Partial failure → keep the failed library/item list marked `[partial]`,
  advance the success part first; the main conversation handles failures
  serially.
- All failed → main conversation degrades to self-analysis, result marked
  `parallel dispatch unavailable`.

## Relation to this skill's phases

- The closure evidence is recorded as `CAP-*` rows in `inventory.tsv` /
  `work-queue.tsv` during the inventory phase; parallel dispatch executes
  those rows without changing the ledger schema.
- Global-rewrite landing (shared pkgconfig dir, single cmake, shared
  package-manager prefix) is main-agent single-point in the implementation
  phase; per-library fetch/cross-compile artifacts land in disjoint
  directories and are safe to parallelize.
- The general rule "parallelize only disjoint discovery or implementation
  scopes; never have workers edit the same contract, manifest, inventory,
  or project envelope concurrently" (see
  [migration-workflow.md](migration-workflow.md)) still applies: this page
  specializes it for third-party work with forced thresholds.
