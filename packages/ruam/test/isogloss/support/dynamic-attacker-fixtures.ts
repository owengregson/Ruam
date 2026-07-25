/**
 * Small, versioned corpus for measuring dynamic semantic recovery.
 *
 * Fixtures deliberately return their host-visible effects as data. That keeps
 * the baseline deterministic while still exercising property access, calls,
 * throws, catches, and finally ordering in the current executor.
 */

export const DYNAMIC_ATTACKER_CORPUS_VERSION = 1 as const;

export type DynamicFixtureCategory =
	| "pure"
	| "control"
	| "call"
	| "property-effect"
	| "exception";

export interface DynamicAttackerFixture {
	schemaVersion: typeof DYNAMIC_ATTACKER_CORPUS_VERSION;
	id: string;
	categories: readonly DynamicFixtureCategory[];
	source: string;
	expected: unknown;
}

export const DYNAMIC_ATTACKER_FIXTURES: readonly DynamicAttackerFixture[] =
	Object.freeze([
		{
			schemaVersion: DYNAMIC_ATTACKER_CORPUS_VERSION,
			id: "pure-arithmetic-control",
			categories: ["pure", "control"],
			source: `
				function score(input) {
					var total = input < 0 ? -input : input + 3;
					for (var i = 0; i < 3; i++) {
						total = total * 2 - i;
					}
					return total > 30 ? total - 5 : total + 7;
				}
				[score(5), score(-2)];
			`,
			expected: [55, 19],
		},
		{
			schemaVersion: DYNAMIC_ATTACKER_CORPUS_VERSION,
			id: "direct-calls",
			categories: ["pure", "control", "call"],
			source: `
				function adjust(value, bias) {
					return value * 3 + bias;
				}
				function combine(left, right) {
					var first = adjust(left, 2);
					var second = adjust(right, -1);
					return first > second ? first - second : first + second;
				}
				[combine(7, 4), combine(2, 9)];
			`,
			expected: [12, 34],
		},
		{
			schemaVersion: DYNAMIC_ATTACKER_CORPUS_VERSION,
			id: "object-property-effects",
			categories: ["call", "property-effect"],
			source: `
				function mutate(record, delta, events) {
					var before = record.value;
					record.value = before + delta;
					events.push("set:" + record.value);
					return record.value;
				}
				var effects = [];
				var target = { value: 4 };
				var result = mutate(target, 6, effects);
				[result, target.value, effects];
			`,
			expected: [10, 10, ["set:10"]],
		},
		{
			schemaVersion: DYNAMIC_ATTACKER_CORPUS_VERSION,
			id: "exceptions-and-finally",
			categories: ["control", "call", "property-effect", "exception"],
			source: `
				function guarded(value, events) {
					try {
						events.push("try:" + value);
						if (value < 0) throw new RangeError("negative");
						return value * 2;
					} catch (error) {
						events.push("catch:" + error.message);
						return 11;
					} finally {
						events.push("finally:" + value);
					}
				}
				var effects = [];
				var results = [guarded(3, effects), guarded(-1, effects)];
				[results, effects];
			`,
			expected: [
				[6, 11],
				["try:3", "finally:3", "try:-1", "catch:negative", "finally:-1"],
			],
		},
	]);
