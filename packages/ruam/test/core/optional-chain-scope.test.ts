import { describe, expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { execFileSync } from "node:child_process";
import { obfuscateCodeWithReport } from "../../src/transform.js";

const source = `
function exercise() {
  const events = [], results = [];
  function observe(fn) { try { results.push(fn()); } catch (error) { results.push(error.name); } }
  const absent = null;
  const obj = { value: 12, child: { value: 7 }, method(...args) { events.push('call'); return { value: this.value + args.length }; } };
  const key = () => { events.push('key'); return 'child'; };
  const arg = () => { events.push('arg'); return 3; };
  observe(() => absent?.child.value);
  observe(() => absent?.[key()].value);
  observe(() => absent?.method(arg()).value);
  observe(() => obj?.child.value);
  observe(() => obj?.method(arg()).value);
  observe(() => obj.method?.(...[1, 2]).value);
  observe(() => obj?.missing(arg()));
  observe(() => obj.missing?.(arg()).value);
  observe(() => obj?.missing?.(arg()).value);
  observe(() => obj?.child?.value);
  observe(() => obj?.[key()].value);
  observe(() => (absent?.child).value);
  observe(() => (absent?.method)?.(arg()));
  observe(() => (obj?.method)?.(1).value);
  observe(() => (obj?.method)(1, 2).value);
  observe(() => (absent?.method)(arg()));
  observe(() => absent?.child.value ?? 'empty');
  const fn = (...args) => ({ value: args.length });
  observe(() => fn?.(...[1, 2, 3]).value);
  observe(() => absent?.(...[arg()]).value);
  observe(() => obj.method?.().value);
  observe(() => obj?.method()?.value);
  const holder = {};
  Object.defineProperty(holder, 'method', { get() { events.push('get'); return obj.method; } });
  holder.value = 20;
  observe(() => holder.method?.(arg()).value);
  return JSON.stringify({ results, events });
}
exercise();
`;

// Bun 1.3.11 erases the parentheses in (null?.method)(argument()) while
// lowering source. Use Node's untransformed evaluation as the native oracle.
const nativeResult = execFileSync("node", ["-e", "process.stdout.write(require('node:vm').runInNewContext(require('node:fs').readFileSync(0, 'utf8')));"], { input: source, encoding: "utf8", timeout: 10_000 });

describe("continuous optional-chain short-circuit scope", () => {
  for (const preset of ["low", "max"] as const) {
    test(`preserves chain exits, receivers, keys and arguments with ${preset}`, () => {
      const { code, report } = obfuscateCodeWithReport(source, { preset, debugProtection: false });
      expect(report.completeSelection).toBe(true);
      expect(runInNewContext(code)).toBe(nativeResult);
    });
  }
  test("chain short-circuit does not discard the surrounding expression stack", () => {
    const source = `function run() { let a = null; return [1, a?.x.y, 3, a?.f().x, 5]; } JSON.stringify(run());`;
    const { code } = obfuscateCodeWithReport(source);
    expect(runInNewContext(code)).toBe(runInNewContext(source));
  });
});
