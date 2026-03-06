/**
 * Compile-time scope analysis and register allocation.
 *
 * Mirrors JavaScript's scoping rules: `var` and `function` declarations
 * hoist to the nearest function scope, while `let`, `const`, and `param`
 * stay in the current block.
 *
 * @module compiler/scope
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The kind of binding a name was declared with. */
export type BindingKind = "var" | "let" | "const" | "param" | "function";

/** A single name binding within a scope. */
export interface Binding {
  name: string;
  kind: BindingKind;
  register: number;
  isCaptured: boolean;
}

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

/** A single lexical scope node in the scope tree. */
export class Scope {
  readonly bindings = new Map<string, Binding>();
  readonly children: Scope[] = [];

  constructor(
    public readonly parent: Scope | null,
    public readonly isBlock: boolean,
    private readonly registerAllocator: RegisterAllocator,
  ) {
    if (parent) parent.children.push(this);
  }

  /** Declare a new binding in this scope. */
  declare(name: string, kind: BindingKind): Binding {
    const register = this.registerAllocator.alloc();
    const binding: Binding = { name, kind, register, isCaptured: false };
    this.bindings.set(name, binding);
    return binding;
  }

  /** Walk up the scope chain looking for a binding. */
  resolve(name: string): Binding | null {
    const local = this.bindings.get(name);
    if (local) return local;
    if (this.parent) return this.parent.resolve(name);
    return null;
  }

  /** Look up a binding only in *this* scope (no parent walk). */
  resolveLocal(name: string): Binding | null {
    return this.bindings.get(name) ?? null;
  }
}

// ---------------------------------------------------------------------------
// RegisterAllocator
// ---------------------------------------------------------------------------

/** Monotonically-increasing register allocator. */
export class RegisterAllocator {
  private nextRegister: number;

  constructor(startAt: number = 0) {
    this.nextRegister = startAt;
  }

  /** Allocate the next available register index. */
  alloc(): number {
    return this.nextRegister++;
  }

  /** Total number of registers allocated so far. */
  get count(): number {
    return this.nextRegister;
  }
}

// ---------------------------------------------------------------------------
// ScopeAnalyzer
// ---------------------------------------------------------------------------

/**
 * Top-level scope analyzer for a single function body.
 *
 * Created once per function compilation.  Manages the root scope, the
 * current scope pointer, and the set of captured outer names.
 */
export class ScopeAnalyzer {
  readonly rootScope: Scope;
  readonly registerAllocator: RegisterAllocator;
  readonly outerNames: string[] = [];

  currentScope: Scope;

  private readonly outerNameSet = new Set<string>();

  constructor(paramCount: number) {
    this.registerAllocator = new RegisterAllocator(paramCount);
    this.rootScope = new Scope(null, false, this.registerAllocator);
    this.currentScope = this.rootScope;
  }

  /** Push a new child scope (block or function). */
  pushScope(isBlock: boolean): Scope {
    const scope = new Scope(this.currentScope, isBlock, this.registerAllocator);
    this.currentScope = scope;
    return scope;
  }

  /** Pop back to the parent scope. */
  popScope(): void {
    if (this.currentScope.parent) {
      this.currentScope = this.currentScope.parent;
    }
  }

  /**
   * Declare a binding, hoisting `var` / `function` to the nearest
   * function scope.
   */
  declare(name: string, kind: BindingKind): Binding {
    if (kind === "var" || kind === "function") {
      let scope = this.currentScope;
      while (scope.isBlock && scope.parent) scope = scope.parent;
      return scope.declare(name, kind);
    }
    return this.currentScope.declare(name, kind);
  }

  /** Resolve a name in the current scope chain. */
  resolve(name: string): { binding: Binding; isOuter: false } | null {
    const binding = this.currentScope.resolve(name);
    if (binding) return { binding, isOuter: false };
    return null;
  }

  /** Mark a name as captured from an outer (parent-function) scope. */
  markOuter(name: string): number {
    if (!this.outerNameSet.has(name)) {
      this.outerNameSet.add(name);
      this.outerNames.push(name);
    }
    return this.outerNames.indexOf(name);
  }

  /** Total number of registers allocated. */
  get totalRegisters(): number {
    return this.registerAllocator.count;
  }
}
