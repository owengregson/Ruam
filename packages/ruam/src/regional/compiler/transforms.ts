/** Small proof-checked transformation recipes; never a general SSA claim.
 * @module regional/compiler/transforms
 */
import type { NodePath } from "@babel/traverse";
import * as t from "@babel/types";
import { traverse } from "../../babel-compat.js";
import { closedExpression, inventory, primitiveResult, staticKey, substitute } from "./analysis.js";
import type { RegionalCompileReport, RegionalWitness } from "./types.js";

export interface TransformContext {
	report: RegionalCompileReport;
	name: () => string;
	transformed: Set<t.Node>;
}

/** Preserve parsed directives without turning residual string expressions into new ones. */
export function preserveDirectiveBoundaries(ast: t.File): void {
	const protect = (body: t.Statement[]): void => {
		const first = body[0];
		if (t.isExpressionStatement(first) && t.isStringLiteral(first.expression)) {
			// The added zero is effect-free and the completion value is still the
			// original string. This also covers a removed declaration exposing an
			// existing non-directive string at the beginning of a function body.
			first.expression = t.sequenceExpression([t.numericLiteral(0), first.expression]);
		}
	};
	protect(ast.program.body);
	traverse(ast, { Function(path) {
		if (t.isBlockStatement(path.node.body)) protect(path.node.body.body);
	} });
}

function witness(context: TransformContext, node: t.Node, kind: RegionalWitness["kind"], preconditions: string[], detail: string): void {
	for (const child of inventory(node, 100_000)) context.transformed.add(child);
	context.report.witnesses.push({ kind, sourceStart: node.start ?? 0, sourceEnd: node.end ?? 0, preconditions, validation: "checked-fixed-recipe", detail });
}

/** Inline only private nested expression helpers with primitive actual arguments. */
export function fusePrivateCalls(ast: t.File, context: TransformContext): void {
	// Babel lexical bindings do not model the extra outer var assignment that
	// legacy sloppy block/conditional functions can perform under Annex B.
	const annexBNames = new Map<t.Node, Set<string>>();
	traverse(ast, { FunctionDeclaration(path) {
		if (!path.node.id || path.parentPath.isProgram() ||
			(path.parentPath.isBlockStatement() && path.parentPath.parentPath.isFunction())) return;
		const owner = path.getFunctionParent();
		if (!owner) return;
		const names = annexBNames.get(owner.node) ?? new Set<string>();
		names.add(path.node.id.name);
		annexBNames.set(owner.node, names);
	} });
	traverse(ast, {
		FunctionDeclaration: {
			exit(path) {
				const fn = path.node;
				// Top-level script bindings can be observed by subsequent scripts.
				if (!path.parentPath.isBlockStatement() || !path.parentPath.parentPath.isFunction()) return;
				if (!fn.id || fn.params.some(param => !t.isIdentifier(param))) return;
				if (annexBNames.get(path.parentPath.parentPath.node)?.has(fn.id.name)) return;
				const params = fn.params as t.Identifier[];
				const names = new Set(params.map(param => param.name));
				if (names.size !== params.length || fn.body.body.length !== 1) return;
				const ret = fn.body.body[0];
				if (!t.isReturnStatement(ret) || !ret.argument || !closedExpression(ret.argument, names)) return;
				if (inventory(ret.argument, 100_000).length > 64) return;
				const binding = path.parentPath.scope.getBinding(fn.id.name);
				if (!binding?.constant || binding.referencePaths.length === 0 || binding.referencePaths.length > 16) return;
				const calls: NodePath<t.CallExpression>[] = [];
				for (const reference of binding.referencePaths) {
					const call = reference.parentPath;
					if (!call?.isCallExpression() || reference.key !== "callee" || call.node.optional || call.node.arguments.length !== params.length) return;
					const owner = call.getFunctionParent();
					if (!owner || !t.isBlockStatement(owner.node.body)) return;
					// Parameters run before body lexical bindings exist. Class fields also
					// have implicit, independently reentrant activations not represented by
					// getFunctionParent(); their temporaries cannot live in the outer body.
					let enclosing: NodePath | null = call;
					while (enclosing && enclosing.node !== owner.node.body) {
						if (enclosing === owner || enclosing.isClass()) return;
						enclosing = enclosing.parentPath;
					}
					if (!enclosing) return;
					const args = call.get("arguments");
					if (args.some(arg => !arg.isExpression() || !primitiveResult(arg))) return;
					calls.push(call);
				}
				for (const call of calls) {
					const temporaries = params.map(() => t.identifier(context.name()));
					const replacement = substitute(ret.argument, new Map(params.map((param, index) => [param.name, temporaries[index]!] as const)));
					const assignments = temporaries.map((temporary, index) => t.assignmentExpression("=", t.cloneNode(temporary), t.cloneNode(call.node.arguments[index] as t.Expression, true)));
					witness(context, call.node, "private-call-fusion", ["private immutable direct-call binding", "primitive actual values", "single return without captures or effects", "arguments evaluated once left-to-right", "activation-local temporaries"], `Inlined ${fn.id.name} into its consumer.`);
					const owner = call.getFunctionParent()!;
					const body = owner.get("body") as NodePath<t.BlockStatement>;
					if (temporaries.length) body.unshiftContainer("body", t.variableDeclaration("let", temporaries.map(id => t.variableDeclarator(t.cloneNode(id)))));
					call.replaceWith(assignments.length ? t.sequenceExpression([...assignments, replacement]) : replacement);
					context.report.transformations.privateCallFusions++;
				}
				path.remove();
			},
		},
	});
}

function immutableLiteral(node: t.Node | null | undefined): node is t.Expression {
	return Boolean(node && (t.isStringLiteral(node) || t.isNumericLiteral(node) || t.isBooleanLiteral(node) || t.isNullLiteral(node) || t.isBigIntLiteral(node) ||
		(t.isUnaryExpression(node, { operator: "-" }) && (t.isNumericLiteral(node.argument) || t.isBigIntLiteral(node.argument)))));
}

/** Remove only private, nonescaping own-data tables whose reads are dominated. */
export function specializeConfiguration(ast: t.File, context: TransformContext): void {
	traverse(ast, {
		VariableDeclarator(path) {
			if (!t.isIdentifier(path.node.id) || !path.parentPath.isVariableDeclaration({ kind: "const" })) return;
			const declaration = path.parentPath;
			const body = declaration.parentPath;
			if (!body.isBlockStatement() || !body.parentPath.isFunction()) return;
			const binding = path.scope.getBinding(path.node.id.name);
			if (!binding?.constant || !binding.referencePaths.length) return;
			const values = new Map<string, t.Expression>();
			const init = path.node.init;
			if (t.isObjectExpression(init)) {
				for (const property of init.properties) {
					if (!t.isObjectProperty(property) || property.computed || !immutableLiteral(property.value)) return;
					const key = t.isIdentifier(property.key) ? property.key.name :
						(t.isStringLiteral(property.key) || t.isNumericLiteral(property.key)) ? String(property.key.value) : null;
					if (key === null || key === "__proto__" || values.has(key)) return;
					values.set(key, property.value);
				}
			} else if (t.isArrayExpression(init)) {
				for (let index = 0; index < init.elements.length; index++) {
					const element = init.elements[index];
					if (!immutableLiteral(element)) return;
					values.set(String(index), element);
				}
				values.set("length", t.numericLiteral(init.elements.length));
			} else return;
			const reads: { path: NodePath<t.MemberExpression>; value: t.Expression }[] = [];
			for (const reference of binding.referencePaths) {
				const member = reference.parentPath;
				if (!member?.isMemberExpression() || reference.key !== "object") return;
				const key = staticKey(member.node);
				if (key === null || !values.has(key)) return;
				if (member.parentPath.isAssignmentExpression() && member.key === "left") return;
				if (member.parentPath.isUpdateExpression() || member.parentPath.isUnaryExpression({ operator: "delete" }) || member.parentPath.isForXStatement()) return;
				// Same activation and a later direct body statement: nested closures may run before initialization.
				if (reference.getFunctionParent() !== body.parentPath) return;
				let statement: NodePath = member;
				while (statement.parentPath && statement.parentPath !== body) statement = statement.parentPath;
				if (statement.parentPath !== body || typeof statement.key !== "number" || typeof declaration.key !== "number" || statement.key <= declaration.key) return;
				// A member inside a destructuring assignment is not necessarily a read.
				if (member.findParent(parent => parent.isAssignmentPattern() || parent.isObjectPattern() || parent.isArrayPattern())) return;
				reads.push({ path: member, value: values.get(key)! });
			}
			witness(context, path.node, "configuration-specialization", ["private const own-data literal", "all references are known own-property reads", "no escape or identity observation", "same-activation initialization dominance"], `Residualized ${reads.length} table reads; no evaluator or table identity escapes.`);
			for (const read of reads) {
				read.path.replaceWith(t.cloneNode(read.value, true));
				context.report.transformations.configurationReads++;
			}
			path.remove();
		},
	});
}

function branchValue(node: t.Statement, name: string): t.Expression | null {
	const statement = t.isBlockStatement(node) && node.body.length === 1 ? node.body[0] : node;
	if (!t.isExpressionStatement(statement) || !t.isAssignmentExpression(statement.expression, { operator: "=" }) || !t.isIdentifier(statement.expression.left, { name })) return null;
	return statement.expression.right;
}

/** A Number on normal completion, including operators that reject BigInt. */
function numberResult(node: t.Node, numberNames: ReadonlySet<string>): boolean {
	if (t.isNumericLiteral(node) || t.isIdentifier(node) && numberNames.has(node.name)) return true;
	if (t.isUnaryExpression(node)) {
		if (node.operator === "+") return true;
		return ["-", "~"].includes(node.operator) && numberResult(node.argument, numberNames);
	}
	if (t.isBinaryExpression(node)) {
		if (node.operator === ">>>") return true;
		if (!["+", "-", "*", "/", "%", "**", "|", "&", "^", "<<", ">>"].includes(node.operator)) return false;
		// + can concatenate with strings. The other numeric operators reject
		// mixed Number/BigInt operands, so one Number operand suffices.
		return node.operator === "+"
			? numberResult(node.left, numberNames) && numberResult(node.right, numberNames)
			: numberResult(node.left, numberNames) || numberResult(node.right, numberNames);
	}
	return false;
}

function int32Result(node: t.Node | null | undefined, numberNames: ReadonlySet<string> = new Set()): boolean {
	return Boolean(node && numberResult(node, numberNames) &&
		(t.isBinaryExpression(node) && ["|", "&", "^", "<<", ">>", ">>>"].includes(node.operator) || t.isUnaryExpression(node, { operator: "~" })));
}

/** Fuse a private integer branch update into its terminal result, without eager arms. */
export function realizeDependentRegions(ast: t.File, context: TransformContext): void {
	traverse(ast, {
		Function(path) {
			if (!t.isBlockStatement(path.node.body)) return;
			const body = path.get("body") as NodePath<t.BlockStatement>;
			const statements = body.get("body");
			if (statements.length < 3) return;
			const last = statements[statements.length - 1]!;
			const branch = statements[statements.length - 2]!;
			if (!last.isReturnStatement() || !last.node.argument || !branch.isIfStatement() || !branch.node.alternate) return;
			for (const declaration of statements.slice(0, -2)) {
				if (!declaration.isVariableDeclaration() || declaration.node.kind !== "let" || declaration.node.declarations.length !== 1) continue;
				const declarator = declaration.node.declarations[0]!;
				if (!t.isIdentifier(declarator.id) || !int32Result(declarator.init)) continue;
				const name = declarator.id.name;
				const binding = path.scope.getBinding(name);
				if (!binding) continue;
				const left = branchValue(branch.node.consequent, name);
				const right = branchValue(branch.node.alternate, name);
				const names = new Set([name]);
				if (!left || !right || !int32Result(left, names) || !int32Result(right, names)) continue;
				if (![branch.node.test, left, right, last.node.argument].every(node => closedExpression(node, names, true))) continue;
				const inside = (reference: NodePath): boolean => Boolean(reference.findParent(parent => parent === branch || parent === last));
				if (binding.referencePaths.some(reference => !inside(reference)) || binding.constantViolations.length !== 2 || binding.constantViolations.some(reference => !inside(reference))) continue;
				const consequent = substitute(last.node.argument, new Map([[name, left]]));
				const alternate = substitute(last.node.argument, new Map([[name, right]]));
				const result = t.conditionalExpression(t.cloneNode(branch.node.test, true), consequent, alternate);
				if (inventory(result, 100_000).length > 128) continue;
				witness(context, branch.node, "dependent-predicate-result", ["unconditional authored integer coercion", "private state with exactly two branch writes", "all uses inside branch/result", "primitive total expressions", "lazy selected arm only", "terminal function result"], "Composed branch state transitions into the final consumer; eliminated intermediate assignments.");
				context.report.analysis.domainFacts.push(`${name}: Number int32/uint32 on normal completion of authored coercion; no intervening writes except the two qualified branch updates`);
				last.get("argument").replaceWith(result);
				branch.remove();
				context.report.transformations.jointRegions++;
				break;
			}
		},
	});
}
