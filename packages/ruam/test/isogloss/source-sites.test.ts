import { describe, expect, it } from "bun:test";
import { parse } from "@babel/parser";
import { BABEL_PARSER_PLUGINS } from "../../src/constants.js";
import { discoverSourcePureRegions } from "../../src/isogloss/source-sites.js";

function parseFile(source: string) {
	return parse(source, {
		sourceType: "unambiguous",
		plugins: [...BABEL_PARSER_PLUGINS],
	});
}

describe("source Isogloss region discovery", () => {
	it("discovers deterministic root returns with local binding proof", () => {
		const source = `
			function first(x, y) {
				const z = x * y;
				return z + (x - 1);
			}
			const second = (flag, other) => flag && !other;
		`;
		const options = {
			targetMode: "root" as const,
			threshold: 1,
			seed: 44,
			regionDomains: {
				first: {
					x: { type: "number" as const, min: 1, max: 20 },
					y: { type: "number" as const, min: 1, max: 20 },
					z: { type: "number" as const, min: 1, max: 400 },
				},
				second: {
					flag: { type: "boolean" as const },
					other: { type: "boolean" as const },
				},
			},
		};
		const first = discoverSourcePureRegions(parseFile(source), options);
		const second = discoverSourcePureRegions(parseFile(source), options);

		expect(
			second.sites.map((site) => ({
				id: site.id,
				functionName: site.functionName,
				ordinal: site.ordinal,
				contract: site.region.contract,
				origin: site.origin,
			}))
		).toEqual(
			first.sites.map((site) => ({
				id: site.id,
				functionName: site.functionName,
				ordinal: site.ordinal,
				contract: site.region.contract,
				origin: site.origin,
			}))
		);
		expect(second.diagnostics).toEqual(first.diagnostics);
		expect(first.diagnostics).toEqual([]);
		expect(first.sites.map((site) => site.functionName)).toEqual([
			"first",
			"second",
		]);
		expect(first.sites[0]!.region.ingress.map((input) => input.name)).toEqual([
			"z",
			"x",
		]);
		expect(first.sites[1]!.region.outputType).toBe("boolean");
	});

	it("does not treat a global identifier as a guarded local", () => {
		const discovery = discoverSourcePureRegions(
			parseFile(`function target(x) { return x + globalValue; }`),
			{
				targetMode: "root",
				threshold: 1,
				seed: 1,
				regionDomains: {
					target: {
						x: { type: "number", min: 0, max: 10 },
						globalValue: {
							type: "number",
							min: 0,
							max: 10,
						},
					},
				},
			}
		);

		expect(discovery.sites).toEqual([]);
		expect(discovery.diagnostics).toEqual([
			expect.objectContaining({
				code: "RUAM_SOURCE_REGION_REJECTED",
				functionName: "target",
				rejection: {
					code: "RUAM_SOURCE_REGION_UNBOUND_IDENTIFIER",
					detail: "globalValue",
				},
			}),
		]);
	});

	it("uses only the new comment marker and skips nested functions in root mode", () => {
		const source = `
			/* ruam:vm */
			function oldMarker(x) { return x + 1; }
			/* ruam:isogloss */
			function marked(x) {
				function nested(y) { return y + 2; }
				return x + 1;
			}
		`;
		const regionDomains = {
			oldMarker: { x: { type: "number" as const, min: 1, max: 9 } },
			marked: { x: { type: "number" as const, min: 1, max: 9 } },
			nested: { y: { type: "number" as const, min: 1, max: 9 } },
		};
		const comment = discoverSourcePureRegions(parseFile(source), {
			targetMode: "comment",
			threshold: 1,
			seed: 2,
			regionDomains,
		});
		const root = discoverSourcePureRegions(parseFile(source), {
			targetMode: "root",
			threshold: 1,
			seed: 2,
			regionDomains,
		});

		expect(comment.sites.map((site) => site.functionName)).toEqual([
			"marked",
		]);
		expect(root.sites.map((site) => site.functionName)).toEqual([
			"oldMarker",
			"marked",
		]);
	});

	it("records missing domains, small regions, and deterministic threshold skips", () => {
		const source = `
			function missing(x) { return x + 1; }
			function tiny(x) { return x; }
			function selected(x) { return (x + 1) * 2; }
		`;
		const none = discoverSourcePureRegions(parseFile(source), {
			targetMode: "root",
			threshold: 0,
			seed: 5,
			regionDomains: {
				tiny: { x: { type: "number", min: 1, max: 5 } },
				selected: { x: { type: "number", min: 1, max: 5 } },
			},
		});

		expect(none.sites).toEqual([]);
		expect(none.diagnostics.map((item) => item.code)).toEqual([
			"RUAM_SOURCE_TARGET_MISSING_DOMAINS",
			"RUAM_SOURCE_TARGET_THRESHOLD_SKIPPED",
			"RUAM_SOURCE_TARGET_THRESHOLD_SKIPPED",
		]);
		expect(() =>
			discoverSourcePureRegions(parseFile(source), {
				targetMode: "root",
				threshold: 2,
				seed: 5,
				regionDomains: {},
			})
		).toThrow("RUAM_SOURCE_DISCOVERY_INVALID_THRESHOLD");
	});
});
