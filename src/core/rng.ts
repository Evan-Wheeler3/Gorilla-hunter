/** Small seeded PRNG (mulberry32): deterministic world generation and finisher picks. */
export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Integer in [0, max). */
  int(max: number): number {
    return Math.floor(this.next() * max);
  }

  /** A fresh 31-bit seed for a dependent generator. */
  seed(): number {
    return Math.floor(this.next() * 0x7fffffff);
  }
}
