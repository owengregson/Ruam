"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faLock, faShuffle, faShieldHalved } from "@fortawesome/free-solid-svg-icons";

const layers = [
  {
    icon: faLock,
    title: "VM Compilation",
    tag: "Layer 1",
    description:
      "Your JavaScript is compiled into custom bytecode — register-based instructions executed by an embedded interpreter. No native JS logic remains in the output.",
    visual: [
      { label: "Source", value: "function add(a,b) { return a+b }", style: "ember" as const },
      { label: "Bytecode", value: "LOAD_REG 0 → MUL → STORE_REG 2 → RET", style: "accent" as const },
    ],
  },
  {
    icon: faShuffle,
    title: "Opcode Shuffling",
    tag: "Layer 2",
    description:
      "Every build shuffles all ~300 opcodes via seeded Fisher-Yates. The interpreter uses physical opcode numbers as case labels — no reverse map exists to decode.",
    visual: [
      { label: "Build A", value: "ADD=0x3F  MUL=0x91  RET=0xC2", style: "ember" as const },
      { label: "Build B", value: "ADD=0xA7  MUL=0x1E  RET=0x58", style: "accent" as const },
    ],
  },
  {
    icon: faShieldHalved,
    title: "Rolling Encryption",
    tag: "Layer 3",
    description:
      "Every instruction is XOR-encrypted with a position-dependent key derived from bytecode metadata via FNV-1a. No plaintext seed appears in the output.",
    visual: [
      { label: "Key derivation", value: "FNV-1a(instCount, regCount, paramCount)", style: "ember" as const },
      { label: "Per-instruction", value: "XOR(opcode, mixState(key, idx, idx^φ))", style: "accent" as const },
    ],
  },
];

export default function VsSection() {
  const [active, setActive] = useState(0);
  const current = layers[active]!;

  return (
    <section className="mx-auto max-w-5xl px-6 pb-32">
      <motion.div initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}>
        <p className="mb-3 font-mono text-xs text-accent uppercase tracking-widest">
          Defense in Depth
        </p>
        <h2 className="font-display text-3xl text-snow sm:text-5xl">
          Three layers of protection
        </h2>
        <p className="mt-4 max-w-lg text-base text-smoke">
          Each layer makes reverse engineering exponentially harder.
          Together, they make it practically impossible.
        </p>
      </motion.div>

      <div className="mt-12 grid grid-cols-1 gap-8 lg:grid-cols-12">
        {/* Layer selector — left column */}
        <div className="flex flex-col gap-3 lg:col-span-4">
          {layers.map((layer, i) => (
            <motion.button
              key={layer.title}
              initial={{ opacity: 0, x: -12 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.08 }}
              onClick={() => setActive(i)}
              className={`group flex items-start gap-4 rounded-xl border p-4 text-left transition-all duration-200 ${
                active === i
                  ? "border-accent/20 bg-accent/[0.04]"
                  : "border-transparent hover:border-edge hover:bg-ink/50"
              }`}
            >
              <div
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors ${
                  active === i ? "bg-accent/15 text-accent" : "bg-panel text-ash group-hover:text-smoke"
                }`}
              >
                <FontAwesomeIcon icon={layer.icon} className="h-4 w-4" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] font-semibold text-accent uppercase tracking-wider">
                    {layer.tag}
                  </span>
                </div>
                <p className={`mt-0.5 text-sm font-semibold transition-colors ${
                  active === i ? "text-snow" : "text-cloud"
                }`}>
                  {layer.title}
                </p>
              </div>
            </motion.button>
          ))}
        </div>

        {/* Detail panel — right column */}
        <motion.div
          key={active}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="lg:col-span-8"
        >
          <div className="terminal h-full">
            <div className="terminal-bar">
              <div className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]/80" />
              <div className="h-2.5 w-2.5 rounded-full bg-[#febc2e]/80" />
              <div className="h-2.5 w-2.5 rounded-full bg-[#28c840]/80" />
              <span className="ml-3 font-mono text-[11px] text-ash">{current.title.toLowerCase()}</span>
              <span className="ml-auto rounded bg-accent/10 px-2 py-0.5 font-mono text-[10px] font-medium text-accent">
                {current.tag.toLowerCase()}
              </span>
            </div>

            <div className="p-6">
              <div className="mb-6 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10 text-accent">
                  <FontAwesomeIcon icon={current.icon} className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-snow">{current.title}</h3>
                </div>
              </div>

              <p className="mb-6 text-[13px] leading-relaxed text-smoke">
                {current.description}
              </p>

              <div className="space-y-3">
                {current.visual.map((v) => (
                  <div key={v.label} className="rounded-lg border border-edge bg-void/60 p-3">
                    <span className="mb-1.5 block font-mono text-[10px] font-semibold text-ash uppercase tracking-wider">
                      {v.label}
                    </span>
                    <code className={`font-mono text-[12px] ${
                      v.style === "accent" ? "text-accent" : "text-ember"
                    }`}>
                      {v.value}
                    </code>
                  </div>
                ))}
              </div>

              {/* Progress indicator */}
              <div className="mt-6 flex items-center gap-2">
                {layers.map((_, i) => (
                  <div
                    key={i}
                    className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
                      i <= active ? "bg-accent/40" : "bg-edge"
                    }`}
                  />
                ))}
                <span className="ml-2 font-mono text-[10px] text-ash">
                  {active + 1}/{layers.length}
                </span>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
