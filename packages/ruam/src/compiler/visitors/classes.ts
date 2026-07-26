/**
 * Class expression and declaration compilation.
 *
 * Handles the `class` keyword by emitting `NEW_CLASS`, then compiling each
 * method / property as a child semantic unit. Instance field initialisers
 * are injected into the constructor body before compilation.
 *
 * @module compiler/visitors/classes
 */

import type { NodePath } from "@babel/traverse";
import * as t from "@babel/types";
import { Op } from "../operations.js";
import type { Emitter } from "../emitter.js";
import type { ScopeAnalyzer } from "../scope.js";
import type { CompileContext } from "../index.js";
import type { SemanticCompileUnit } from "../types.js";
import { compileExpression } from "./expressions.js";

/**
 * Compile a `ClassExpression` node.
 *
 * The resulting class constructor is left on the stack.  Callers are
 * responsible for storing it (e.g. via `STORE_SCOPED` for declarations).
 */
export function compileClassExpr(
	classPath: NodePath<t.ClassExpression>,
	emitter: Emitter,
	scope: ScopeAnalyzer,
	ctx: CompileContext,
	allUnits: SemanticCompileUnit[],
	compileFunctionInner: (
		fnPath: NodePath<t.Function>,
		allUnits: SemanticCompileUnit[]
	) => SemanticCompileUnit
): void {
	const classNode = classPath.node;

	// --- Inject instance property initialisers into the constructor ----------
	injectInstanceProperties(classNode);

	// --- Emit NEW_CLASS (optionally with superclass) -------------------------
	if (classNode.superClass) {
		compileExpression(
			classPath.get("superClass") as NodePath<t.Expression>,
			emitter,
			scope,
			ctx
		);
		emitter.emit(Op.NEW_CLASS, 1);
	} else {
		emitter.emit(Op.NEW_CLASS, 0);
	}

	// --- Compile each class member -------------------------------------------
	const body = classPath.get("body").get("body");
	for (const member of body) {
		if (member.isClassMethod()) {
			compileClassMethod(
				member,
				emitter,
				scope,
				ctx,
				allUnits,
				compileFunctionInner
			);
		} else if (member.isClassPrivateMethod()) {
			compilePrivateClassMethod(
				member,
				emitter,
				allUnits,
				compileFunctionInner
			);
		} else if (member.isClassProperty() && member.node.static) {
			compileStaticProperty(member, emitter, scope, ctx);
		} else if (member.isClassPrivateProperty() && member.node.static) {
			compileStaticPrivateProperty(member, emitter, scope, ctx);
		} else if (member.isStaticBlock()) {
			compileStaticBlock(
				member,
				emitter,
				allUnits,
				compileFunctionInner
			);
		} else if (
			!member.isClassProperty() &&
			!member.isClassPrivateProperty()
		) {
			throw new Error(
				`RUAM_CANONICAL_UNSUPPORTED_CLASS_ELEMENT: ${member.node.type}`
			);
		}
	}
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Move instance (non-static) class property initialisers into the
 * constructor body so they execute as `this.x = value`.
 *
 * If no constructor exists, a synthetic one is created (with `super()`
 * forwarding if the class extends a superclass).
 */
function injectInstanceProperties(classNode: t.ClassExpression): void {
	const inits: t.Statement[] = [];

	for (const member of classNode.body.body) {
		if (member.type === "ClassProperty" && !member.static) {
			if (member.computed) {
				throw new Error(
					"RUAM_CANONICAL_UNSUPPORTED_COMPUTED_INSTANCE_FIELD"
				);
			}
			const key = member.key;
			if (
				!t.isIdentifier(key) &&
				!t.isStringLiteral(key) &&
				!t.isNumericLiteral(key)
			) {
				throw new Error(
					`RUAM_CANONICAL_UNSUPPORTED_INSTANCE_FIELD_KEY: ${key.type}`
				);
			}
			inits.push(
				t.expressionStatement(
					t.assignmentExpression(
						"=",
						t.memberExpression(
							t.thisExpression(),
							key,
							!t.isIdentifier(key)
						),
						member.value ?? t.unaryExpression("void", t.numericLiteral(0))
					)
				)
			);
		} else if (member.type === "ClassPrivateProperty" && !member.static) {
			inits.push(
				t.expressionStatement(
					t.assignmentExpression(
						"=",
						t.memberExpression(
							t.thisExpression(),
							member.key,
							false
						),
						member.value ?? t.unaryExpression("void", t.numericLiteral(0))
					)
				)
			);
		}
	}

	if (inits.length === 0) return;

	// Try to inject into an existing constructor
	for (const member of classNode.body.body) {
		if (member.type === "ClassMethod" && member.kind === "constructor") {
			const superIdx = member.body.body.findIndex(
				(stmt) =>
					stmt.type === "ExpressionStatement" &&
					stmt.expression.type === "CallExpression" &&
					stmt.expression.callee.type === "Super"
			);
			if (superIdx >= 0) {
				member.body.body.splice(superIdx + 1, 0, ...inits);
			} else {
				member.body.body.unshift(...inits);
			}
			return;
		}
	}

	// No constructor — create a synthetic one
	const ctorBody: t.Statement[] = [];
	if (classNode.superClass) {
		ctorBody.push({
			type: "ExpressionStatement",
			expression: {
				type: "CallExpression",
				callee: { type: "Super" } as t.Super,
				arguments: [
					{
						type: "SpreadElement",
						argument: {
							type: "Identifier",
							name: "arguments",
						} as t.Identifier,
					} as t.SpreadElement,
				],
			} as t.CallExpression,
		} as t.ExpressionStatement);
	}
	ctorBody.push(...inits);

	classNode.body.body.unshift({
		type: "ClassMethod",
		kind: "constructor",
		key: { type: "Identifier", name: "constructor" } as t.Identifier,
		params: [],
		body: {
			type: "BlockStatement",
			body: ctorBody,
			directives: [],
		} as t.BlockStatement,
		computed: false,
		static: false,
		generator: false,
		async: false,
	} as t.ClassMethod);
}

/** Compile a class method (constructor, regular, getter, or setter). */
function compileClassMethod(
	member: NodePath<t.ClassMethod>,
	emitter: Emitter,
	scope: ScopeAnalyzer,
	ctx: CompileContext,
	allUnits: SemanticCompileUnit[],
	compileFunctionInner: (
		fnPath: NodePath<t.Function>,
		allUnits: SemanticCompileUnit[]
	) => SemanticCompileUnit
): void {
	emitter.emit(Op.DUP, 0);

	if (member.node.computed) {
		// Computed method name: [expr]() { ... }
		// Stack after DUP: [class, class]
		const isStatic = member.node.static;
		const isAccessor =
			member.node.kind === "get" || member.node.kind === "set";

		// For instance methods, resolve prototype as the assignment target
		if (!isStatic) {
			const protoIdx = emitter.addStringConstant("prototype");
			emitter.emit(Op.GET_PROP_STATIC, protoIdx); // [class, proto]
		}
		// Stack: [class, target]

		// Save target to register for home object stamping
		const rTarget = scope.registerAllocator.alloc();
		emitter.emit(Op.DUP, 0); // [class, target, target]
		emitter.emit(Op.STORE_REG, rTarget); // [class, target]

		// Compile key expression onto the stack
		compileExpression(
			member.get("key") as NodePath<t.Expression>,
			emitter,
			scope,
			ctx
		);
		// Stack: [class, target, key]

		// Compile method body as a closure
		const childUnit = compileFunctionInner(
			member as unknown as NodePath<t.Function>,
			allUnits
		);
		allUnits.push(childUnit);
		const idIdx = emitter.addStringConstant(childUnit.id);
		emitter.emit(Op.NEW_CLOSURE, idIdx);
		// Stack: [class, target, key, fn]

		// Stamp fn._ho = target (home object for super resolution)
		const hoIdx = emitter.addStringConstant("_ho");
		emitter.emit(Op.DUP, 0); // [class, target, key, fn, fn]
		emitter.emit(Op.LOAD_REG, rTarget); // [class, target, key, fn, fn, target]
		emitter.emit(Op.SET_PROP_STATIC, hoIdx); // [class, target, key, fn, fn]
		emitter.emit(Op.POP, 0); // [class, target, key, fn]

		if (isAccessor) {
			// Build a property descriptor: {get/set: fn, configurable: true, enumerable: false}
			emitter.emit(Op.NEW_OBJECT, 0); // [class, target, key, fn, {}]
			emitter.emit(Op.SWAP, 0); // [class, target, key, {}, fn]
			const descKeyIdx = emitter.addStringConstant(member.node.kind); // "get" or "set"
			emitter.emit(Op.SET_PROP_STATIC, descKeyIdx); // [class, target, key, {get/set: fn}]

			// Add configurable: true
			emitter.emit(Op.DUP, 0); // [class, target, key, desc, desc]
			emitter.emit(Op.PUSH_TRUE, 0); // [class, target, key, desc, desc, true]
			const confIdx = emitter.addStringConstant("configurable");
			emitter.emit(Op.SET_PROP_STATIC, confIdx); // [class, target, key, desc, desc']
			emitter.emit(Op.POP, 0); // [class, target, key, desc]

			// Add enumerable: false
			emitter.emit(Op.DUP, 0); // [class, target, key, desc, desc]
			emitter.emit(Op.PUSH_FALSE, 0); // [class, target, key, desc, desc, false]
			const enumIdx = emitter.addStringConstant("enumerable");
			emitter.emit(Op.SET_PROP_STATIC, enumIdx); // [class, target, key, desc, desc']
			emitter.emit(Op.POP, 0); // [class, target, key, desc]

			// Object.defineProperty(target, key, desc) -> pushes target
			emitter.emit(Op.DEFINE_OWN_PROPERTY, 0); // [class, target]
			emitter.emit(Op.POP, 0); // [class]
		} else {
			// Simple assignment: target[key] = fn -> pushes target
			emitter.emit(Op.SET_PROP_DYNAMIC, 0); // [class, target]
			emitter.emit(Op.POP, 0); // [class]
		}
		return;
	}

	const childUnit = compileFunctionInner(
		member as unknown as NodePath<t.Function>,
		allUnits
	);
	allUnits.push(childUnit);
	const idIdx = emitter.addStringConstant(childUnit.id);
	emitter.emit(Op.NEW_CLOSURE, idIdx);

	const key = member.node.key;
	let keyName: string;
	if (key.type === "Identifier") keyName = key.name;
	else if (key.type === "StringLiteral") keyName = key.value;
	else if (key.type === "NumericLiteral") keyName = String(key.value);
	else throw new Error(`Unsupported class method key: ${key.type}`);

	const nameIdx = emitter.addStringConstant(keyName);

	if (member.node.kind === "constructor") {
		emitter.emit(Op.DEFINE_METHOD, nameIdx);
	} else if (member.node.kind === "get") {
		emitter.emit(
			member.node.static ? Op.DEFINE_STATIC_GETTER : Op.DEFINE_GETTER,
			nameIdx
		);
	} else if (member.node.kind === "set") {
		emitter.emit(
			member.node.static ? Op.DEFINE_STATIC_SETTER : Op.DEFINE_SETTER,
			nameIdx
		);
	} else {
		emitter.emit(
			member.node.static ? Op.DEFINE_STATIC_METHOD : Op.DEFINE_METHOD,
			nameIdx
		);
	}

	emitter.emit(Op.POP, 0);
}

/** Compile a static class property. */
function compileStaticProperty(
	member: NodePath<t.ClassProperty>,
	emitter: Emitter,
	scope: ScopeAnalyzer,
	ctx: CompileContext
): void {
	emitter.emit(Op.DUP, 0);
	const key = member.node.key;
	if (member.node.computed) {
		compileExpression(
			member.get("key") as NodePath<t.Expression>,
			emitter,
			scope,
			ctx
		);
		emitClassFieldValue(member, emitter, scope, ctx);
		emitter.emit(Op.SET_PROP_DYNAMIC, 0);
	} else {
		const keyName = staticKeyName(key);
		emitClassFieldValue(member, emitter, scope, ctx);
		emitter.emit(
			Op.DEFINE_STATIC_FIELD,
			emitter.addStringConstant(keyName)
		);
	}

	emitter.emit(Op.POP, 0);
}

function emitClassFieldValue(
	member: NodePath<t.ClassProperty>,
	emitter: Emitter,
	scope: ScopeAnalyzer,
	ctx: CompileContext
): void {
	const value = member.get("value");
	if (value.node && value.isExpression()) {
		compileExpression(value, emitter, scope, ctx);
	} else {
		emitter.emit(Op.PUSH_UNDEFINED, 0);
	}
}

function compileStaticPrivateProperty(
	member: NodePath<t.ClassPrivateProperty>,
	emitter: Emitter,
	scope: ScopeAnalyzer,
	ctx: CompileContext
): void {
	emitter.emit(Op.DUP, 0);
	const value = member.get("value");
	if (value.node && value.isExpression()) {
		compileExpression(value, emitter, scope, ctx);
	} else {
		emitter.emit(Op.PUSH_UNDEFINED, 0);
	}
	emitter.emit(
		Op.DEFINE_STATIC_PRIVATE_FIELD,
		emitter.addStringConstant(`#${member.node.key.id.name}`)
	);
	emitter.emit(Op.POP, 0);
}

function compilePrivateClassMethod(
	member: NodePath<t.ClassPrivateMethod>,
	emitter: Emitter,
	allUnits: SemanticCompileUnit[],
	compileFunctionInner: (
		fnPath: NodePath<t.Function>,
		allUnits: SemanticCompileUnit[]
	) => SemanticCompileUnit
): void {
	if (
		member.node.static &&
		(member.node.kind === "get" || member.node.kind === "set")
	) {
		throw new Error(
			"RUAM_CANONICAL_UNSUPPORTED_STATIC_PRIVATE_ACCESSOR"
		);
	}
	emitter.emit(Op.DUP, 0);
	const childUnit = compileFunctionInner(
		member as unknown as NodePath<t.Function>,
		allUnits
	);
	allUnits.push(childUnit);
	emitter.emit(
		Op.NEW_CLOSURE,
		emitter.addStringConstant(childUnit.id)
	);
	const nameIndex = emitter.addStringConstant(`#${member.node.key.id.name}`);
	const operation = member.node.static
		? Op.DEFINE_STATIC_PRIVATE_METHOD
		: member.node.kind === "get"
			? Op.DEFINE_PRIVATE_GETTER
			: member.node.kind === "set"
				? Op.DEFINE_PRIVATE_SETTER
				: Op.DEFINE_PRIVATE_METHOD;
	emitter.emit(operation, nameIndex);
	emitter.emit(Op.POP, 0);
}

function compileStaticBlock(
	member: NodePath<t.StaticBlock>,
	emitter: Emitter,
	allUnits: SemanticCompileUnit[],
	compileFunctionInner: (
		fnPath: NodePath<t.Function>,
		allUnits: SemanticCompileUnit[]
	) => SemanticCompileUnit
): void {
	const synthetic = t.classMethod(
		"method",
		t.identifier("__ruamStaticBlock"),
		[],
		t.blockStatement(member.node.body)
	);
	synthetic.static = true;
	member.replaceWith(synthetic);
	const childUnit = compileFunctionInner(
		member as unknown as NodePath<t.Function>,
		allUnits
	);
	allUnits.push(childUnit);
	emitter.emit(Op.DUP, 0);
	emitter.emit(
		Op.NEW_CLOSURE,
		emitter.addStringConstant(childUnit.id)
	);
	emitter.emit(Op.CLASS_STATIC_BLOCK, 0);
	emitter.emit(Op.POP, 0);
}

function staticKeyName(key: t.Expression | t.Identifier | t.PrivateName): string {
	if (t.isIdentifier(key)) return key.name;
	if (t.isStringLiteral(key) || t.isNumericLiteral(key)) {
		return String(key.value);
	}
	throw new Error(
		`RUAM_CANONICAL_UNSUPPORTED_STATIC_FIELD_KEY: ${key.type}`
	);
}
