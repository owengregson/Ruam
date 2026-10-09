# Primary research register

Checked by the coordinator on 2026-10-09. These references inform attacks and prototype hypotheses. None establishes protection strength for Ruam's JavaScript runtime.

| Source | Relevant lesson | Limit for this campaign |
| --- | --- | --- |
| [Syntia, USENIX Security 2017](https://www.usenix.org/conference/usenixsecurity17/technical-sessions/presentation/blazytko) and [authors' implementation](https://github.com/RUB-SysSec/syntia) | Local input/output synthesis is an attack on semantics even when expression syntax is complicated. | Native instruction-trace experiments; not a current Ruam result. |
| [Loki, USENIX Security 2022](https://www.usenix.org/conference/usenixsecurity22/presentation/schloegel) and [authors' artifact](https://github.com/RUB-SysSec/loki) | Evaluate taint, slicing, symbolic execution and synthesis together; merging real semantics and target-specific expression generation are testable ideas. | An academic native-code VM prototype. Published success rates must not be transferred to JS or assumed to survive newer attackers. |
| [MBA-Blast, USENIX Security 2021](https://www.usenix.org/system/files/sec21-liu-binbin.pdf) and [SiMBA authors' paper, 2022](https://arxiv.org/abs/2209.06335) | Algebraic normalization is a required adversary for linear MBA and encoding proposals. | Exact operation width and algebraic class determine applicability. |
| [Xyntia authors' repository](https://github.com/binsec/xyntia) | Reusable local sampling and synthesis pipelines are part of the attack baseline. The repository points to CCS 2021 work and 2025 local-inference enhancements. | Check pinned tool versions and supported operators before claiming reproduction. |
| [CASCADE authors' paper, v2 revised 2026-02-25](https://arxiv.org/abs/2507.17691v2) | An LLM can identify useful JS helper routines while deterministic IR transforms perform the simplification. Evaluate the combined tool-using attacker, not just one-shot model readability. | Authors' results on another system and corpus; not proof against Ruam. First submitted 2025; v2 identifies ICSE-SEIP 2026 publication. |
| [JsDeObsBench authors' paper, 2025](https://arxiv.org/abs/2506.20170) | Syntax validity and executable behavioral correctness must accompany deobfuscation assessment. | Readability or simplification scores alone do not establish recovered application semantics. |

Reviewers may add independent primary references in their own briefs. Do not cite these papers as evidence that a proposed Ruam defense has already succeeded.
