export function progressPercent(total: number, current: number) {
  if (total === 0 && current === 0) return 0;
  return Number(((current / total) * 100).toFixed(2));
}
