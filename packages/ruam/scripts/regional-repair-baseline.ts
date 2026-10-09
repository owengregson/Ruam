/** Isolated bounded WIP repair experiment. Never writes product sources. */
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
const root = resolve(import.meta.dir, "../../..");
const evidence = resolve(root, "docs/research/2026-10-09-protection-swarm/implementation/qualification");
const originalReport = JSON.parse(readFileSync(join(evidence, "historical-report.json"), "utf8"));
const baseline = originalReport.archives.find((item: { id: string }) => item.id === "september-local");
const archive = baseline.archive;
const relative = "packages/ruam/src/isogloss/runtime/regional-artifact-emitter.ts";
const target = resolve(archive, relative), before = readFileSync(target, "utf8");
if (before.includes("function buildStructuredLoopLayouts")) throw new Error("Archive already contains repair; rerun regional-baselines for clean archives.");
const repair = `
/** Isolated qualification repair: reducible natural loops with a linear header prefix. */
interface StructuredLoopLayout {
 readonly headerRegionId: string;
 readonly loopTarget: string;
 readonly exitTarget: string;
 readonly continueWhenTrue: boolean;
}
function buildStructuredLoopLayouts(graph: EffectRegionGraph, _unit: unknown): ReadonlyMap<string, StructuredLoopLayout> {
 const byId = new Map(graph.regions.map(region => [region.id, region]));
 const reachable = new Set(regionDistances(graph, graph.entryRegionId).keys());
 const predecessors = new Map([...reachable].map(id => [id, new Set<string>()]));
 for (const region of graph.regions) if (reachable.has(region.id)) {
  for (const edge of normalRegionTargets(region)) predecessors.get(edge.target)?.add(region.id);
 }
 const dominators = new Map([...reachable].map(id => [id, id === graph.entryRegionId ? new Set([id]) : new Set(reachable)]));
 let changed = true;
 while (changed) {
  changed = false;
  for (const id of reachable) {
   if (id === graph.entryRegionId) continue;
   const parents = [...(predecessors.get(id) ?? [])];
   const common = new Set(parents.length ? dominators.get(parents[0]!) : []);
   for (const parent of parents.slice(1)) for (const value of common) if (!dominators.get(parent)?.has(value)) common.delete(value);
   common.add(id);
   const previous = dominators.get(id)!;
   if (common.size !== previous.size || [...common].some(value => !previous.has(value))) { dominators.set(id, common); changed = true; }
  }
 }
 const loops = new Map<string, Set<string>>();
 for (const region of graph.regions) for (const edge of normalRegionTargets(region)) {
  if (!dominators.get(region.id)?.has(edge.target)) continue;
  const members = loops.get(edge.target) ?? new Set([edge.target]);
  const pending = [region.id];
  while (pending.length) {
   const id = pending.pop()!;
   if (members.has(id)) continue;
   members.add(id);
   for (const parent of predecessors.get(id) ?? []) pending.push(parent);
  }
  loops.set(edge.target, members);
 }
 const layouts = new Map<string, StructuredLoopLayout>();
 for (const [headerRegionId, members] of loops) {
  let current = headerRegionId;
  const visited = new Set<string>();
  while (!visited.has(current)) {
   visited.add(current);
   const region = byId.get(current);
   if (!region) break;
   const edges = normalRegionTargets(region);
   const yes = edges.find(edge => edge.kind === "branch-true"), no = edges.find(edge => edge.kind === "branch-false");
   if (edges.length === 2 && yes && no && members.has(yes.target) !== members.has(no.target)) {
    const continueWhenTrue = members.has(yes.target);
    layouts.set(current, { headerRegionId, loopTarget: continueWhenTrue ? yes.target : no.target, exitTarget: continueWhenTrue ? no.target : yes.target, continueWhenTrue });
    break;
   }
   if (edges.length !== 1 || !members.has(edges[0]!.target)) break;
   current = edges[0]!.target;
  }
 }
 return layouts;
}

`;
const after = before.replace("interface RegionFrameLayout {", repair + "interface RegionFrameLayout {");
writeFileSync(target + ".before", before); writeFileSync(target, after);
let patch = "";
try { patch = execFileSync("diff", ["-u", "--label", "a/" + relative, "--label", "b/" + relative, target + ".before", target], { encoding: "utf8" }); }
catch (error) { patch = String((error as { stdout?: unknown }).stdout ?? ""); }
if (!patch.includes("buildStructuredLoopLayouts")) throw new Error("Repair diff missing");
writeFileSync(join(evidence, "wip-natural-loop-repair.patch"), patch);
const rows = [];
for (const specimen of ["recurrence-1", "fixed-configuration-1", "independent-control-1", "independent-control-4", "pr7-declared-domain-probe", "wip-simple-loop-probe"]) for (const seed of [0, 1]) {
 try {
  const result = execFileSync(process.execPath, [resolve(import.meta.dir, "regional-baseline-worker.ts")], { input: JSON.stringify({ archive, specimen, seed, legacy: false }), timeout: 15000, maxBuffer: 4 * 1024 * 1024, encoding: "utf8" });
  rows.push({ specimen, seed, ...JSON.parse(result.trim().split("\n").at(-1)!) });
 } catch (error) { const failure = error as { code?: string; message?: string }; rows.push({ specimen, seed, status: failure.code === "ETIMEDOUT" ? "timeout-right-censored" : "worker-error", error: failure.message?.slice(0, 1000), resistanceCredit: false }); }
}
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const report = { schema: "ruam-wip-repair-experiment-v1", generatedAt: new Date().toISOString(), baseline: baseline.commit, archive, sourceSha256Before: sha(before), sourceSha256After: sha(after), patchSha256: sha(patch),
 limitations: ["Experimental replacement, not recovered original implementation. Only reducible natural loops with a linear prefix to the branch condition are recognized.", "Unrecognized loops retain existing fail-closed emitter behavior; this repair is not general loop/exception correctness qualification.", "Patch remains exclusively in isolated archive and evidence, not the shared product branch."], claimsDemonstratedSecurity: false, rows };
writeFileSync(join(evidence, "wip-repair-report.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ archive, rows: rows.map(row => ({ specimen: row.specimen, seed: row.seed, status: row.status, correctness: row.correctness?.status, error: row.error })) }, null, 2));
