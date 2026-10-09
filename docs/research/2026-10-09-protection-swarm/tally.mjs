import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const voters = ["worker-a", "worker-b", "worker-c"];
const plans = ["P-legacy", "P-regional", "P-research"];
const dispositions = ["foundation", "prototype", "defer", "reject"];
const components = Array.from({ length: 14 }, (_, i) => `C${String(i + 1).padStart(2, "0")}`);
const sameSet = (a, b) => a.length === b.length && new Set(a).size === a.length && a.every(x => b.includes(x));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const ballots = [];

for (const voter of voters) {
  const ballot = JSON.parse(await readFile(join(directory, "ballots", `${voter}.json`), "utf8"));
  assert(ballot.worker === voter, `Identity mismatch: ${voter}`);
  assert(ballot.slateRevision === "r1", `Wrong slate: ${voter}`);
  assert(ballot.voteMeaning === "approve-prototype-investment", `Wrong vote meaning: ${voter}`);
  assert(ballot.claimsDemonstratedSecurity === false, `Unsupported security claim: ${voter}`);
  assert(Array.isArray(ballot.ranking) && sameSet(ballot.ranking, plans), `Incomplete ranking: ${voter}`);
  assert(ballot.preferredPlan === ballot.ranking[0], `Preferred plan/rank mismatch: ${voter}`);
  assert(ballot.components && sameSet(Object.keys(ballot.components), components), `Incomplete components: ${voter}`);
  for (const component of components) {
    const choice = ballot.components[component];
    assert(dispositions.includes(choice.disposition), `Unknown disposition: ${voter}/${component}`);
    assert(typeof choice.reason === "string" && choice.reason.length > 0, `Missing reason: ${voter}/${component}`);
    assert(Array.isArray(choice.conditions), `Missing conditions: ${voter}/${component}`);
  }
  assert(Array.isArray(ballot.blockingObjections) && Array.isArray(ballot.dissent), `Missing objections: ${voter}`);
  assert(ballot.cheapestExpectedAttack && ballot.firstExperiment, `Missing falsifier: ${voter}`);
  ballots.push(ballot);
}

const firstChoiceCounts = Object.fromEntries(plans.map(plan => [plan, ballots.filter(b => b.preferredPlan === plan).length]));
const majorityPlan = plans.find(plan => firstChoiceCounts[plan] > ballots.length / 2) ?? null;
const componentDispositions = Object.fromEntries(components.map(component => [component,
  Object.fromEntries(dispositions.map(disposition => [disposition,
    ballots.filter(b => b.components[component].disposition === disposition).length
  ]))
]));
const tally = {
  slateRevision: "r1",
  voteMeaning: "approve-prototype-investment",
  claimsDemonstratedSecurity: false,
  actualWorkerCount: ballots.length,
  specialistBriefCount: 9,
  independentBallotsPerWorker: 1,
  voters,
  firstChoiceCounts,
  majorityPlan,
  componentDispositions,
  caveat: "Three persistent model workers after shared deliberation; nine briefs are not nine voters. Votes are judgments, not security measurements."
};
await writeFile(join(directory, "40-vote-tally.json"), `${JSON.stringify(tally, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(tally, null, 2)}\n`);
