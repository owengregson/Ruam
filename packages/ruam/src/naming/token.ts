/**
 * @module naming/token
 * Opaque handle for a name that hasn't been resolved to a string yet.
 */

import type { NameScope } from "./scope.js";

// --- NameToken ---

export class NameToken {
	readonly key: string;
	readonly scope: NameScope;
	private _resolved: string | null = null;

	/** @internal — created only via NameScope.claim() */
	constructor(key: string, scope: NameScope) {
		this.key = key;
		this.scope = scope;
	}

	/** Resolved string name. Throws if not yet resolved. */
	get name(): string {
		if (this._resolved === null) {
			throw new Error(`NameToken "${this.key}" (scope: ${this.scope.id}) not yet resolved`);
		}
		return this._resolved;
	}

	/** String coercion — same fail-fast as .name. Required for params.join(",") etc. */
	toString(): string {
		return this.name;
	}

	/** @internal — called by NameRegistry.resolveAll() */
	resolve(value: string): void {
		if (this._resolved !== null) {
			throw new Error(`NameToken "${this.key}" already resolved to "${this._resolved}"`);
		}
		this._resolved = value;
	}
}

/** Marker for rest parameters: `...name` */
export class RestParam {
	readonly paramName: Name;

	constructor(paramName: Name) {
		this.paramName = paramName;
	}

	toString(): string {
		const resolved = this.paramName instanceof NameToken ? this.paramName.name : this.paramName;
		return `...${resolved}`;
	}
}

/** A name that will become an identifier in emitted JS. */
export type Name = NameToken | string;
