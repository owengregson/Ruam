<div align="center">
  <pre>
:::::::..    ...    :::  :::.     .        :
;;;;``;;;;   ;;     ;;;  ;;`;;    ;;,.    ;;;
 [[[,/[[['  [['     [[[ ,[[ '[[,  [[[[, ,[[[[,
 $$$$$$c    $$      $$$c$$$cc$$$c $$$$$$$$"$$$
 888b "88bo,88    .d888 888   888,888 Y88" 888o
 MMMM   "W"  "YmmMMMM"" YMM   ""` MMM  M'  "MMM</pre>

  <strong>Isogloss execution protection for guarded JavaScript relations</strong>

  <p>
    Ruam replaces explicitly bounded, side-effect-free source relations with
    contextual BPRF realizations while keeping deployment claims honest.
  </p>

  <a href="https://nodejs.org/en/"><img src="https://img.shields.io/badge/node-%3E%3D18-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js >= 18"></a>
  <img src="https://img.shields.io/badge/license-LGPL--2.1-yellow?style=flat-square" alt="LGPL-2.1">
  <img src="https://img.shields.io/badge/typescript-strict-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript strict">
</div>

## What Ruam ships

Ruam's shipped execution architecture is Isogloss. The source transform:

1. Finds an explicitly configured root function or a function marked with
   `/* ruam:isogloss */`.
2. Requires an exact declared domain for every local input used by the selected
   pure return expression.
3. Rejects calls, effects, unsupported coercions, unsafe numeric ranges, and
   other expressions it cannot prove safe to lower.
4. Replaces the accepted relation with a scalarized BPRF closure containing
   multiple contextual realizations and fragmented relation pieces.
5. Enforces the declared domains at runtime. Inputs outside those domains throw;
   the original relation is not retained as a fallback.

Configured targets fail closed. If a function is named in `regionDomains` but
its selected expression cannot be lowered, protection stops with a structured
error instead of shipping the configured relation unchanged.

Unconfigured or untargeted JavaScript remains ordinary source and is reported
through build diagnostics. Ruam does not claim whole-language protection.

## Threat-model honesty

The default `holographic-local` profile is **client-complete**. Everything
needed to execute the protected relation is present in the client. Its
contextual realizations and fragmentation can raise the cost of static and
dynamic analysis, but they do not create secrecy and do not establish a
hardness lower bound. An attacker with unrestricted execution and
instrumentation can ultimately reconstruct local behavior.

Ruam's owner-planning learnability checks are also non-claims. They compute
constructive exact black-box attack **upper bounds** and reject a planned region
when a known attack is strictly cheaper than the configured threshold. Passing
that owner-side gate does not prove that attacks require the threshold number
of queries.

Stronger deployment profiles are architectural deployments, not local switches:

| Profile | Required boundary | Client completeness | Local fallback |
| --- | --- | --- | --- |
| `holographic-local` | None | Complete | Not applicable |
| `holographic-custodied` | An existing remote-await boundary and a real custodian | Incomplete under the custodian | Forbidden |
| `holographic-private` | An existing remote-await boundary, a real custodian, and an actively secure private-function protocol | Incomplete under the private protocol | Forbidden |
| `holographic-tee` | A real in-process attested boundary with a pinned measurement or policy | Incomplete under attestation | Forbidden |

Custodied, private, and TEE deployments must be assembled by the owner-side
product planner using real boundary evidence and supported capabilities. The
source API will not invent a suspension point, silently graft a remote call
onto synchronous code, or embed a complete local relation for outage or
development fallback.

## Installation

```sh
npm install ruam
```

Ruam requires Node.js 18 or newer and ships as ESM.

## Quick start

### Protect a source string

`protectCode` returns both generated code and honest build metadata:

```js
import { protectCode } from "ruam";

const source = `
  function price(quantity, unitPrice) {
    return (quantity * unitPrice) + (quantity - 1);
  }
`;

const build = protectCode(source, {
  isogloss: {
    profile: "holographic-local",
  },
  targetMode: "root",
  regionDomains: {
    price: {
      quantity: { type: "number", min: 1, max: 100 },
      unitPrice: { type: "number", min: 1, max: 10_000 },
    },
  },
});

console.log(build.code);
console.log(build.stats.clientCompleteness); // "complete"
console.log(build.stats.hardnessLowerBound); // null
console.log(build.diagnostics);
```

The configured numeric bounds are inclusive safe-integer ranges. The generated
function rejects any `quantity` or `unitPrice` outside those ranges.

### Protect only annotated functions

Set `targetMode: "comment"` and use the exact marker
`/* ruam:isogloss */` immediately before the function:

```js
import { protectCode } from "ruam";

const source = `
  /* ruam:isogloss */
  function sensitiveScore(x, y) {
    return (x * y) + (x - 3);
  }

  function publicLabel(value) {
    return String(value);
  }
`;

const build = protectCode(source, {
  targetMode: "comment",
  regionDomains: {
    sensitiveScore: {
      x: { type: "number", min: 1, max: 20 },
      y: { type: "number", min: 2, max: 30 },
    },
  },
});
```

Only `sensitiveScore` is considered. The marked function still must satisfy all
purity, shape, type, and domain checks.

### Protect one file

`protectFile` writes the generated code and returns the same build result as
`protectCode`:

```js
import { protectFile } from "ruam";

const build = await protectFile("src/pricing.js", "dist/pricing.js", {
  targetMode: "root",
  regionDomains: {
    price: {
      quantity: { type: "number", min: 1, max: 100 },
      unitPrice: { type: "number", min: 1, max: 10_000 },
    },
  },
});

console.log(build.stats.protectedRegionCount);
```

Omit the output path to overwrite the input file.

### Protect a directory

`runProtection` processes matching files and returns one build result per file:

```js
import { runProtection } from "ruam";

const results = await runProtection("dist", {
  include: ["**/*.js"],
  exclude: ["**/node_modules/**"],
  options: {
    targetMode: "comment",
    regionDomains: {
      sensitiveScore: {
        x: { type: "number", min: 1, max: 20 },
        y: { type: "number", min: 2, max: 30 },
      },
    },
  },
});

for (const { file, build } of results) {
  console.log(file, build.stats.protectedRegionCount);
}
```

`obfuscateCode` and `obfuscateFile` are string-only and `Promise<void>`
conveniences over the same Isogloss source transform. Use `protectCode` and
`protectFile` when build diagnostics or security metadata matter.

## Exact domain declarations

`regionDomains` is keyed first by function name and then by the exact local
binding name used in its selected expression:

```js
const options = {
  regionDomains: {
    choose: {
      gate: { type: "boolean" },
      left: { type: "number", min: 0, max: 1_000 },
      right: { type: "number", min: 0, max: 1_000 },
    },
  },
};
```

Ruam never infers a numeric range. Numeric bounds must be safe integers, must
not be negative zero, and must satisfy `min <= max`. Boolean domains are exact
and need no additional bounds.

Domain declarations serve two purposes across the architecture:

- They are emitted as runtime input guards.
- They provide the finite-domain evidence consumed by build-time safety checks
  and, when creating an owner product plan, black-box learnability checks.

A declaration is not permission to coerce values. Runtime types must match.

## Guarded pure-region scope

The current source path accepts bounded expressions built from:

- Local identifiers with matching declared domains
- Safe integer and boolean literals
- Numeric `+`, `-`, `*`, and unary negation where signed-zero and overflow
  safety can be proven
- Boolean `!`, `&&`, and `||`
- Conditional expressions whose branches have the same proven type

The configured expression must contain at least one input and enough structure
to form a meaningful protected region. Calls, property access, mutation,
suspension, exceptions, unbound values, implicit coercion, and unsupported
syntax are rejected for configured targets.

## Public API

### `protectCode(source, options?)`

Synchronously returns:

```ts
interface IsoglossSourceBuildResult {
  readonly code: string;
  readonly diagnostics: readonly IsoglossBuildDiagnostic[];
  readonly stats: {
    readonly engine: "isogloss";
    readonly profile: "holographic-local";
    readonly rootGroupCount: number;
    readonly protectedRegionCount: number;
    readonly realizationCount: number;
    readonly fragmentFunctionCount: number;
    readonly originalBytes: number;
    readonly outputBytes: number;
    readonly expansionRatio: number;
    readonly clientCompleteness: "complete";
    readonly hardnessLowerBound: null;
  };
  readonly ownerTrace?: IsoglossOwnerSidecar;
}
```

Set `isogloss.ownerTrace` to `"sidecar"` to receive owner-only build
certificates. The sidecar is returned separately and does not add runtime trace
hooks to the generated client code.

### `protectFile(inputPath, outputPath?, options?)`

Reads a file, protects it, writes the generated code, and resolves to its
`IsoglossSourceBuildResult`.

### `runProtection(directory, config?)`

Protects matching files and resolves to a frozen array of:

```ts
interface ProtectedFileResult {
  readonly file: string;
  readonly build: IsoglossSourceBuildResult;
}
```

### Core options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `targetMode` | `"root" \| "comment"` | `"root"` | Select top-level functions or exact annotations |
| `threshold` | `number` in `[0, 1]` | `1` | Per-build probability that an eligible target is selected |
| `preprocessIdentifiers` | `boolean` | `false` | Rename identifiers after protected regions are built |
| `target` | `"node" \| "browser" \| "browser-extension"` | `"browser"` | Declare the output environment |
| `regionDomains` | nested exact-domain map | `{}` | Bind configured functions and local inputs to exact domains |
| `isogloss.profile` | deployment profile | `"holographic-local"` | Select the honest execution profile |
| `isogloss.maximumCustody.minimumExactAttackQueries` | canonical unsigned decimal string | `"1000"` | Set the owner-planner rejection threshold for known constructive exact attacks |
| `isogloss.ownerTrace` | `"off" \| "sidecar"` | `"off"` | Return owner-only build metadata |
| `isogloss.capabilities` | profile-specific descriptors | `{}` | Declare real nonlocal capabilities for owner-planned deployments |

BPRF realization and fragment counts are fixed architecture constants, not
public security knobs. Unknown options are rejected with structured
`RuamOptionError` diagnostics.

## Errors and fail-closed behavior

Ruam exposes two structured error families:

- `RuamOptionError` for invalid, unknown, or profile-incompatible options.
- `IsoglossSourceTransformError` when a configured source target cannot be
  safely transformed or when a nonlocal profile lacks owner-planned boundary
  composition.

For configured targets, these errors stop the build. Ruam does not silently
return an unprotected configured relation.

## Requirements

- Node.js 18 or newer
- ESM
- Explicit finite domains for every input used by a configured pure region
- Real owner-planned boundaries and no complete local fallback for custodied,
  private, or TEE deployments

## License

[LGPL-2.1](LICENSE)
