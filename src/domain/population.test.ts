// @vitest-environment node

import { readFileSync } from 'node:fs';
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  CHANGE_STYLES,
  METERS_PER_PERSON,
  changeCategory,
  changeRate,
  columnDimensions,
  formatChangeRate,
  formatPopulation,
  populationDifference,
  populationHeight,
} from './population';
import { YEARS } from './types';
import type { MeshProperties, Population, PopulationCollection } from './types';

type ExpectedCategory =
  | 'large-decrease'
  | 'decrease'
  | 'moderate-decrease'
  | 'small-decrease'
  | 'unchanged'
  | 'increase'
  | 'unavailable';

describe('public API types', () => {
  it('keeps nullable calculations and an exhaustive literal category union', () => {
    expectTypeOf(populationHeight).toEqualTypeOf<(population: Population) => number | null>();
    expectTypeOf(columnDimensions).toEqualTypeOf<
      (baseHeight: number, population: Population) => {
        baseHeight: number;
        length: number;
        extrudedHeight: number;
      } | null
    >();
    expectTypeOf(changeRate).toEqualTypeOf<
      (baseline: Population, future: Population) => number | null
    >();
    expectTypeOf(populationDifference).toEqualTypeOf<typeof changeRate>();
    expectTypeOf(changeCategory).toEqualTypeOf<(rate: number | null) => ExpectedCategory>();
    expectTypeOf<keyof typeof CHANGE_STYLES>().toEqualTypeOf<ExpectedCategory>();
    expectTypeOf(formatPopulation).toEqualTypeOf<(value: Population) => string>();
    expectTypeOf(formatChangeRate).toEqualTypeOf<(value: number | null) => string>();
  });
});

describe('populationHeight', () => {
  it('uses the same 0.5 metres per person for every year', () => {
    expect(METERS_PER_PERSON).toBe(0.5);
  });

  it.each([
    { population: null, height: null },
    { population: 0, height: 0 },
    { population: 100, height: 50 },
    { population: 50, height: 25 },
    { population: 2.767, height: 1.3835 },
    { population: 0.0001, height: 0.00005 },
    { population: 1388.8053, height: 694.40265 },
    { population: 1_000_000, height: 500_000 },
  ])('maps $population to $height without rounding or capping', ({ population, height }) => {
    expect(populationHeight(population)).toBe(height);
  });
});

describe('columnDimensions', () => {
  it.each([-123.4567, -20, 0, 2, 123.4567, 1500, 1_000_000])(
    'halves column length for 100 → 50 people independently of B=%s',
    (baseHeight) => {
      const baseline = columnDimensions(baseHeight, 100);
      const future = columnDimensions(baseHeight, 50);
      expect(baseline).toEqual({ baseHeight, length: 50, extrudedHeight: baseHeight + 50 });
      expect(future).toEqual({ baseHeight, length: 25, extrudedHeight: baseHeight + 25 });
      if (baseline === null || future === null) throw new Error('Expected non-null columns');
      expect(future.length / baseline.length).toBe(0.5);
      expect(changeRate(100, 50)).toBe(-50);
    },
  );

  it.each([-20, 123])(
    'keeps zero population as a selectable plane at B=%s, not as missing data',
    (baseHeight) => {
      expect(columnDimensions(baseHeight, 0)).toEqual({
        baseHeight,
        length: 0,
        extrudedHeight: baseHeight,
      });
      expect(columnDimensions(baseHeight, null)).toBeNull();
    },
  );

  it('preserves fractional length independently from the absolute top height', () => {
    expect(columnDimensions(123.4567, 2.767)).toEqual({
      baseHeight: 123.4567,
      length: 1.3835,
      extrudedHeight: 123.4567 + 1.3835,
    });
  });
});

describe('population comparisons', () => {
  it.each([
    { baseline: 100, future: 50, rate: -50, difference: -50 },
    { baseline: 100, future: 0, rate: -100, difference: -100 },
    { baseline: 100, future: 100, rate: 0, difference: 0 },
    { baseline: 100, future: 150, rate: 50, difference: 50 },
    { baseline: 100, future: 300, rate: 200, difference: 200 },
    { baseline: 0, future: 50, rate: null, difference: 50 },
    { baseline: 0, future: 0, rate: null, difference: 0 },
    { baseline: null, future: 50, rate: null, difference: null },
    { baseline: 100, future: null, rate: null, difference: null },
    { baseline: null, future: 0, rate: null, difference: null },
    { baseline: 0, future: null, rate: null, difference: null },
    { baseline: null, future: null, rate: null, difference: null },
    { baseline: 0.5, future: 0.125, rate: -75, difference: -0.375 },
  ])('compares $baseline → $future', ({ baseline, future, rate, difference }) => {
    expect(changeRate(baseline, future)).toBe(rate);
    expect(populationDifference(baseline, future)).toBe(difference);
  });

  it('does not round small positive populations to zero before calculating', () => {
    expect(changeRate(0.03, 0.01)).toBe(((0.01 - 0.03) / 0.03) * 100);
    expect(populationDifference(0.03, 0.01)).toBe(0.01 - 0.03);
    expect(changeRate(0.0001, 0)).toBe(-100);
    expect(changeRate(0.0001, 0.0001)).toBe(0);
  });
});

describe('changeCategory and CHANGE_STYLES', () => {
  it.each<[number | null, ExpectedCategory]>([
    [null, 'unavailable'],
    [-1000, 'large-decrease'],
    [-100, 'large-decrease'],
    [-75.0001, 'large-decrease'],
    [-75, 'large-decrease'],
    [-74.9999, 'decrease'],
    [-50.0001, 'decrease'],
    [-50, 'decrease'],
    [-49.9999, 'moderate-decrease'],
    [-25.0001, 'moderate-decrease'],
    [-25, 'moderate-decrease'],
    [-24.9999, 'small-decrease'],
    [-0.0001, 'small-decrease'],
    [-Number.MIN_VALUE, 'small-decrease'],
    [-0, 'unchanged'],
    [0, 'unchanged'],
    [Number.MIN_VALUE, 'increase'],
    [25, 'increase'],
    [200, 'increase'],
  ])('classifies raw rate %s as %s', (rate, category) => {
    expect(changeCategory(rate)).toBe(category);
  });

  it('does not use the rounded display rate to select a color', () => {
    const rate = changeRate(100, 25.0001);
    expect(formatChangeRate(rate)).toBe('-75.0%');
    expect(changeCategory(rate)).toBe('decrease');
  });

  it('fixes hex colors and explanatory labels for all seven categories', () => {
    expect(CHANGE_STYLES).toEqual({
      'large-decrease': { color: '#b91c1c', label: '減少（75%以上）' },
      decrease: { color: '#ea580c', label: '減少（50%以上75%未満）' },
      'moderate-decrease': { color: '#fdba74', label: '減少（25%以上50%未満）' },
      'small-decrease': { color: '#facc15', label: '減少（0%超25%未満）' },
      unchanged: { color: '#9ca3af', label: '変化なし' },
      increase: { color: '#0d9488', label: '増加' },
      unavailable: { color: '#64748b', label: '算出不可 / データなし' },
    });
  });
});

describe('display formatting', () => {
  it.each<[Population, string]>([
    [null, 'データなし'],
    [0, '0人'],
    [-0, '0人'],
    [Number.MIN_VALUE, '0.1人未満'],
    [0.0001, '0.1人未満'],
    [0.05, '0.1人未満'],
    [0.09999, '0.1人未満'],
    [0.1, '0.1人'],
    [1, '1.0人'],
    [2.767, '2.8人'],
    [653.5813, '653.6人'],
    [1388.8053, '1,388.8人'],
  ])('formats population %s as %s', (value, label) => {
    expect(formatPopulation(value)).toBe(label);
  });

  it.each<[number | null, string]>([
    [null, '算出不可'],
    [-100, '-100.0%'],
    [-66.24718302068923, '-66.2%'],
    [-42.23372057921486, '-42.2%'],
    [-0, '0.0%'],
    [0, '0.0%'],
    [12.345, '12.3%'],
    [200, '200.0%'],
  ])('formats signed rate %s as %s', (value, label) => {
    expect(formatChangeRate(value)).toBe(label);
  });
});

const invalidNumbers: { name: string; value: unknown }[] = [
  { name: 'undefined', value: undefined },
  { name: 'numeric string', value: '100' },
  { name: 'empty string', value: '' },
  { name: 'true', value: true },
  { name: 'false', value: false },
  { name: 'object', value: {} },
  { name: 'array', value: [] },
  { name: 'numeric array', value: [100] },
  { name: 'bigint', value: 100n },
  { name: 'symbol', value: Symbol('population') },
  { name: 'NaN', value: Number.NaN },
  { name: 'Infinity', value: Number.POSITIVE_INFINITY },
  { name: '-Infinity', value: Number.NEGATIVE_INFINITY },
];
const invalidPopulations = [
  ...invalidNumbers,
  { name: 'negative integer', value: -1 },
  { name: 'negative fraction', value: -0.0001 },
];

describe('defensive validation', () => {
  it.each(invalidPopulations)('rejects $name as population in every API', ({ value }) => {
    // Deliberately bypass static types to exercise untrusted JavaScript/JSON inputs.
    const invalid = value as Population;
    expect(() => populationHeight(invalid)).toThrow(/population/);
    expect(() => columnDimensions(12, invalid)).toThrow(/population/);
    expect(() => columnDimensions(-20, invalid)).toThrow(/population/);
    expect(() => formatPopulation(invalid)).toThrow(/population/);
    for (const other of [100, 0, null]) {
      for (const compare of [changeRate, populationDifference]) {
        expect(() => compare(invalid, other)).toThrow(/baseline/);
        expect(() => compare(other, invalid)).toThrow(/future/);
      }
    }
  });

  it.each([...invalidNumbers, { name: 'null', value: null }])(
    'rejects $name as baseHeight even when population is missing',
    ({ value }) => {
      for (const population of [100, 0, null]) {
        expect(() => columnDimensions(value as number, population)).toThrow(/baseHeight/);
      }
    },
  );

  it.each(invalidNumbers)('rejects $name as rate, but not valid negative rates', ({ value }) => {
    expect(() => changeCategory(value as number)).toThrow(/rate/);
    expect(() => formatChangeRate(value as number)).toThrow(/rate/);
  });

  it('throws rather than passing overflowed calculations to the renderer', () => {
    expect(() => columnDimensions(Number.MAX_VALUE, Number.MAX_VALUE)).toThrow(RangeError);
    expect(() => changeRate(Number.MIN_VALUE, 1)).toThrow(RangeError);
  });
});

describe('distributed PTN GeoJSON regressions', () => {
  // Read the actual distribution file, independently of the loader being implemented by main.
  const collection = JSON.parse(readFileSync(
    new URL('../../public/data/miyako-population.geojson', import.meta.url),
    'utf8',
  )) as PopulationCollection;

  function populationFor(meshId: string): MeshProperties['population'] {
    const feature = collection.features.find((item) => item.properties.meshId === meshId);
    if (!feature) throw new Error(`Missing distributed mesh ${meshId}`);
    expect(feature.id).toBe(meshId);
    return feature.properties.population;
  }

  it('keeps all 692 real meshes and 11 years, with valid 2020 self-comparisons at 0%', () => {
    expect(collection.type).toBe('FeatureCollection');
    expect(collection.features).toHaveLength(692);
    expect(new Set(collection.features.map((feature) => feature.id)).size).toBe(692);
    expect(YEARS).toEqual([2020, 2025, 2030, 2035, 2040, 2045, 2050, 2055, 2060, 2065, 2070]);
    for (const feature of collection.features) {
      const population = feature.properties.population;
      expect(Object.keys(population)).toEqual(YEARS.map(String));
      const baseline = population[2020];
      const rate = changeRate(baseline, baseline);
      expect(rate).toBe(baseline === null || baseline === 0 ? null : 0);
      expect(changeCategory(rate)).toBe(rate === null ? 'unavailable' : 'unchanged');
      for (const year of YEARS) {
        const raw = population[year];
        expect(populationHeight(raw)).toBe(raw === null ? null : raw * 0.5);
      }
    }
  });

  it('uses 594115541 PTN_2030=2.767, never the suppressed PT00_2030=0', () => {
    const population = populationFor('594115541');
    expect(population[2020]).toBe(5.03);
    expect(population[2030]).toBe(2.767);
    expect(populationHeight(population[2030])).toBe(1.3835);
    expect(populationDifference(population[2020], population[2030])).toBe(2.767 - 5.03);
    const rate = changeRate(population[2020], population[2030]);
    expect(rate).toBe(-44.99005964214712);
    expect(changeCategory(rate)).toBe('moderate-decrease');
    expect(formatPopulation(population[2030])).toBe('2.8人');
    expect(formatChangeRate(rate)).toBe('-45.0%');
  });

  it('preserves every raw year of the Miyako station mesh 594137654', () => {
    expect(populationFor('594137654')).toEqual({
      2020: 653.5813,
      2025: 617.8983,
      2030: 575.8538,
      2035: 527.6612,
      2040: 476.2239,
      2045: 424.8078,
      2050: 377.5496,
      2055: 335.155,
      2060: 294.9536,
      2065: 256.6828,
      2070: 220.6021,
    });
  });

  it.each([
    { year: 2050, height: 188.7748, rate: -42.23372057921486, label: '-42.2%' },
    { year: 2070, height: 110.30105, rate: -66.24718302068923, label: '-66.2%' },
  ] as const)('computes station $year from raw values, rounding only labels', (expected) => {
    const population = populationFor('594137654');
    const baseline = population[2020];
    const future = population[expected.year];
    if (baseline === null || future === null) throw new Error('Expected station populations');
    expect(populationHeight(baseline)).toBe(326.79065);
    expect(populationHeight(future)).toBe(expected.height);
    expect(populationDifference(baseline, future)).toBe(future - baseline);
    const rate = changeRate(baseline, future);
    expect(rate).toBe(expected.rate);
    expect(formatChangeRate(rate)).toBe(expected.label);
    expect(rate).not.toBe(changeRate(Number(baseline.toFixed(1)), Number(future.toFixed(1))));
  });

  it('keeps a real sub-0.1 population positive instead of displaying zero', () => {
    const population = populationFor('594115941')[2055];
    expect(population).toBe(0.0006);
    expect(populationHeight(population)).toBe(0.0003);
    expect(formatPopulation(population)).toBe('0.1人未満');
  });
});
