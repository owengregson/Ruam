/**
 * External key binding builder (off-device necessary secret).
 *
 * Emits the runtime fold that reads a secret string from a host-provided
 * accessor, hashes it with FNV-1a, and XORs the result into the key anchor
 * (`_ka`) — the same seam the integrity hash and cohort term use. Because the
 * build side folds `fnv1a(secretValue)` into the key anchor while embedding
 * ONLY the accessor path (never the secret), the artifact cannot derive its
 * decryption key without the correct runtime secret.
 *
 * No `eval` / `new Function`: the accessor is emitted as plain member access.
 * The read is wrapped in try/catch so a missing/undefined secret yields a wrong
 * key (garbage, the intended denial) rather than a crash.
 *
 * Build/runtime symmetry: the runtime FNV uses the standard FNV constants
 * (NOT the watermarked offset basis), matching the build-time `fnv1a` over the
 * secret value. See {@link ../../compiler/external-key}.
 *
 * @module ruamvm/builders/external-key
 */

import type { JsNode } from "../nodes.js";
import type { RuntimeNames } from "../../naming/compat-types.js";
import type { SplitFn } from "../constant-splitting.js";
import {
	assign,
	bin,
	call,
	exprStmt,
	forStmt,
	id,
	lit,
	member,
	tryCatch,
	update,
	varDecl,
	BOp,
	UpOp,
} from "../nodes.js";
import { FNV_OFFSET_BASIS, FNV_PRIME } from "../../constants.js";

const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Build a member-access AST from a dotted property path rooted at a global.
 *
 * @param accessor - e.g. `"globalThis.__RUAM_KEY"` or `"self.k.sub"`.
 * @returns The member-access expression AST.
 * @throws If any path segment is not a valid identifier (build-time dev gate).
 */
export function buildAccessorExpr(accessor: string): JsNode {
	const segments = accessor.split(".").map((s) => s.trim());
	if (segments.length === 0 || segments.some((s) => !IDENT_RE.test(s))) {
		throw new Error(
			`externalKeyBinding.accessor must be a dotted path of identifiers ` +
				`rooted at a global (e.g. "globalThis.__RUAM_KEY"); got: ${JSON.stringify(
					accessor
				)}`
		);
	}
	let expr: JsNode = id(segments[0]!);
	for (let i = 1; i < segments.length; i++) {
		expr = member(expr, segments[i]!);
	}
	return expr;
}

/**
 * Build the external-key fold statements (to append after the key-anchor init).
 *
 * @param names    Runtime identifier mapping (for `keyAnchor` and `imul`).
 * @param accessor Dotted property path where the runtime reads the secret.
 * @param nameGen  On-demand collision-free name generator (NameRegistry).
 * @param split    Optional constant splitter for numeric obfuscation.
 * @returns AST nodes that fold `fnv1a(String(accessor))` into the key anchor.
 */
export function buildExternalKeyFold(
	names: RuntimeNames,
	accessor: string,
	nameGen: () => string,
	split?: SplitFn
): JsNode[] {
	const L = (v: number): JsNode => (split ? split(v) : lit(v));
	const ekv = nameGen(); // coerced secret string
	const ekh = nameGen(); // FNV accumulator
	const eki = nameGen(); // loop index

	const accessorExpr = buildAccessorExpr(accessor);

	return [
		// var <ekv> = '';
		varDecl(ekv, lit("")),
		// try { <ekv> = '' + (<accessor>); } catch (e) {}
		tryCatch(
			[
				exprStmt(
					assign(id(ekv), bin(BOp.Add, lit(""), accessorExpr))
				),
			],
			"_eke",
			[]
		),
		// var <ekh> = FNV_OFFSET_BASIS;
		varDecl(ekh, L(FNV_OFFSET_BASIS >>> 0)),
		// for (var <eki> = 0; <eki> < <ekv>.length; <eki>++)
		//   <ekh> = imul(<ekh> ^ <ekv>.charCodeAt(<eki>), FNV_PRIME) >>> 0;
		forStmt(
			varDecl(eki, lit(0)),
			bin(BOp.Lt, id(eki), member(id(ekv), "length")),
			update(UpOp.Inc, false, id(eki)),
			[
				exprStmt(
					assign(
						id(ekh),
						bin(
							BOp.Ushr,
							call(id(names.imul), [
								bin(
									BOp.BitXor,
									id(ekh),
									call(member(id(ekv), "charCodeAt"), [
										id(eki),
									])
								),
								L(FNV_PRIME),
							]),
							lit(0)
						)
					)
				),
			]
		),
		// <keyAnchor> = (<keyAnchor> ^ <ekh>) >>> 0;
		exprStmt(
			assign(
				id(names.keyAnchor),
				bin(
					BOp.Ushr,
					bin(BOp.BitXor, id(names.keyAnchor), id(ekh)),
					lit(0)
				)
			)
		),
	];
}
