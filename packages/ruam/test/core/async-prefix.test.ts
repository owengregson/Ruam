import { describe, expect, it } from "bun:test";
import { runInNewContext } from "node:vm";
import { obfuscateCodeWithReport } from "../../src/index.js";

const cases = {
	"runs a single-flight guard synchronously before the first await": `
function main(){
  var pending=false,calls=0;
  async function run(){if(pending)return;pending=true;calls++;await Promise.resolve();pending=false;}
  var a=run(),b=run(),c=run(),immediate=[pending,calls];
  return Promise.all([a,b,c]).then(function(){return [immediate,calls,pending]});
}main();`,
	"runs an async function without await before returning its promise": `
function main(){var events=[];async function run(){events.push('body');return 7;}
  var promise=run();events.push('caller');var immediate=events.slice();
  return promise.then(function(value){return [immediate,value]});
}main();`,
	"turns a synchronous body throw into a rejected promise": `
function main(){var events=[],promise;
  async function run(){events.push('body');throw new Error('failure');}
  try{promise=run();events.push('caller')}catch(error){events.push('wrong-sync-throw')}
  var immediate=events.slice();
  return promise.catch(function(error){return [immediate,error.name,error.message]});
}main();`,
	"suspends only at authored awaits alongside host microtasks": `
function main(){var events=[];
  async function run(){events.push('start');await 0;events.push('first');await 0;events.push('second');}
  var promise=run();events.push('caller');
  queueMicrotask(function(){events.push('queued')});
  Promise.resolve().then(function(){events.push('then')});
  return promise.then(function(){return events});
}main();`,
	"keeps thenable getter effects before the caller resumes": `
function main(){var events=[];
  var thenable={get then(){events.push('get-then');return function(resolve){events.push('call-then');resolve(9)}}};
  async function run(){events.push('start');var value=await thenable;events.push(value);}
  var promise=run();events.push('caller');queueMicrotask(function(){events.push('queued')});
  return promise.then(function(){return events});
}main();`,
	"runs nested async prefixes and preserves frame state during reentry": `
function main(){var events=[];
  async function inner(value){events.push('inner'+value);await 0;events.push(value);return value*2;}
  async function outer(value){events.push('outer'+value);var next=inner(value);events.push('waiting'+value);return await next;}
  var first=outer(2),second=outer(5);events.push('caller');var immediate=events.slice();
  return Promise.all([first,second]).then(function(values){return [immediate,events,values]});
}main();`,
	"preserves catch and finally effects around suspension": `
function main(){var events=[];
  async function run(){try{events.push('try');await 0;throw new Error('failure')}
    catch(error){events.push(error.message)}finally{events.push('finally');await 0;events.push('settled')}
    return 11;}
  var promise=run();events.push('caller');queueMicrotask(function(){events.push('queued')});
  return promise.then(function(value){return [events,value]});
}main();`,
	"preserves explicit async iterator requests around suspension": `
function main(){var events=[],iterator={
  next:function(){events.push('next');return Promise.resolve({value:4,done:false})},
  return:function(){events.push('close');return Promise.resolve({done:true})}
};var iterable={};iterable[Symbol.asyncIterator]=function(){events.push('iterator');return iterator};
async function run(){events.push('start');var active=iterable[Symbol.asyncIterator]();
  var result=await active.next();events.push(result.value);await active.return();events.push('finished')}
var promise=run();events.push('caller');queueMicrotask(function(){events.push('queued')});
return promise.then(function(){return events});
}main();`,
};

describe("async interpreter suspension boundaries", () => {
	for (const [name, source] of Object.entries(cases)) {
		it(name, async () => {
			const evaluate = async (code: string) => JSON.stringify(await runInNewContext(code, { queueMicrotask }, { timeout: 2_000 }));
			const original = await evaluate(source);
			// Medium exercises the decode-cache path; low and max do not.
			for (const preset of ["low", "medium", "max"] as const) {
				const { code, report } = obfuscateCodeWithReport(source, { preset, targetMode: "root", debugProtection: false });
				expect(report.completeSelection).toBe(true);
				expect(await evaluate(code)).toBe(original);
			}
		}, 20_000);
	}
});
