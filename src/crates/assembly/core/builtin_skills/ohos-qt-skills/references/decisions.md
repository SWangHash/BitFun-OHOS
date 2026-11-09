# User decisions

The one place for how migration questions are asked and their answers kept.
`decisions.tsv` is a plain question/answer store (`ledger.py columns
decisions.tsv`): no gate reads it, so recording an answer is the whole job.

## When to ask

- Phases 1-2 ask nothing. Every question the migration needs is written into
  `decisions.tsv` as soon as it is found, with an empty `answer`. Three
  questions are always recorded: the bundle name, the signing route and
  whether a device is available.
- At the end of phase 3 (decisions), before its gate, every unanswered
  question is asked in one `AskUserQuestion` call.
- A question found later (for example a degradation proven on the device) is
  asked when it is found.
- HarmonyOS external features are not asked before phase 6; a request that
  names one is noted in `Next executable action` for that phase. Their
  questions (selection, retry, deferral) are never `decisions.tsv` rows: the
  answer goes into the feature's `features.tsv` row
  ([external-features.md](external-features.md)).

## How to ask

- Contract questions use `autoDecideAfterSeconds: 600` (or the wait the user
  asked for), so an absent user costs ten minutes, not a night.
- Each question lists the recommended option first, labelled `(Recommended)`,
  with its impact in the description. Recommend what keeps the migration
  moving with the least loss: guard and hide a desktop-only action on OHOS
  rather than delete it; keep a host regression optional rather than block on
  installing a desktop Qt. Use what `environment.tsv` and the smoke test
  found about signing and devices.
- The standard questions and their recommendations:

| Question | Recommended | Other options |
|---|---|---|
| bundle name | `com.example.<app>` (lower-case letters and digits of the target name), or the identity the project already declares (macOS bundle id, Android package, organization domain) | a typed answer through "Other" |
| signing | CLI self-signing (`device_run.py sign`, `devecocli signature generate`; the user may have to run `devecocli auth login` once) | unsigned HAP only (install/launch not verified); "I configure signing in DevEco Studio" |
| device | "use the connected device" when the smoke test ran on one; otherwise "no device: continue and verify install/launch later" | "I will connect a device before the application's first device round" |

- A question that needs the user's own action and has no safe default (a
  device to reconnect or unlock, and the phase 6 feature questions) has no
  `autoDecideAfterSeconds` and gets `timeout_seconds: 1800`.
  Without either, a question times out after 30 s, which is not an answer.

## How to record

| Result | Row |
|---|---|
| the user answered | `answer` = the chosen option or the user's own words, `owner=user` |
| status `auto_decided` (nobody answered in time; the runtime chose the recommended option) | `answer` = the recommended option, `owner=agent-default`; tell the user in the next message which answers were chosen for them and that they can change any of them, then keep working |
| timed out, skipped or dismissed without `auto_decided` | no answer: leave `answer` and `owner` empty, never fill in a default yourself; write the open question in `Next executable action` and stop when the next step needs it |

When the user changes an answer later, update the same row
(`ledger.py update <root> decisions.tsv <DEC> --set "answer=<new>" --set owner=user`)
and re-plan the TASK rows it affects.

## What needs an answer

- **Degradations.** Removing, stubbing, deferring or degrading a capability
  needs the user's answer (or a decisions-phase question the runtime auto-decided);
  without one, implement the capability or set the TASK row that handles it
  `blocked` and wait for the answer (it becomes `accepted-limitation` or
  `in-progress`). With the answer, cite the DEC id in the TASK row that applies
  it; the inventory row (`disposition=needs-decision` when the inventory
  already saw the question) is not changed. Replacing a pinned
  dependency route (for example a vendored library) with a stub is a
  degradation too.

  Not a degradation: aligning the application's calls to the real public API
  of a dependency (header path, function or type names, `extern "C"` for C
  headers), or honestly reporting a capability the library never had (for
  example a CLI-only package with no linkable library). Only behavior the
  application had on another platform and loses on OHOS is a degradation.
- **Plan amendments.** The plan (the environment: build system qmake/CMake,
  Qt version and SDK version; inventory dispositions and target behaviors,
  the answers, the VAL scenarios and the STATE.md Scope, all shown by
  `ledger.py state`) is frozen at the phase 3 gate; any later change needs
  the user's consent. A
  material change to the stack, scope, a dependency, a degradation, signing or
  a destructive device action is a new question; apply the answer between
  rounds, never inside a repair loop, then revalidate the rows it affects.

## Without a device

When `environment.tsv` reports no connected device, the gates do not require
an install and launch: neither the smoke test's hello app nor the
application. The report's `Completion tier` then stops at what was proven
(at most `packaged`). Connect a device and rerun `env_probe.py` to verify
later.

## Answers chosen for the user

In the validation phase `report.md` `## Decisions made on the user's behalf` lists every
`agent-default` row with its answer and how to change it.
