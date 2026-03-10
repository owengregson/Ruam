/**
 * RC4 cipher and base64 codec — used for bytecode encryption.
 *
 * Both a runtime source generator (for embedding in the VM IIFE) and
 * native TypeScript implementations (for build-time encryption) are
 * provided.
 *
 * @module runtime/decoder
 */

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
