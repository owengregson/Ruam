# Deliberation and voting method

Set before proposal selection on 2026-10-09. This is an engineering investment decision, not an empirical security certification.

## Participants and independence

Three persistent workers cover nine specialist briefs. Worker A is `swarm_compiler`, B is `swarm_runtime`, C is `legacy_review`. The coordinator assembles and records decisions. Each worker submits one final ballot; its three specialist roles do not create additional votes. Initial briefs are independent of peers, but later briefs retain the same worker's prior reasoning. Deliberation is intentionally shared. Final ballots must not read the other ballots before submission.

## Selection criteria

First reject candidates that require an undeclared trust domain, break the declared semantics, retain an unprotected authored implementation, or have no implementable integration path. A broken prototype may be proposed for restoration, with that restoration explicitly budgeted.

For remaining candidates, deliberate in this order:

1. Which concrete cheapest attack does the mechanism obstruct, and what cheaper attack can replace it?
2. Does the combination change the reconstruction problem, or merely multiply transformations that one normalization removes?
3. Can a minimal experiment falsify the hypothesis before a large rewrite?
4. Does it preserve the whole system's semantic, effect, continuation and publication contracts?
5. Is the expected attacker burden disproportionate to legitimate runtime, build, size and maintenance cost?
6. What existing implementation and regression evidence can be reused safely?

No numerical novelty/recognizability score contributes to the decision. Paper results and in-repository experiments have separately stated scope. Historical attack results must not silently become measurements of new proposals.

## Round 2 panels

Each of the three workers reads all nine briefs. Worker A reviews semantic and performance interactions, B reviews attack and cryptanalysis interactions, C reviews architecture and deployment interactions. Each panel must identify an attractive combination, an incompatible combination, the cheapest plausible defeat, and a change required before it would vote for the combined plan. It may veto a component only with a specific contradiction or blocker; ordinary uncertainty becomes a prototype gate.

## Integration and frozen slate

The coordinator publishes candidate system plans and component IDs after panel review. The final r1 slate uses `foundation`, `prototype`, `defer`, or `reject` for each component. The slate must define one ordered pipeline, shared intermediate contracts, owner/client artifact separation, exception/host boundaries, module/dynamic-source handling, budgets and promotion conditions. It must include realistic alternatives rather than a straw-man vote.

## Actual ballots

Each worker writes one JSON ballot with:

- worker identity and the frozen slate revision;
- preferred integrated plan and full ranking;
- each component's disposition, concise rationale and conditions;
- concrete blocking objections and dissent;
- the cheapest attack it expects to win against the preferred plan;
- the first experiment it would fund;
- `voteMeaning: "approve-prototype-investment"`;
- `claimsDemonstratedSecurity: false`.

The coordinator validates completeness and counts one vote per worker. A simple majority chooses the preferred prototype direction. Unanimity does not override a demonstrated semantic contradiction or missing required trust boundary. Ties on component disposition are resolved by the narrower reversible experiment, with the coordinator's reasoning recorded. Minority objections remain visible and become explicit test cases or deferrals. If no plan passes feasibility review, the correct result is a bounded experimental program, not an invented winner.

## Evidence needed after the campaign

Any future “materially stronger” claim requires preregistered tasks, equal semantic coverage, frozen budgets, independent attacker implementations, unseen programs/build seeds, full-access attacks, standalone recovered replacements, explicit failures/censoring, and measured user cost. Diagnostic tests that expect a failed security gate must remain separate from release qualification. Absolute offline secrecy is not a campaign outcome.
