/**
 * Browser polyfill for `node:crypto`.
 *
 * Only implements `randomBytes(n)` — the sole Node crypto API used by
 * {@link transform.generateCryptoSeed}. Uses the Web Crypto API
 * (`crypto.getRandomValues`) for entropy.
 *
 * @module browser-crypto-shim
 */

export function randomBytes(size: number): Buffer {
	const buf = new Uint8Array(size);
	crypto.getRandomValues(buf);
	// Return a minimal Buffer-like object with readUInt32LE
	return {
		...buf,
		readUInt32LE(offset = 0) {
			return (
				buf[offset]! |
				(buf[offset + 1]! << 8) |
				(buf[offset + 2]! << 16) |
				((buf[offset + 3]! << 24) >>> 0)
			);
		},
	} as unknown as Buffer;
}
