import { Cartesian3, HeadingPitchRange, Math as CesiumMath, Matrix4, Rectangle } from 'cesium';
import type { Viewer } from 'cesium';
import { MIYAKO_STATION } from '../config/dataSources';
import { meshBbox } from '../data/loadPopulation';
import type { Bbox, MeshFeature } from '../domain/types';

function look(viewer: Viewer, longitude: number, latitude: number, height: number, range: number) {
  viewer.camera.cancelFlight();
  viewer.camera.lookAt(Cartesian3.fromDegrees(longitude, latitude, height), new HeadingPitchRange(CesiumMath.toRadians(10), CesiumMath.toRadians(-42), range));
  viewer.camera.lookAtTransform(Matrix4.IDENTITY);
  viewer.scene.requestRender();
}
export function focusStation(viewer: Viewer) { look(viewer, MIYAKO_STATION.longitude, MIYAKO_STATION.latitude, 0, 2800); }
export function focusAll(viewer: Viewer, bbox: Bbox) {
  viewer.camera.cancelFlight();
  viewer.camera.setView({ destination: Rectangle.fromDegrees(...bbox) });
  viewer.scene.requestRender();
}
export function focusMesh(viewer: Viewer, feature: MeshFeature, baseHeight: number) {
  const [west, south, east, north] = meshBbox(feature);
  look(viewer, (west + east) / 2, (south + north) / 2, baseHeight, 1800);
}
