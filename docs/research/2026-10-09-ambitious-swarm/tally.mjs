import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const workers = ["worker-a", "worker-b", "worker-c"];
const candidates = ["A1", "A2", "A3"];
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const nonempty = value => typeof value === "string" && value.trim().length > 0;
const digest = value => createHash("sha256").update(value).digest("hex");
const ballots = [];
const ballotHashes = {};
for (const worker of workers) {
  const bytes = await readFile(join(directory, "ballots", `${worker}.json`));
  const ballot = JSON.parse(bytes.toString("utf8"));
  assert(ballot.worker === worker && ballot.slateRevision === "r1", `Invalid identity or slate: ${worker}`);
  assert(ballot.voteMeaning === "conditional-research-selection", `Invalid meaning: ${worker}`);
  assert(ballot.claimsDemonstratedSecurity === false && ballot.claimsFunctionalRecoveryResistance === false, `Unsupported claim: ${worker}`);
  assert(Array.isArray(ballot.selected) && ballot.selected.length <= 2 && new Set(ballot.selected).size === ballot.selected.length && ballot.selected.every(id => candidates.includes(id)), `Invalid selection: ${worker}`);
  assert(ballot.reasons && candidates.every(id => nonempty(ballot.reasons[id])), `Missing reasons: ${worker}`);
  assert(Array.isArray(ballot.requiredConditions) && ballot.requiredConditions.length > 0 && ballot.requiredConditions.every(nonempty), `Missing conditions: ${worker}`);
  assert(nonempty(ballot.cheapestDefeat) && nonempty(ballot.firstExperiment), `Missing falsifier: ${worker}`);
  ballots.push(ballot);
  ballotHashes[worker] = digest(bytes);
}
const votes = Object.fromEntries(candidates.map(id => [id, ballots.filter(ballot => ballot.selected.includes(id)).length]));
const selected = candidates.filter(id => votes[id] > workers.length / 2);
assert(selected.length <= 2, "More than two majority candidates: deliberate again instead of inventing a tie-break");
const tally = {
  slateRevision: "r1",
  slateSha256: digest(await readFile(join(directory, "10-frozen-slate.md"))),
  voteMeaning: "conditional-research-selection",
  nominationCount: 23,
  nominationSets: 3,
  nominationsMayOverlap: true,
  actualWorkerCount: workers.length,
  independentBallotsPerWorker: 1,
  coordinatorVotes: 0,
  workers,
  ballotHashes,
  votes,
  selected,
  emptyBallots: ballots.filter(ballot => ballot.selected.length === 0).map(ballot => ballot.worker),
  claimsDemonstratedSecurity: false,
  claimsFunctionalRecoveryResistance: false,
  caveat: "Three persistent model workers voted after shared deliberation. These are independent ballot submissions, not independent models, human approvals or security measurements. All required conditions remain binding."
};
await writeFile(join(directory, "11-vote-tally.json"), `${JSON.stringify(tally, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(tally, null, 2)}\n`);
