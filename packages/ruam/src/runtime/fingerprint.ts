/**
 * Environment fingerprinting for bytecode encryption.
 *
 * Generates a deterministic hash from the host engine's built-in function
 * `.length` properties.  This produces a value that is the same for a
 * given JS engine version but differs across engines, providing a weak
 * form of environment binding.
 *
 * @module runtime/fingerprint
 */

// The fingerprint uses an inverted-square-root magic constant as a seed,
// then XORs in the `.length` of several built-in functions at different
// bit positions.  The result is mixed with a Murmur3-style finalizer.

const SEED = 0x5f3759df;

/**
 * Compute the fingerprint at build time (for encrypting bytecode before
 * the runtime exists).
 *
 * Must produce the exact same value as the runtime version.
 */
export function computeFingerprint(): number {
	let h = SEED;
	h ^= Array.prototype.reduce.length << 0x18;
	h ^= String.prototype.charCodeAt.length << 0x14;
	h ^= Math.floor.length << 0x10;
	h ^= Object.keys.length << 0x0c;
	h ^= JSON.stringify.length << 0x08;
	h ^= parseInt.length << 0x04;
	h = (h ^ (h >>> 16)) * 0x45d9f3b;
	h = (h ^ (h >>> 13)) * 0x45d9f3b;
	h = h ^ (h >>> 16);
	return h >>> 0;
}
