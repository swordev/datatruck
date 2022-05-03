export function progressPercent(total: number, current: number) {
  return Number(((current / total) * 100).toFixed(2));
}
