/**
 * Registry of mixer parameters currently driven by pre-scheduled audio automation
 * (AI transitions). The store still updates (so knobs move on screen) but the
 * engine bridge must not re-apply those values on top of the schedule.
 */
const automated = new Set<string>();

export const autoKey = (deck: number | 'x', param: string): string => `${deck}.${param}`;

export const automation = {
  add(key: string): void {
    automated.add(key);
  },
  remove(key: string): void {
    automated.delete(key);
  },
  has(key: string): boolean {
    return automated.has(key);
  },
  clear(): void {
    automated.clear();
  },
};
