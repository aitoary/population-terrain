import type { Population } from './types';

export const METERS_PER_PERSON = 0.5;

export type ChangeCategory =
  | 'large-decrease'
  | 'decrease'
  | 'moderate-decrease'
  | 'small-decrease'
  | 'unchanged'
  | 'increase'
  | 'unavailable';

// 地図と凡例で同じ増減区分を示せるよう、色と表示名を一箇所で定義する。
export const CHANGE_STYLES = {
  'large-decrease': { color: '#b91c1c', label: '減少（75%以上）' },
  decrease: { color: '#ea580c', label: '減少（50%以上75%未満）' },
  'moderate-decrease': { color: '#fdba74', label: '減少（25%以上50%未満）' },
  'small-decrease': { color: '#facc15', label: '減少（0%超25%未満）' },
  unchanged: { color: '#9ca3af', label: '変化なし' },
  increase: { color: '#0d9488', label: '増加' },
  unavailable: { color: '#64748b', label: '算出不可 / データなし' },
} as const satisfies Record<ChangeCategory, { color: string; label: string }>;

const populationFormatter = new Intl.NumberFormat('ja-JP', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

function assertFiniteNumber(value: unknown, name: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number`);
  }
}

function assertNonNegativeNumber(value: unknown, name: string): asserts value is number {
  assertFiniteNumber(value, name);
  if (value < 0) throw new RangeError(`${name} must be non-negative`);
}

function assertPopulation(value: unknown, name: string): asserts value is Population {
  if (value !== null) assertNonNegativeNumber(value, name);
}

export function populationHeight(population: Population): number | null {
  assertPopulation(population, 'population');
  return population === null ? null : population * METERS_PER_PERSON;
}

export function columnDimensions(
  baseHeight: number,
  population: Population,
): { baseHeight: number; length: number; extrudedHeight: number } | null {
  // 楕円体高は負にもなるため、非負の制約は人口にだけ適用する。
  assertFiniteNumber(baseHeight, 'baseHeight');
  const length = populationHeight(population);
  if (length === null) return null;

  const extrudedHeight = baseHeight + length;
  if (!Number.isFinite(extrudedHeight)) {
    throw new RangeError('extrudedHeight exceeds the finite number range');
  }
  return { baseHeight, length, extrudedHeight };
}

export function changeRate(baseline: Population, future: Population): number | null {
  // 算出不可として早期終了する場合も、不正な入力値は見逃さない。
  assertPopulation(baseline, 'baseline');
  assertPopulation(future, 'future');
  if (baseline === null || future === null || baseline === 0) return null;

  const rate = ((future - baseline) / baseline) * 100;
  if (!Number.isFinite(rate)) {
    throw new RangeError('changeRate exceeds the finite number range');
  }
  return rate;
}

export function populationDifference(baseline: Population, future: Population): number | null {
  assertPopulation(baseline, 'baseline');
  assertPopulation(future, 'future');
  return baseline === null || future === null ? null : future - baseline;
}

export function changeCategory(rate: number | null): ChangeCategory {
  if (rate === null) return 'unavailable';
  assertFiniteNumber(rate, 'rate');
  if (rate <= -75) return 'large-decrease';
  if (rate <= -50) return 'decrease';
  if (rate <= -25) return 'moderate-decrease';
  if (rate < 0) return 'small-decrease';
  if (rate === 0) return 'unchanged';
  return 'increase';
}

export function formatPopulation(value: Population): string {
  assertPopulation(value, 'population');
  if (value === null) return 'データなし';
  if (value === 0) return '0人';
  if (value < 0.1) return '0.1人未満';
  return `${populationFormatter.format(value)}人`;
}

export function formatChangeRate(value: number | null): string {
  if (value === null) return '算出不可';
  assertFiniteNumber(value, 'rate');
  return `${value.toFixed(1)}%`;
}
