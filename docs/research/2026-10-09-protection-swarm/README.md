# Ruam offline protection design campaign

**Decision:** prototype one whole-root regional compiler with proven private-computation fusion, dependent region realization, and separately evaluated fixed-configuration specialization. All three worker ballots selected this direction, subject to early falsification and explicit stopping rules. Additional state encodings and automated search were deferred.

The user required strictly offline, server-free JavaScript. No product code changed. This is a completed design/voting campaign, not an implemented or measured security improvement.

## Start here

- [Selected integrated design and work order](50-integrated-design.md)
- [Actual votes, component decisions and objections](41-decision-ledger.md)
- [Frozen alternatives and common quantitative gates](30-frozen-slate.md)
- [Machine-readable vote tally](40-vote-tally.json)

## Process and participants

The available tool limited this session to three persistent workers. They completed nine specialist briefs in waves, yielding 26 component proposals; then three cross-domain reviews, an integrated candidate slate, and one independently submitted ballot per worker. The coordinator cast no extra vote. Three workers are not nine independent agents, and their shared-model consensus is not empirical security evidence.

| Round | Artifacts |
| --- | --- |
| Charter and decision method | [Charter](00-charter.md), [method](10-decision-method.md), [run log](12-run-log.md), [research register](11-research-register.md) |
| Independent specialist briefs | [Compiler](01-compiler.md), [runtime](02-runtime.md), [state](03-state.md), [attacks](04-attacks.md), [performance](05-performance.md), [deployment](06-deployment.md), [research](07-research.md), [integration](08-integration.md), [qualification](09-qualification.md) |
| Cross-domain critique and actual peer discussion | [Semantics/performance](20-semantics-performance-review.md), [attacks](21-attack-review.md), [architecture/deployment](22-architecture-review.md) |
| Deliberation and frozen alternatives | [Slate r1](30-frozen-slate.md) |
| Voting and coordinator disposition | [Worker A](ballots/worker-a.json), [worker B](ballots/worker-b.json), [worker C](ballots/worker-c.json), [ledger](41-decision-ledger.md) |

Earlier briefs preserve the ideation history; later reviews and the final design resolve their disagreements. In particular, finite literal eval precompilation and immediate extra-state-encoding prototypes are not in the selected initial system.

Reproduce ballot validation and tally from the repository root:

```sh
node docs/research/2026-10-09-protection-swarm/tally.mjs
```

The important outcome is a smaller integrated experiment with harder evidence requirements. Generic AST-to-SSA normalization, output slicing and local synthesis are the first attacks to beat. A failed experiment stops the protection expansion instead of being renamed or covered with more layers.
