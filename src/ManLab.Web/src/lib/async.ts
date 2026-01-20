/**
 * Small async helpers used across the dashboard.
 */

export async function mapWithConcurrency<TIn, TOut>(
  items: readonly TIn[],
  mapper: (item: TIn, index: number) => Promise<TOut>,
  opts?: { concurrency?: number }
): Promise<TOut[]> {
  const concurrency = Math.max(1, Math.min(32, opts?.concurrency ?? 6));
  if (items.length === 0) return [];

  const results: TOut[] = new Array(items.length);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  });

  await Promise.all(workers);
  return results;
}
