export function progressPercent(total: number, current: number) {
  if (total === 0 && current === 0) return 0;
  return Number(((current / total) * 100).toFixed(2));
}

export class Counter {
  protected value = 0;
  constructor(protected maxValue: number = 4_294_967_295) {}
  next() {
    if (this.maxValue && this.value >= this.maxValue) this.value = 0;
    return ++this.value;
  }
}
