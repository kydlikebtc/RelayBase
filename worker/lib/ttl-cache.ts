type Entry<T> = { expiresAt: number; value: Promise<T> };

export class TtlCache<T> {
  private readonly entries = new WeakMap<object, Entry<T>>();
  private readonly now: () => number;

  // 参数属性（`constructor(private readonly now)`）需要代码生成，
  // 与 `node --experimental-strip-types` 的纯擦除模式不兼容。
  constructor(now: () => number = () => Date.now()) {
    this.now = now;
  }

  get(key: object): Promise<T> | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry.value;
  }

  delete(key: object): void {
    this.entries.delete(key);
  }

  async remember(
    key: object,
    ttlMs: number,
    compute: () => Promise<T>,
  ): Promise<T> {
    if (ttlMs <= 0) return await compute();
    const cached = this.get(key);
    if (cached) return await cached;
    const value = compute();
    this.entries.set(key, { expiresAt: this.now() + ttlMs, value });
    try {
      return await value;
    } catch (error) {
      this.entries.delete(key);
      throw error;
    }
  }
}

export function parseTtlMs(
  raw: string | undefined,
  fallback: number,
  max: number,
): number {
  if (raw == null || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 0) return fallback;
  return Math.min(max, parsed);
}
