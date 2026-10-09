import { describe, expect, it } from "bun:test";
import { Script } from "node:vm";
import { compileRegionalSource, compileRegionalGraphModule, RegionalCompileError } from "../../src/regional/compiler/index.js";

const seeds = [0, 1, 29, 0x12345678, 0xffffffff];
function execute(source: string): unknown { return new Script(source).runInNewContext(); }
function equivalent(source: string): void {
	const expected = execute(source);
	for (const seed of seeds) {
		const built = compileRegionalSource(source, { seed });
		expect(execute(built.code)).toEqual(expected);
		expect(built.report.status).toBe("experimental-unqualified");
		expect(built.report.coverage.wholeSourceProtection).toBe(false);
	}
}

describe("bounded regional compiler", () => {
	it("fuses a private direct helper, evaluates primitive arguments once and preserves order", () => {
		const source = `function run(x) {
			function combine(a,b) { return ((a * 3) ^ b) >>> 0; }
			let log=[];
			const a={valueOf(){log.push('a');return x;}};
			const b={valueOf(){log.push('b');return x+1;}};
			return [combine(a|0,b|0),log.join(',')];
		} run(19)`;
		const built = compileRegionalSource(source);
		expect(built.report.transformations.privateCallFusions).toBe(1);
		expect(built.code).not.toContain("function combine");
		expect(built.report.witnesses[0]?.validation).toBe("checked-fixed-recipe");
		equivalent(source);
	});

	it("does not fuse an unknown object argument or captured mutable environment", () => {
		const source = `function run(){let n=3; function f(x){return x+x+n;}
			let o={valueOf(){n++;return n;}}; return [f(o),n];} run()`;
		expect(compileRegionalSource(source).report.transformations.privateCallFusions).toBe(0);
		equivalent(source);
	});

	it("keeps parameter and implicit class activations outside body-local fusion", () => {
		const examples = [
			`function outer(){function helper(x){return x+1;}
				function inner(v=helper(2|0)){return v;}return inner();}outer()`,
			`function outer(){function helper(a,b){return a*100+b;}
				let nested=false;let depth=0;class C{x=helper(++depth|0,
					({valueOf(){if(!nested){nested=true;new C();}return 7;}})|0);}
				return new C().x;}outer()`,
			`function outer(){function helper(a){return a+1;}
				class C{[helper(3)](){return 9;}}return new C()[4]();}outer()`,
		];
		for (const source of examples) {
			expect(compileRegionalSource(source).report.transformations.privateCallFusions).toBe(0);
			equivalent(source);
		}
	});

	it("does not infer primitive globals from script var initializers", () => {
		const source = `var value=1;globalThis.value={valueOf(){return 7;}};
			function outer(){function helper(x){return x+x;}return helper(value);}outer()`;
		expect(compileRegionalSource(source).report.transformations.privateCallFusions).toBe(0);
		equivalent(source);
	});

	it("declines Annex B helper rebinding through sloppy blocks and conditionals", () => {
		const examples = [
			`function outer(){function helper(x){return x+1;}
				if(true){function helper(x){return x+2;}}return helper(3);}outer()`,
			`function outer(){function helper(x){return x+1;}
				if(true)function helper(x){return x+2;}return helper(3);}outer()`,
			`function outer(helper){function helper(x){return x+1;}
				if(true){function helper(x){return x+2;}}return helper(3);}outer(()=>99)`,
			`function outer(){function helper(x){return x+x;}var value=1;
				if(true){function value(){return 7;}}value.valueOf=()=>9;return helper(value);}outer()`,
		];
		for (const source of examples) {
			expect(compileRegionalSource(source).report.transformations.privateCallFusions).toBe(0);
			equivalent(source);
		}
	});

	it("preserves reentry40 and callback mutation without encoded snapshots", () => {
		equivalent(`function make(){let state={n:1}; function run(cb){state.n++;cb();return state.n;}
			function set(n){state.n=n;} return {run,set};}
			const api=make(); api.run(()=>api.set(40));`);
		equivalent(`function make(){let n=1;return {run(cb){n++;cb();return n;},set(x){n=x;}};}
			let api=make(); api.run(()=>{api.run(()=>api.set(20));api.set(40);});`);
	});

	it("preserves shared closure identity and mutation even when another helper fuses", () => {
		equivalent(`function run(){ let n=0; function pure(a){return a+1;}
			const inc=()=>++n; const read=()=>n; const pair={inc,read};
			return [pair.inc===inc,pure(4),inc(),read(),pair.read===read];} run()`);
	});

	it("preserves negative zero, NaN, infinities and thrown value identity", () => {
		equivalent(`function run(){function keep(x){return x;}const error={tag:3};let same=false;
			try{throw error;}catch(e){same=e===error;}
			return [Object.is(keep(-0),-0),Number.isNaN(keep(0/0)),keep(1/0),same];} run()`);
	});

	it("preserves throw/finally overrides and coercion ordering", () => {
		equivalent(`function run(){let log=[]; const thrown={x:1};function pure(x){return x*2;}
			try { try{ log.push(pure(3)); throw thrown; } finally {log.push('finally');} }
			catch(e){return [e===thrown,log.join(',')];}} run()`);
		equivalent(`function run(){let log=[];function f(x){return x+x;}
			const a={valueOf(){log.push('convert');return 2;}};
			try {return [f(a),log.join(',')];}finally{log.push('end');}}run()`);
	});

	it("specializes private dominated immutable own-data tables including -0", () => {
		const source = `function run(x){const config={add:7,mask:255,zero:-0};
			return [(x+config.add)&config.mask,Object.is(config.zero,-0)];}run(510)`;
		const built = compileRegionalSource(source);
		expect(built.report.transformations.configurationReads).toBe(3);
		expect(built.code).not.toContain("const config");
		equivalent(source);
		equivalent(`function run(){const config=[3,5,7];return config[0]+config[2]+config.length;}run()`);
	});

	it("declines tables with mutation, escape, getters, sparse/inherited or early reads", () => {
		const examples = [
			`function run(){const c={x:1};c.x=3;return c.x;}run()`,
			`function run(){const c={x:1};const alias=c;alias.x=5;return c.x;}run()`,
			`function run(){let n=0;const c={get x(){return ++n;}};return c.x+c.x;}run()`,
			`function run(){const c=[,3];return [c[0],c.length];}run()`,
			`function run(){function read(){return c.x;}let result;try{read();}catch(e){result=e instanceof ReferenceError;}const c={x:4};return [result,read()];}run()`,
			`function run(){const c={x:1};({x:c.x}={x:9});return c.x;}run()`,
		];
		for (const source of examples) {
			expect(compileRegionalSource(source).report.transformations.configurationReads).toBe(0);
			equivalent(source);
		}
	});

	it("composes a dependent integer branch and result without an easy duplicate", () => {
		const source = `function run(input){let x=input>>>0;
			if((x&1)===0) x=(x+7)>>>0; else x=(x^85)>>>0;
			return (x^(x>>>3))>>>0;}
			[0,1,2,19,-1,4294967295,-0,NaN,Infinity].map(run)`;
		const built = compileRegionalSource(source);
		expect(built.report.transformations.jointRegions).toBe(1);
		expect(built.code).not.toContain("if (");
		expect(built.report.analysis.domainFacts.length).toBe(1);
		equivalent(source);
	});

	it("keeps joint state when it escapes, changes type or has extra writes", () => {
		const examples = [
			`function run(input){let x=input; if(x<3)x=x+1;else x=x-1;return x;}run(-0)`,
			`function run(input){let x=input>>>0;const get=()=>x;if(x&1)x=(x+1)|0;else x=(x+2)|0;return [x,get()];}run(3)`,
			`function run(input){let x=input>>>0;x='a';if(x&1)x=(x+1)|0;else x=(x+2)|0;return x;}run(3)`,
		];
		for (const source of examples) {
			expect(compileRegionalSource(source).report.transformations.jointRegions).toBe(0);
			equivalent(source);
		}
	});

	it("never claims a Number domain from generic BigInt-capable bitwise syntax", () => {
		const source = `function run(input){let x=~input;
			if(x<3)x=~x;else x=~x;return x;}[run(2n),run(4)]`;
		const built = compileRegionalSource(source);
		expect(built.report.transformations.jointRegions).toBe(0);
		expect(built.report.analysis.domainFacts).toEqual([]);
		equivalent(source);
		const numberForced = `function run(input){let x=input|0;
			if(x&1)x=~x;else x=x^7;return x+x;}run(4)`;
		expect(compileRegionalSource(numberForced).report.transformations.jointRegions).toBe(1);
		equivalent(numberForced);
		equivalent(`function run(input){let x=input|0;if(x&1)x=~x;else x=x^7;return x+x;}
			try{run(4n)}catch(e){e instanceof TypeError}`);
	});

	it("preserves script completion, directives and public top-level bindings", () => {
		for (const source of [`'use strict'; 42;`, `let x=3; if(x) {7;} else {9;}`, `function run(){return 7;} run();`, `const c={x:4};c.x;`, `try{11;}finally{let x=0;}`]) equivalent(source);
		expect(compileRegionalSource(`function run(){return 7;}run();`).code).toContain("function run");
	});

	it("never promotes residual string expressions into new use-strict directives", () => {
		const examples = [
			`function outer(){function helper(){return 'use strict';}helper();return this===undefined;}outer()`,
			`function outer(){const cfg={strict:'use strict'};cfg.strict;return this===undefined;}outer()`,
			`function outer(a,a){function helper(){return 'use strict';}helper();return a;}outer(1,2)`,
			`function outer(a,a){function helper(){return 7;}'use strict';helper();return a;}outer(1,2)`,
			`function outer(){'custom directive';function helper(){return 'use strict';}helper();return this===undefined;}outer()`,
			`function outer(){'use strict';function helper(){return 'other';}helper();return this===undefined;}outer()`,
		];
		for (const source of examples) equivalent(source);
	});

	it("is deterministic, collision-safe across seeds, and supports ablations", () => {
		const source = `function run(){let Ab=10,pq=20;function f(x){return x+1;}return f(Ab|0)+f(pq|0);}run()`;
		for (const seed of seeds) expect(compileRegionalSource(source,{seed})).toEqual(compileRegionalSource(source,{seed}));
		equivalent(source);
		expect(compileRegionalSource(source,{fusion:false}).report.transformations.privateCallFusions).toBe(0);
		expect(compileRegionalSource(source,{seed:1}).code).not.toBe(compileRegionalSource(source,{seed:2}).code);
	});

	it("rejects unqualified syntax and direct or obvious aliased source capabilities", () => {
		for (const source of [
			`eval('1')`, `const e=eval;e('1')`, `new Function('return 1')`,
			`globalThis['ev'+'al']('1')`, `(()=>{}).constructor('return 1')()`,
			`async function f(){}`, `function* f(){yield 1}`, `import('./x.js')`,
			`setTimeout('run()',1)`, `const cb=()=>1;setInterval(cb,1)`, `with({}){1}`,
			`const delay=setTimeout;delay('run()',1)`, `const delay=globalThis['setInterval'];delay('run()',1)`,
			`const r=require;r('./unowned.js')`, `globalThis['require']('./unowned.js')`,
			`module.exports=42`, `exports.answer=42`,
		]) expect(()=>compileRegionalSource(source)).toThrow(RegionalCompileError);
		expect(()=>compileRegionalSource(`import {x} from './x.js';x;`)).toThrow("REGIONAL_MODULE_GRAPH_REQUIRED");
		expect(()=>compileRegionalSource(`setTimeout(()=>1,0);globalThis.setInterval(function(){return 1},1)`)).not.toThrow();
	});

	it("preserves standalone export syntax and graph module strict parsing", () => {
		expect(compileRegionalSource(`export function run(x){return x+1}`).report.sourceType).toBe("module");
		expect(compileRegionalGraphModule(`import {x} from './x.js';export const y=x;`).code).toContain("import");
		expect(compileRegionalGraphModule(`function run(){return this}`).report.sourceType).toBe("module");
		expect(compileRegionalGraphModule(`function run(){return this}`,{},"script").report.sourceType).toBe("script");
	});

	it("preserves sloppy script grammar, this, arguments aliases and explicit source mode", () => {
		const examples = [
			`function run(a,a){arguments[1]=7;return [a,arguments[0],this===globalThis,010];}run(2,3)`,
			`function run(a){arguments[0]=9;function helper(x){return x+1;}return [a,helper(3),this===globalThis];}run(1)`,
			`function run(a){'use strict';arguments[0]=9;return [a,this===undefined];}run(1)`,
		];
		for (const source of examples) {
			equivalent(source);
			const graphScript = compileRegionalGraphModule(source, {}, "script");
			expect(graphScript.report.sourceType).toBe("script");
			expect(execute(graphScript.code)).toEqual(execute(source));
		}
		expect(()=>compileRegionalGraphModule(examples[0]!, {}, "module")).toThrow("REGIONAL_PARSE_ERROR");
	});

	it("fails closed on invalid options and node/output budgets", () => {
		expect(()=>compileRegionalSource("1",{seed:NaN})).toThrow("REGIONAL_INVALID_OPTIONS");
		expect(()=>compileRegionalSource("1+2",{maxNodes:2})).toThrow("REGIONAL_RESOURCE_LIMIT");
		expect(()=>compileRegionalSource("const example=123456",{maxOutputBytes:3})).toThrow("REGIONAL_RESOURCE_LIMIT");
		expect(()=>compileRegionalSource("function {" )).toThrow("REGIONAL_PARSE_ERROR");
	});
});
