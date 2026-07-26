import type { NodePath } from "@babel/traverse";
import type * as t from "@babel/types";
import type { Emitter } from "../emitter.js";
import type { SourceOrigin } from "../ir.js";

/**
 * Run a visitor emission under the smallest Babel node that owns it.
 *
 * The compiler entry point supplies a function/body fallback origin.  Visitor
 * dispatchers call this helper recursively so concrete expressions,
 * statements, and class members replace that broad fallback.  Downstream
 * protection certificates can therefore prove which executable source node
 * produced each canonical semantic operation.
 */
export function withNodeOrigin<T>(
	path: NodePath<t.Node>,
	emitter: Emitter,
	emit: () => T
): T {
	return emitter.withOrigin(sourceOriginFromPath(path), emit);
}

function sourceOriginFromPath(path: NodePath<t.Node>): SourceOrigin {
	const node = path.node;
	const location = node.loc as
		| (t.SourceLocation & { filename?: string | null })
		| null
		| undefined;
	const start =
		typeof node.start === "number" && node.start >= 0 ? node.start : 0;
	const end =
		typeof node.end === "number" && node.end >= start ? node.end : start;
	const file = location?.filename ?? undefined;
	return file
		? {
				file,
				start,
				end,
				line: location?.start.line ?? 1,
				column: location?.start.column ?? 0,
			}
		: {
				start,
				end,
				line: location?.start.line ?? 1,
				column: location?.start.column ?? 0,
			};
}
