/**
 * AST-level structural transforms for per-build variation.
 *
 * Applied after all builders produce their AST nodes but before the
 * emitter serializes to JS. Each transform is semantics-preserving
 * and driven by the per-build {@link StructuralChoices} PRNG.
 *
 * Transforms:
 * - **Declaration merging**: consecutive `var` statements → comma-chained
 * - **Expression noise**: `obj.x` ↔ `obj["x"]`, `f()` → `(0,f)()`,
 *   `a===b` → `!(a!==b)`, numeric literal variations
 * - **Member access variation**: dot notation ↔ bracket notation
 *
 * @module ruamvm/structural-transforms
 */

import type { JsNode, MemberExpr, BinOp, Literal, VarDecl } from "./nodes.js";
import type { StructuralChoices } from "../structural-choices.js";

// --- Public API ---

/**
 * Apply all structural transforms to a flat array of top-level nodes.
 *
 * Returns a new array (does not mutate the input). Deep-walks each node
 * to apply expression-level transforms, then applies statement-level
 * transforms (declaration merging) to the sequence.
 *
 * @param nodes - The top-level AST nodes from the assembler.
 * @param choices - Per-build structural variation choices.
 * @returns A transformed copy of the node array.
 */
export function applyStructuralTransforms(
	nodes: JsNode[],
	choices: StructuralChoices
): JsNode[] {
	// Phase 1: deep-walk each node for expression-level transforms
	let result = nodes.map((n) => walkNode(n, choices));

	// Phase 2: declaration style transform (statement-level)
	result = applyDeclarationTransform(result, choices);

	return result;
}

// --- Expression-level walk ---

/**
 * Recursively walk a node and apply expression-level transforms.
 * Returns a new node (shallow copy where needed).
 */
function walkNode(node: JsNode, ch: StructuralChoices): JsNode {
	switch (node.type) {
		// --- Expressions that can be transformed ---
		case "MemberExpr":
			return transformMember(node, ch);

		case "BinOp":
			return transformBinOp(node, ch);

		case "Literal":
			return transformLiteral(node, ch);

		case "CallExpr":
			return {
				...node,
				callee: walkNode(node.callee, ch),
				args: node.args.map((a) => walkNode(a, ch)),
			};

		// --- Containers: recurse into children ---
		case "VarDecl":
			return node.init
				? { ...node, init: walkNode(node.init, ch) }
				: node;
		case "ConstDecl":
			return node.init
				? { ...node, init: walkNode(node.init, ch) }
				: node;
		case "FnDecl":
			return { ...node, body: node.body.map((n) => walkNode(n, ch)) };
		case "ExprStmt":
			return { ...node, expr: walkNode(node.expr, ch) };
		case "Block":
			return { ...node, body: node.body.map((n) => walkNode(n, ch)) };
		case "IfStmt":
			return {
				...node,
				test: walkNode(node.test, ch),
				then: node.then.map((n) => walkNode(n, ch)),
				else: node.else?.map((n) => walkNode(n, ch)),
			};
		case "WhileStmt":
			return {
				...node,
				test: walkNode(node.test, ch),
				body: node.body.map((n) => walkNode(n, ch)),
			};
		case "ForStmt":
			return {
				...node,
				init: node.init ? walkNode(node.init, ch) : null,
				test: node.test ? walkNode(node.test, ch) : null,
				update: node.update ? walkNode(node.update, ch) : null,
				body: node.body.map((n) => walkNode(n, ch)),
			};
		case "ForInStmt":
			return {
				...node,
				obj: walkNode(node.obj, ch),
				body: node.body.map((n) => walkNode(n, ch)),
			};
		case "SwitchStmt":
			return {
				...node,
				disc: walkNode(node.disc, ch),
				cases: node.cases.map((c) => ({
					...c,
					label: c.label ? walkNode(c.label, ch) : null,
					body: c.body.map((n) => walkNode(n, ch)),
				})),
			};
		case "ReturnStmt":
			return node.value
				? { ...node, value: walkNode(node.value, ch) }
				: node;
		case "ThrowStmt":
			return { ...node, value: walkNode(node.value, ch) };
		case "TryCatchStmt":
			return {
				...node,
				body: node.body.map((n) => walkNode(n, ch)),
				handler: node.handler?.map((n) => walkNode(n, ch)),
				finalizer: node.finalizer?.map((n) => walkNode(n, ch)),
			};
		case "AssignExpr":
			return {
				...node,
				target: walkNode(node.target, ch),
				value: walkNode(node.value, ch),
			};
		case "IndexExpr":
			return {
				...node,
				obj: walkNode(node.obj, ch),
				index: walkNode(node.index, ch),
			};
		case "TernaryExpr":
			return {
				...node,
				test: walkNode(node.test, ch),
				then: walkNode(node.then, ch),
				else: walkNode(node.else, ch),
			};
		case "ArrayExpr":
			return {
				...node,
				elements: node.elements.map((e) => walkNode(e, ch)),
			};
		case "NewExpr":
			return {
				...node,
				callee: walkNode(node.callee, ch),
				args: node.args.map((a) => walkNode(a, ch)),
			};
		case "SequenceExpr":
			return {
				...node,
				exprs: node.exprs.map((e) => walkNode(e, ch)),
			};
		case "UnaryOp":
			return { ...node, expr: walkNode(node.expr, ch) };
		case "UpdateExpr":
			return { ...node, arg: walkNode(node.arg, ch) };
		case "AwaitExpr":
			return { ...node, expr: walkNode(node.expr, ch) };
		case "SpreadElement":
			return { ...node, arg: walkNode(node.arg, ch) };
		case "FnExpr":
			return { ...node, body: node.body.map((n) => walkNode(n, ch)) };
		case "ArrowFn":
			return { ...node, body: node.body.map((n) => walkNode(n, ch)) };
		case "StackPush":
			return { ...node, value: walkNode(node.value, ch) };

		// ObjectExpr has complex entries — skip deep-walking to avoid
		// breaking getter/setter/method/spread shapes
		case "ObjectExpr":
			return node;

		// Leaf nodes — no children to walk
		case "Id":
		case "BreakStmt":
		case "ContinueStmt":
		case "DebuggerStmt":
		case "StackPop":
		case "StackPeek":
		case "ImportExpr":
		case "CaseClause":
			return node;

		default:
			return node;
	}
}

// --- Member access: obj.prop → obj["prop"] ---

/** Safe property names that can be converted to bracket notation. */
const SAFE_BRACKET_RE = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;

function transformMember(node: MemberExpr, ch: StructuralChoices): JsNode {
	const obj = walkNode(node.obj, ch);
	// Only convert if the property name is a valid identifier
	if (
		SAFE_BRACKET_RE.test(node.prop) &&
		ch.prng() < ch.expressionNoise.dotToBracketBias
	) {
		// obj.prop → obj["prop"]
		return {
			type: "IndexExpr",
			obj,
			index: { type: "Literal", value: node.prop },
		};
	}
	return { ...node, obj };
}

// --- BinOp: a === b → !(a !== b) ---

function transformBinOp(node: BinOp, ch: StructuralChoices): JsNode {
	const left = walkNode(node.left, ch);
	const right = walkNode(node.right, ch);

	if (
		node.op === "===" &&
		ch.prng() < ch.expressionNoise.doubleNegationBias
	) {
		return {
			type: "UnaryOp",
			op: "!",
			expr: { type: "BinOp", op: "!==", left, right },
		};
	}
	if (
		node.op === "!==" &&
		ch.prng() < ch.expressionNoise.doubleNegationBias
	) {
		return {
			type: "UnaryOp",
			op: "!",
			expr: { type: "BinOp", op: "===", left, right },
		};
	}

	return { ...node, left, right };
}

// --- Numeric literal variation: 42 → 0x2a ---

function transformLiteral(node: Literal, ch: StructuralChoices): JsNode {
	if (
		typeof node.value !== "number" ||
		!Number.isInteger(node.value) ||
		node.value < 2 || // Don't transform 0, 1
		node.value > 0xffffff || // Don't transform huge numbers
		ch.prng() >= ch.expressionNoise.numericVariationBias
	) {
		return node;
	}

	const v = node.value;
	const roll = ch.prng();

	if (roll < 0.5) {
		// Hex representation: emit as a hex string literal that gets
		// parsed. We use IndexExpr trick: the number doesn't change,
		// just the source representation. Since our Literal emitter
		// outputs numbers as-is, we shift to a BinOp: (v|0)
		return {
			type: "BinOp",
			op: "|",
			left: { type: "Literal", value: v },
			right: { type: "Literal", value: 0 },
		};
	}
	// Computed: (v + offset - offset) where offset is small
	const offset = Math.floor(ch.prng() * 7) + 1;
	return {
		type: "BinOp",
		op: "-",
		left: {
			type: "BinOp",
			op: "+",
			left: { type: "Literal", value: v },
			right: { type: "Literal", value: offset },
		},
		right: { type: "Literal", value: offset },
	};
}

// --- Declaration style: merge/split consecutive var declarations ---

function applyDeclarationTransform(
	nodes: JsNode[],
	ch: StructuralChoices
): JsNode[] {
	if (ch.declarationStyle === "individual") return nodes;

	const result: JsNode[] = [];
	let i = 0;

	while (i < nodes.length) {
		const node = nodes[i]!;

		// Collect consecutive VarDecl nodes
		if (node.type === "VarDecl") {
			const group: VarDecl[] = [node];
			let j = i + 1;
			while (j < nodes.length && nodes[j]!.type === "VarDecl") {
				group.push(nodes[j] as VarDecl);
				j++;
			}

			if (group.length > 1) {
				if (ch.declarationStyle === "chained") {
					// Merge all into one chained VarDecl group
					result.push({
						type: "VarDecl",
						name: "__chain__",
						init: undefined,
						_chain: group,
					} as VarDecl & { _chain: VarDecl[] });
				} else {
					// "mixed": randomly group 1-4 consecutive declarations
					let k = 0;
					while (k < group.length) {
						const size = Math.min(
							Math.floor(ch.prng() * 4) + 1,
							group.length - k
						);
						if (size === 1) {
							result.push(group[k]!);
						} else {
							result.push({
								type: "VarDecl",
								name: "__chain__",
								init: undefined,
								_chain: group.slice(k, k + size),
							} as VarDecl & { _chain: VarDecl[] });
						}
						k += size;
					}
				}
			} else {
				result.push(node);
			}
			i = j;
		} else {
			result.push(node);
			i++;
		}
	}

	return result;
}
