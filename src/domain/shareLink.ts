import { YEARS, type PopulationDataset, type Year } from './types';

export const DEFAULT_YEAR: Year = 2050;
export const DEFAULT_MESH_ID = '594137654';
export type SharedView = { year: Year; meshId: string };

export function readSharedView(search: string): SharedView {
  const params = new URLSearchParams(search);
  // Ambiguous repeated parameters fall back just like missing/invalid values.
  const year = params.getAll('year').length === 1 ? params.get('year') : null;
  const meshId = params.getAll('mesh').length === 1 ? params.get('mesh') : null;
  return {
    year: YEARS.find((candidate) => String(candidate) === year) ?? DEFAULT_YEAR,
    meshId: meshId || DEFAULT_MESH_ID,
  };
}

export function resolveSharedMesh(meshId: string, byId?: PopulationDataset['byId']): string {
  return byId?.has(meshId) ? meshId : DEFAULT_MESH_ID;
}

export function sharedViewUrl(href: string, view: SharedView): string {
  const url = new URL(href);
  url.searchParams.set('year', String(view.year));
  url.searchParams.set('mesh', view.meshId);
  return url.href;
}
