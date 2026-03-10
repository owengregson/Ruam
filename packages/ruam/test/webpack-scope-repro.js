// Reproduction test: webpack-like bundle structure
// Tests if classes inside module factory functions resolve correctly

(() => {
	"use strict";
	var __webpack_modules__ = {
		"./src/pipeline.ts"(
			__unused_webpack_module,
			__webpack_exports__,
			__webpack_require__
		) {
			// Simulate harmony exports (arrow functions referencing classes before declaration)
			var exports_def = {
				DifficultyStage: () => DifficultyStage,
				HumanizationPipeline: () => HumanizationPipeline,
			};

			class DifficultyAnalyzer {
				analyze(text) {
					return text.split("").map(() => Math.random());
				}
			}

			class DifficultyStage {
				name = "DifficultyStage";
				analyzer;
				constructor(analyzer) {
					this.analyzer = analyzer ?? new DifficultyAnalyzer();
				}
				process(ctx) {
					return ctx;
				}
			}

			class ErrorInjectionStage {
				name = "ErrorInjectionStage";
				process(ctx) {
					return ctx;
				}
			}

			class HumanizationPipeline {
				stages;
				constructor(stages) {
					this.stages = stages ?? [
						new DifficultyStage(),
						new ErrorInjectionStage(),
					];
				}
				process(text) {
					let ctx = { text };
					for (const stage of this.stages) {
						ctx = stage.process(ctx);
					}
					return ctx;
				}
			}

			// Simulate __webpack_require__.d setting getters
			Object.defineProperty(__webpack_exports__, "HumanizationPipeline", {
				enumerable: true,
				get: exports_def.HumanizationPipeline,
			});
			Object.defineProperty(__webpack_exports__, "DifficultyStage", {
				enumerable: true,
				get: exports_def.DifficultyStage,
			});
		},
	};

	var __webpack_module_cache__ = {};
	function __webpack_require__(moduleId) {
		if (__webpack_module_cache__[moduleId])
			return __webpack_module_cache__[moduleId].exports;
		var module = (__webpack_module_cache__[moduleId] = { exports: {} });
		__webpack_modules__[moduleId](
			module,
			module.exports,
			__webpack_require__
		);
		return module.exports;
	}

	// Entry point
	var pipelineModule = __webpack_require__("./src/pipeline.ts");
	var pipeline = new pipelineModule.HumanizationPipeline();
	console.log("stages count:", pipeline.stages.length);
	console.log("first stage:", pipeline.stages[0].name);
	console.log("second stage:", pipeline.stages[1].name);
	console.log(
		"pipeline works:",
		pipeline.stages[0].name === "DifficultyStage"
	);
})();
