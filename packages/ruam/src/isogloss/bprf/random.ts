/** Deterministic, non-cryptographic entropy used only by the BPRF generator. */
export class BprfRandom {
	private state: number;

	constructor(seed: number) {
		this.state = mix32(seed >>> 0);
	}

	nextUint32(): number {
		let value = this.state;
		value ^= value << 13;
		value ^= value >>> 17;
		value ^= value << 5;
		this.state = value >>> 0;
		return this.state;
	}

	int(minInclusive: number, maxExclusive: number): number {
		if (maxExclusive <= minInclusive) {
			throw new Error("RUAM_BPRF_INVALID_RANDOM_RANGE");
		}
		return (
			minInclusive +
			(this.nextUint32() % (maxExclusive - minInclusive))
		);
	}

	nonZeroInt(magnitude: number): number {
		const absolute = this.int(1, magnitude + 1);
		return (this.nextUint32() & 1) === 0 ? absolute : -absolute;
	}

	shuffle<T>(values: readonly T[]): T[] {
		const result = values.slice();
		for (let index = result.length - 1; index > 0; index--) {
			const swapIndex = this.int(0, index + 1);
			[result[index], result[swapIndex]] = [
				result[swapIndex]!,
				result[index]!,
			];
		}
		return result;
	}
}

export function mix32(value: number): number {
	let mixed = value >>> 0;
	mixed = Math.imul(mixed ^ (mixed >>> 16), 0x7feb352d);
	mixed = Math.imul(mixed ^ (mixed >>> 15), 0x846ca68b);
	return (mixed ^ (mixed >>> 16)) >>> 0;
}

export function hashText(value: string, seed = 0x811c9dc5): number {
	let hash = seed >>> 0;
	for (let index = 0; index < value.length; index++) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return mix32(hash);
}

export function opaqueId(prefix: string, random: BprfRandom): string {
	return `${prefix}${random.nextUint32().toString(36)}${random
		.nextUint32()
		.toString(36)}`;
}
