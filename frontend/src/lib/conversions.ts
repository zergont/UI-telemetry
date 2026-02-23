export function fahrenheitToCelsius(f: number): number {
  return Math.round(((f - 32) * 5) / 9 * 10) / 10;
}

export function secondsToMotohours(s: number): number {
  return Math.round((s / 3600) * 10) / 10;
}

export function kpaToBar(kpa: number): number {
  return Math.round((kpa / 100) * 100) / 100;
}
