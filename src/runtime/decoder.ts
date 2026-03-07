/**
 * RC4 cipher and base64 codec — used for bytecode encryption.
 *
 * Both a runtime source generator (for embedding in the VM IIFE) and
 * native TypeScript implementations (for build-time encryption) are
 * provided.
 *
 * @module runtime/decoder
 */

import type { RuntimeNames } from "./names.js";

// ---------------------------------------------------------------------------
// Runtime source generation (injected into the VM IIFE)
// ---------------------------------------------------------------------------

/** Generate minified RC4 + base64-decode functions for the runtime. */
export function generateDecoderSource(names: RuntimeNames): string {
  return `
function ${names.rc4}(data,key){var S=new Array(256);var j=0;var i;for(i=0;i<256;i++)S[i]=i;for(i=0;i<256;i++){j=(j+S[i]+key.charCodeAt(i%key.length))&255;var t=S[i];S[i]=S[j];S[j]=t;}i=0;j=0;var out=new Uint8Array(data.length);for(var k=0;k<data.length;k++){i=(i+1)&255;j=(j+S[i])&255;var t=S[i];S[i]=S[j];S[j]=t;out[k]=data[k]^S[(S[i]+S[j])&255];}return out;}
function ${names.b64}(str){if(typeof atob==='function'){var bin=atob(str);var bytes=new Uint8Array(bin.length);for(var i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);return bytes;}else{return new Uint8Array(Buffer.from(str,'base64'));};}
`.trim();
}

// ---------------------------------------------------------------------------
// String constant decoder (XOR with LCG key stream)
// ---------------------------------------------------------------------------

/**
 * Generate the runtime string decoder function.
 *
 * Decodes XOR-encoded constant pool strings at load time.
 *
 * When `implicitKey` is true, the function accepts the key as a
 * parameter (derived at load time from unit metadata by the caller).
 * Otherwise the key is embedded as a numeric literal.
 */
export function generateStringDecoderSource(names: RuntimeNames, key: number, implicitKey: boolean = false): string {
  if (implicitKey) {
    // Key is passed as first argument by the loader
    return `function ${names.strDec}(mk,b,x){var k=(mk^(x*0x9E3779B9))>>>0;var s='';for(var i=0;i<b.length;i++){k=(k*1664525+1013904223)>>>0;s+=String.fromCharCode(b[i]^(k&65535));}return s;}`;
  }
  return `function ${names.strDec}(b,x){var k=(${key >>> 0}^(x*0x9E3779B9))>>>0;var s='';for(var i=0;i<b.length;i++){k=(k*1664525+1013904223)>>>0;s+=String.fromCharCode(b[i]^(k&65535));}return s;}`;
}

// ---------------------------------------------------------------------------
// Build-time implementations
// ---------------------------------------------------------------------------

/** RC4 stream cipher — symmetric encrypt / decrypt. */
export function rc4(data: Uint8Array, key: string): Uint8Array {
  const S = new Array<number>(256);
  let j = 0;

  for (let i = 0; i < 256; i++) S[i] = i;
  for (let i = 0; i < 256; i++) {
    j = (j + S[i]! + key.charCodeAt(i % key.length)) & 255;
    const t = S[i]!;
    S[i] = S[j]!;
    S[j] = t;
  }

  let ii = 0;
  j = 0;
  const out = new Uint8Array(data.length);
  for (let k = 0; k < data.length; k++) {
    ii = (ii + 1) & 255;
    j = (j + S[ii]!) & 255;
    const t = S[ii]!;
    S[ii] = S[j]!;
    S[j] = t;
    out[k] = data[k]! ^ S[(S[ii]! + S[j]!) & 255]!;
  }
  return out;
}

/** Base64-encode a byte array (works in both Node.js and browsers). */
export function b64encode(data: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(data).toString("base64");
  }
  let binary = "";
  for (let i = 0; i < data.length; i++) {
    binary += String.fromCharCode(data[i]!);
  }
  return btoa(binary);
}
