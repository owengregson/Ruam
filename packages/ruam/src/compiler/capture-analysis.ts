/**
 * Capture analysis — determines which variables are referenced by nested
 * functions (closures) and therefore must remain in the scope chain.
 *
 * Variables that are NOT captured can be safely promoted to registers,
 * eliminating expensive scope chain walks at runtime.
 *
 * @module compiler/capture-analysis
 */

import type { NodePath } from "@babel/traverse";
import type * as t from "@babel/types";

/**
 * Information about a variable binding for register promotion decisions.
 */
export interface VarInfo {
	/** The variable name. */
	name: string;
	/** Whether this variable is captured by any nested function. */
	isCaptured: boolean;
	/** The assigned register index (set during compilation if promoted). */
	register: number;
	/** Declaration kind. */
	kind: "var" | "let" | "const" | "param";
}

/**
 * Result of capture analysis for a single function.
 */
export interface CaptureAnalysisResult {
	/** Map from variable name to its capture info. */
	vars: Map<string, VarInfo>;
	/** Names that are captured and MUST stay in the scope chain. */
	capturedNames: Set<string>;
	/** Names that are NOT captured and CAN be register-promoted. */
	promotableNames: Set<string>;
	/** Whether the function contains `eval()` or `with` (forces all vars to scope chain). */
	hasDynamicScope: boolean;
}

/**
 * Analyze a function to determine which variables can be register-promoted.
 *
 * Algorithm:
 * 1. Collect all variable declarations in the function body (not nested functions)
 * 2. Walk all nested function bodies and collect their free variables
 * 3. Variables referenced by nested functions are "captured" → must stay in scope chain
 * 4. Everything else can be promoted to registers
 */
export function analyzeCapturedVars(
	fnPath: NodePath<t.Function>
): CaptureAnalysisResult {
	const vars = new Map<string, VarInfo>();
	const capturedNames = new Set<string>();
	const promotableNames = new Set<string>();

	// Check for eval/with which force all vars into scope chain
	let hasDynamicScope = false;

	const bodyPath = fnPath.get("body");
	if (!bodyPath.isBlockStatement()) {
		// Arrow with expression body — no declarations possible, nothing to promote
		return { vars, capturedNames, promotableNames, hasDynamicScope };
	}

	// Phase 1: Collect all declared variable names in this function (non-nested)
	const params = fnPath.get("params") as NodePath<t.LVal>[];
	for (let i = 0; i < params.length; i++) {
		const param = params[i]!;
		collectParamNames(param, vars, i);
	}

	// Walk the body to find all var/let/const declarations (skip nested functions)
	// Also detect names declared multiple times (let/const shadowing) — these
	// cannot be register-promoted because they need runtime scope isolation.
	const shadowedNames = new Set<string>();
	collectDeclarations(bodyPath, vars, shadowedNames);

	// Phase 2: Check for eval() or with statements (forces dynamic scope)
	hasDynamicScope = checkDynamicScope(bodyPath);

	if (hasDynamicScope) {
		// All vars must stay in scope chain
		for (const [name, info] of vars) {
			info.isCaptured = true;
			capturedNames.add(name);
		}
		return { vars, capturedNames, promotableNames, hasDynamicScope };
	}

	// Phase 3: Walk nested functions and collect their free variables
	const nestedFreeVars = new Set<string>();
	collectNestedFreeVars(bodyPath, vars, nestedFreeVars);

	// Phase 4: Classify each variable
	for (const [name, info] of vars) {
		if (nestedFreeVars.has(name) || shadowedNames.has(name)) {
			info.isCaptured = true;
			capturedNames.add(name);
		} else {
			info.isCaptured = false;
			promotableNames.add(name);
		}
	}

	return { vars, capturedNames, promotableNames, hasDynamicScope };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function collectParamNames(
	param: NodePath<t.LVal>,
	vars: Map<string, VarInfo>,
	argIndex: number
): void {
	if (param.isIdentifier()) {
		vars.set(param.node.name, {
			name: param.node.name,
			isCaptured: false,
			register: -1,
			kind: "param",
		});
	} else if (param.isAssignmentPattern()) {
		const left = param.get("left");
		if (left.isIdentifier()) {
			vars.set(left.node.name, {
				name: left.node.name,
				isCaptured: false,
				register: -1,
				kind: "param",
			});
		} else {
			collectPatternNames(left, vars, "param");
		}
	} else if (param.isRestElement()) {
		const arg = param.get("argument");
		if (arg.isIdentifier()) {
			vars.set(arg.node.name, {
				name: arg.node.name,
				isCaptured: false,
				register: -1,
				kind: "param",
			});
		}
	} else if (param.isArrayPattern() || param.isObjectPattern()) {
		collectPatternNames(param, vars, "param");
	}
}

function collectPatternNames(
	pattern: NodePath<t.LVal>,
	vars: Map<string, VarInfo>,
	kind: VarInfo["kind"]
): void {
	if (pattern.isIdentifier()) {
		vars.set(pattern.node.name, {
			name: pattern.node.name,
			isCaptured: false,
			register: -1,
			kind,
		});
	} else if (pattern.isArrayPattern()) {
		for (const elem of pattern.get("elements")) {
			if (elem.node !== null) {
				if (elem.isRestElement()) {
					collectPatternNames(
						elem.get("argument") as NodePath<t.LVal>,
						vars,
						kind
					);
				} else {
					collectPatternNames(elem as NodePath<t.LVal>, vars, kind);
				}
			}
		}
	} else if (pattern.isObjectPattern()) {
		for (const prop of pattern.get("properties")) {
			if (prop.isObjectProperty()) {
				collectPatternNames(
					prop.get("value") as NodePath<t.LVal>,
					vars,
					kind
				);
			} else if (prop.isRestElement()) {
				collectPatternNames(
					prop.get("argument") as NodePath<t.LVal>,
					vars,
					kind
				);
			}
		}
	} else if (pattern.isAssignmentPattern()) {
		collectPatternNames(
			pattern.get("left") as NodePath<t.LVal>,
			vars,
			kind
		);
	}
}

function collectDeclarations(
	bodyPath: NodePath<t.BlockStatement>,
	vars: Map<string, VarInfo>,
	shadowedNames: Set<string>
): void {
	bodyPath.traverse({
		VariableDeclaration(path) {
			// Skip declarations inside nested functions
			if (isInsideNestedFunction(path, bodyPath)) return;

			const kind = path.node.kind as "var" | "let" | "const";
			for (const declarator of path.get("declarations")) {
				const id = declarator.get("id");
				if (id.isIdentifier()) {
					if (vars.has(id.node.name)) {
						// Same name declared again — block-scope shadowing.
						// Both must use scope chain (no register promotion).
						shadowedNames.add(id.node.name);
					} else {
						vars.set(id.node.name, {
							name: id.node.name,
							isCaptured: false,
							register: -1,
							kind,
						});
					}
				} else {
					collectPatternNames(id as NodePath<t.LVal>, vars, kind);
				}
			}
		},
		FunctionDeclaration(path) {
			// Skip declarations inside nested functions
			if (isInsideNestedFunction(path, bodyPath)) return;

			if (path.node.id) {
				if (!vars.has(path.node.id.name)) {
					vars.set(path.node.id.name, {
						name: path.node.id.name,
						isCaptured: false,
						register: -1,
						kind: "var",
					});
				}
			}
		},
	});
}

function checkDynamicScope(bodyPath: NodePath<t.BlockStatement>): boolean {
	let hasDynamic = false;
	bodyPath.traverse({
		CallExpression(path) {
			if (isInsideNestedFunction(path, bodyPath)) return;
			const callee = path.get("callee");
			if (callee.isIdentifier() && callee.node.name === "eval") {
				hasDynamic = true;
				path.stop();
			}
		},
		WithStatement(path) {
			if (isInsideNestedFunction(path, bodyPath)) return;
			hasDynamic = true;
			path.stop();
		},
	});
	return hasDynamic;
}

function collectNestedFreeVars(
	bodyPath: NodePath<t.BlockStatement>,
	outerVars: Map<string, VarInfo>,
	freeVars: Set<string>
): void {
	bodyPath.traverse({
		"FunctionDeclaration|FunctionExpression|ArrowFunctionExpression|ObjectMethod|ClassMethod"(
			path: NodePath
		) {
			// Only handle direct children (nested functions), not deeply nested
			if (isInsideNestedFunction(path, bodyPath)) {
				// This is inside an already-nested function. Skip — the outer nested
				// function's traversal will handle it.
				// But we need to check if THIS path's parent function is bodyPath's function.
				// Actually, we want ALL nested functions at any depth.
			}

			// Collect all identifiers referenced inside this nested function
			const locallyDeclared = new Set<string>();

			// Collect this function's own declarations
			const fnNode = path.node as t.Function;
			if (fnNode.params) {
				for (const p of fnNode.params) {
					collectNodeNames(p, locallyDeclared);
				}
			}

			const innerBody = path.get("body") as NodePath;
			if (innerBody.isBlockStatement()) {
				innerBody.traverse({
					VariableDeclaration(
						vpath: NodePath<t.VariableDeclaration>
					) {
						for (const d of vpath.get("declarations")) {
							const id = d.node.id;
							collectNodeNames(id, locallyDeclared);
						}
					},
					FunctionDeclaration(
						fpath: NodePath<t.FunctionDeclaration>
					) {
						if (fpath.node.id)
							locallyDeclared.add(fpath.node.id.name);
					},
				});
			}

			// Now find all identifier references in the nested function
			path.traverse({
				Identifier(idPath) {
					const name = idPath.node.name;
					// Skip if it's not a variable reference
					if (!isVariableReference(idPath)) return;
					// Skip if declared locally in the nested function
					if (locallyDeclared.has(name)) return;
					// If it's one of the outer function's variables, it's captured
					if (outerVars.has(name)) {
						freeVars.add(name);
					}
				},
			});

			// Don't traverse into nested functions from here — we handle them above
			path.skip();
		},
	});
}

function collectNodeNames(node: t.Node, names: Set<string>): void {
	if (node.type === "Identifier") {
		names.add((node as t.Identifier).name);
	} else if (node.type === "ArrayPattern") {
		for (const elem of (node as t.ArrayPattern).elements) {
			if (elem) collectNodeNames(elem, names);
		}
	} else if (node.type === "ObjectPattern") {
		for (const prop of (node as t.ObjectPattern).properties) {
			if (prop.type === "ObjectProperty")
				collectNodeNames(prop.value as t.Node, names);
			else if (prop.type === "RestElement")
				collectNodeNames(prop.argument, names);
		}
	} else if (node.type === "AssignmentPattern") {
		collectNodeNames((node as t.AssignmentPattern).left, names);
	} else if (node.type === "RestElement") {
		collectNodeNames((node as t.RestElement).argument, names);
	}
}

function isVariableReference(path: NodePath<t.Identifier>): boolean {
	const parent = path.parent;
	const key = path.key;

	// Property access: obj.prop — 'prop' is not a variable reference
	if (
		parent.type === "MemberExpression" &&
		key === "property" &&
		!parent.computed
	)
		return false;
	// Object property key: { key: val }
	if (parent.type === "ObjectProperty" && key === "key" && !parent.computed)
		return false;
	// Object method key
	if (parent.type === "ObjectMethod" && key === "key" && !parent.computed)
		return false;
	// Class method key
	if (parent.type === "ClassMethod" && key === "key" && !parent.computed)
		return false;
	// Function name: function foo() {}
	if (
		(parent.type === "FunctionDeclaration" ||
			parent.type === "FunctionExpression") &&
		key === "id"
	)
		return false;
	// Class name
	if (
		(parent.type === "ClassDeclaration" ||
			parent.type === "ClassExpression") &&
		key === "id"
	)
		return false;
	// Import specifier
	if (parent.type === "ImportSpecifier" && key === "imported") return false;
	// Label
	if (parent.type === "LabeledStatement" && key === "label") return false;
	if (
		(parent.type === "BreakStatement" ||
			parent.type === "ContinueStatement") &&
		key === "label"
	)
		return false;

	return true;
}

function isInsideNestedFunction(path: NodePath, boundary: NodePath): boolean {
	let current = path.parentPath;
	while (current && current !== boundary) {
		if (
			current.isFunctionDeclaration() ||
			current.isFunctionExpression() ||
			current.isArrowFunctionExpression() ||
			current.isObjectMethod() ||
			current.isClassMethod()
		) {
			return true;
		}
		current = current.parentPath;
	}
	return false;
}
