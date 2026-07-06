import * as THREE from "three";
import threeGeoUrl from "three-geo/dist/three-geo.min.js?url";

export interface ThreeGeoProjection {
  proj: (latlng: [number, number], meshes?: THREE.Object3D[]) => [number, number] | [number, number, number];
  projInv: (x: number, y: number) => [number, number];
  bbox: [number, number, number, number];
  unitsPerMeter: number;
}

export interface ThreeGeoTerrainCallbacks {
  onRgbDem?: (meshes: THREE.Mesh[]) => void;
  onSatelliteMat?: (mesh: THREE.Mesh) => void;
}

export interface ThreeGeoTerrainResult {
  rgbDem?: THREE.Mesh[];
}

export interface ThreeGeoConstructor {
  new (options?: {
    tokenMapbox?: string;
    unitsSide?: number;
    isDebug?: boolean;
  }): {
    getProjection(
      origin: [number, number],
      radius: number,
      unitsSide?: number
    ): ThreeGeoProjection;
    getTerrain(
      origin: [number, number],
      radius: number,
      zoom: number,
      callbacks?: ThreeGeoTerrainCallbacks
    ): Promise<ThreeGeoTerrainResult>;
    getTerrainRgb(
      origin: [number, number],
      radius: number,
      zoom: number
    ): Promise<THREE.Group>;
  };
}

declare global {
  interface Window {
    THREE?: typeof THREE & { PlaneBufferGeometry?: typeof THREE.PlaneGeometry };
    ThreeGeo?: ThreeGeoConstructor;
  }
}

let pending: Promise<ThreeGeoConstructor> | null = null;

export function loadThreeGeo() {
  if (window.ThreeGeo) return Promise.resolve(window.ThreeGeo);
  if (pending) return pending;

  window.THREE = {
    ...THREE,
    PlaneBufferGeometry: THREE.PlaneGeometry,
  };

  pending = new Promise<ThreeGeoConstructor>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = threeGeoUrl;
    script.async = true;
    script.onload = () => {
      if (window.ThreeGeo) {
        resolve(window.ThreeGeo);
      } else {
        reject(new Error("three-geo loaded without exposing window.ThreeGeo"));
      }
    };
    script.onerror = () => reject(new Error("Failed to load three-geo runtime"));
    document.head.appendChild(script);
  });

  return pending;
}
