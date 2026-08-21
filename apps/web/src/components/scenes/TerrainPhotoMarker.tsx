import { Billboard } from "@react-three/drei";
import { extend, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { loadMaterialSymbols } from "../../modules/iconLoader";

class FlowerPhotoMaterial extends THREE.ShaderMaterial {
  constructor() {
    super({
      uniforms: {
        photoMap: { value: null },
        flowerOpacity: { value: 1 },
        brightness: { value: 1 },
        contrast: { value: 1 },
        saturation: { value: 1 },
        petalCount: { value: 10 },
        borderColor: { value: new THREE.Color("#ffffff") },
        borderWidth: { value: 0.12 },
        imageAspect: { value: 1 },
      },
      vertexShader: `
        varying vec2 vUv;

        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D photoMap;
        uniform float flowerOpacity;
        uniform float brightness;
        uniform float contrast;
        uniform float saturation;
        uniform float petalCount;
        uniform vec3 borderColor;
        uniform float borderWidth;
        uniform float imageAspect;
        varying vec2 vUv;

        vec4 applyCssLikeAdjustments(vec4 linearColor, float brightnessValue, float contrastValue, float saturationValue) {
          vec4 displayColor = sRGBTransferOETF(linearColor);
          displayColor.rgb = (displayColor.rgb - 0.5) * contrastValue + 0.5;
          displayColor.rgb *= brightnessValue;
          float luma = dot(displayColor.rgb, vec3(0.2126, 0.7152, 0.0722));
          displayColor.rgb = mix(vec3(luma), displayColor.rgb, saturationValue);
          displayColor.rgb = clamp(displayColor.rgb, 0.0, 1.0);
          return sRGBTransferEOTF(displayColor);
        }

        void main() {
          vec2 centered = vUv * 2.0 - 1.0;
          centered.y *= -1.0;
          float distanceFromCenter = length(centered);
          float angle = atan(centered.y, centered.x);
          float petalWave = (1.0 + cos(angle * petalCount)) * 0.5;
          float flowerRadius = 0.76 + petalWave * 0.24;
          float edge = flowerRadius - distanceFromCenter;
          float alpha = smoothstep(-0.006, 0.006, edge);

          if (alpha < 0.02) discard;

          vec2 photoUv = vUv;
          if (imageAspect > 1.0) {
            photoUv.x = (photoUv.x - 0.5) / imageAspect + 0.5;
          } else {
            photoUv.y = (photoUv.y - 0.5) * imageAspect + 0.5;
          }

          vec4 color = texture2D(photoMap, photoUv);
          color = applyCssLikeAdjustments(color, brightness, contrast, saturation);
          float borderMix = 1.0 - smoothstep(0.0, borderWidth, edge);
          vec3 finalColor = mix(color.rgb, borderColor, borderMix);
          gl_FragColor = vec4(finalColor, color.a * alpha * flowerOpacity);
          #include <colorspace_fragment>
        }
      `,
    });
  }

  get photoMap() {
    return this.uniforms.photoMap.value as THREE.Texture | null;
  }

  set photoMap(value: THREE.Texture | null) {
    this.uniforms.photoMap.value = value;
  }

  get flowerOpacity() {
    return this.uniforms.flowerOpacity.value as number;
  }

  set flowerOpacity(value: number) {
    this.uniforms.flowerOpacity.value = value;
  }

  get brightness() {
    return this.uniforms.brightness.value as number;
  }

  set brightness(value: number) {
    this.uniforms.brightness.value = value;
  }

  get contrast() {
    return this.uniforms.contrast.value as number;
  }

  set contrast(value: number) {
    this.uniforms.contrast.value = value;
  }

  get saturation() {
    return this.uniforms.saturation.value as number;
  }

  set saturation(value: number) {
    this.uniforms.saturation.value = value;
  }

  get petalCount() {
    return this.uniforms.petalCount.value as number;
  }

  set petalCount(value: number) {
    this.uniforms.petalCount.value = value;
  }

  get borderColor() {
    return this.uniforms.borderColor.value as THREE.Color;
  }

  set borderColor(value: THREE.Color | string | number) {
    this.uniforms.borderColor.value = value instanceof THREE.Color ? value : new THREE.Color(value);
  }

  get borderWidth() {
    return this.uniforms.borderWidth.value as number;
  }

  set borderWidth(value: number) {
    this.uniforms.borderWidth.value = value;
  }

  get imageAspect() {
    return this.uniforms.imageAspect.value as number;
  }

  set imageAspect(value: number) {
    this.uniforms.imageAspect.value = value;
  }
}

class AdjustedPhotoMaterial extends THREE.ShaderMaterial {
  constructor() {
    super({
      uniforms: {
        photoMap: { value: null },
        brightness: { value: 1 },
        contrast: { value: 1 },
        saturation: { value: 1 },
      },
      vertexShader: `
        varying vec2 vUv;

        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D photoMap;
        uniform float brightness;
        uniform float contrast;
        uniform float saturation;
        varying vec2 vUv;

        vec4 applyCssLikeAdjustments(vec4 linearColor, float brightnessValue, float contrastValue, float saturationValue) {
          vec4 displayColor = sRGBTransferOETF(linearColor);
          displayColor.rgb = (displayColor.rgb - 0.5) * contrastValue + 0.5;
          displayColor.rgb *= brightnessValue;
          float luma = dot(displayColor.rgb, vec3(0.2126, 0.7152, 0.0722));
          displayColor.rgb = mix(vec3(luma), displayColor.rgb, saturationValue);
          displayColor.rgb = clamp(displayColor.rgb, 0.0, 1.0);
          return sRGBTransferEOTF(displayColor);
        }

        void main() {
          vec4 color = texture2D(photoMap, vUv);
          color = applyCssLikeAdjustments(color, brightness, contrast, saturation);
          gl_FragColor = color;
          #include <colorspace_fragment>
        }
      `,
    });
  }

  get photoMap() {
    return this.uniforms.photoMap.value as THREE.Texture | null;
  }

  set photoMap(value: THREE.Texture | null) {
    this.uniforms.photoMap.value = value;
  }

  get brightness() {
    return this.uniforms.brightness.value as number;
  }

  set brightness(value: number) {
    this.uniforms.brightness.value = value;
  }

  get contrast() {
    return this.uniforms.contrast.value as number;
  }

  set contrast(value: number) {
    this.uniforms.contrast.value = value;
  }

  get saturation() {
    return this.uniforms.saturation.value as number;
  }

  set saturation(value: number) {
    this.uniforms.saturation.value = value;
  }
}

class OrbitingCutoutPhotoMaterial extends THREE.ShaderMaterial {
  constructor() {
    super({
      uniforms: {
        photoMap: { value: null },
        brightness: { value: 1 },
        contrast: { value: 1 },
        saturation: { value: 1 },
        cardAspect: { value: 1 },
        cornerBottomLeft: { value: new THREE.Vector2(0.08, 0.08) },
        cornerBottomRight: { value: new THREE.Vector2(0.92, 0.08) },
        cornerTopRight: { value: new THREE.Vector2(0.92, 0.92) },
        cornerTopLeft: { value: new THREE.Vector2(0.08, 0.92) },
        shapeMode: { value: 0 },
        imageAspect: { value: 1 },
        indicatorMix: { value: 0 },
        indicatorShade: { value: 0 },
        borderColor: { value: new THREE.Color("#ffffff") },
        borderWidth: { value: 0.04 },
        dashLength: { value: 0.11 },
        dashGap: { value: 0.065 },
      },
      vertexShader: `
        varying vec2 vUv;

        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D photoMap;
        uniform float brightness;
        uniform float contrast;
        uniform float saturation;
        uniform float cardAspect;
        uniform vec2 cornerBottomLeft;
        uniform vec2 cornerBottomRight;
        uniform vec2 cornerTopRight;
        uniform vec2 cornerTopLeft;
        uniform float shapeMode;
        uniform float imageAspect;
        uniform float indicatorMix;
        uniform float indicatorShade;
        uniform vec3 borderColor;
        uniform float borderWidth;
        uniform float dashLength;
        uniform float dashGap;
        varying vec2 vUv;

        vec4 applyCssLikeAdjustments(vec4 linearColor, float brightnessValue, float contrastValue, float saturationValue) {
          vec4 displayColor = sRGBTransferOETF(linearColor);
          displayColor.rgb = (displayColor.rgb - 0.5) * contrastValue + 0.5;
          displayColor.rgb *= brightnessValue;
          float luma = dot(displayColor.rgb, vec3(0.2126, 0.7152, 0.0722));
          displayColor.rgb = mix(vec3(luma), displayColor.rgb, saturationValue);
          displayColor.rgb = clamp(displayColor.rgb, 0.0, 1.0);
          return sRGBTransferEOTF(displayColor);
        }

        vec2 metricPoint(vec2 point) {
          return vec2(point.x * cardAspect, point.y);
        }

        float signedEdgeDistance(vec2 point, vec2 start, vec2 end) {
          vec2 edge = end - start;
          return (edge.x * (point.y - start.y) - edge.y * (point.x - start.x)) / max(length(edge), 0.0001);
        }

        float edgePosition(vec2 point, vec2 start, vec2 end) {
          vec2 edge = end - start;
          return clamp(dot(point - start, edge) / max(dot(edge, edge), 0.0001), 0.0, 1.0);
        }

        void main() {
          float edgeDistance;
          float borderMask;
          float cutoutAlpha;
          float dashMask = 1.0;

          if (shapeMode > 0.5) {
            vec2 centered = vUv * 2.0 - 1.0;
            edgeDistance = 0.88 - length(centered);
            float circleAngle = atan(centered.y, centered.x) + 3.14159265;
            float circleDistance = (circleAngle / 6.2831853) * (2.0 * 3.14159265 * 0.88);
            float circleDashPeriod = dashLength + dashGap;
            dashMask = 1.0 - step(dashLength, mod(circleDistance, circleDashPeriod));
          } else {
          vec2 point = metricPoint(vUv);
          vec2 bottomLeft = metricPoint(cornerBottomLeft);
          vec2 bottomRight = metricPoint(cornerBottomRight);
          vec2 topRight = metricPoint(cornerTopRight);
          vec2 topLeft = metricPoint(cornerTopLeft);

          float distanceBottom = signedEdgeDistance(point, bottomLeft, bottomRight);
          float distanceRight = signedEdgeDistance(point, bottomRight, topRight);
          float distanceTop = signedEdgeDistance(point, topRight, topLeft);
          float distanceLeft = signedEdgeDistance(point, topLeft, bottomLeft);
          edgeDistance = min(min(distanceBottom, distanceRight), min(distanceTop, distanceLeft));

          float edgeIndex = 0.0;
          float nearestDistance = distanceBottom;
          if (distanceRight < nearestDistance) {
            nearestDistance = distanceRight;
            edgeIndex = 1.0;
          }
          if (distanceTop < nearestDistance) {
            nearestDistance = distanceTop;
            edgeIndex = 2.0;
          }
          if (distanceLeft < nearestDistance) {
            edgeIndex = 3.0;
          }

          vec2 edgeStart = bottomLeft;
          vec2 edgeEnd = bottomRight;
          if (edgeIndex == 1.0) {
            edgeStart = bottomRight;
            edgeEnd = topRight;
          } else if (edgeIndex == 2.0) {
            edgeStart = topRight;
            edgeEnd = topLeft;
          } else if (edgeIndex == 3.0) {
            edgeStart = topLeft;
            edgeEnd = bottomLeft;
          }

          float alongEdge = edgePosition(point, edgeStart, edgeEnd) * length(edgeEnd - edgeStart);
          float dashPeriod = dashLength + dashGap;
          dashMask = 1.0 - step(dashLength, mod(alongEdge, dashPeriod));
          }

          float edgeAA = max(fwidth(edgeDistance), 0.002);
          borderMask = (1.0 - smoothstep(borderWidth, borderWidth + edgeAA, edgeDistance)) * dashMask;
          cutoutAlpha = smoothstep(-edgeAA, edgeAA, edgeDistance);

          vec2 photoUv = vUv;
          if (shapeMode > 0.5) {
            if (imageAspect > 1.0) {
              photoUv.x = (photoUv.x - 0.5) / imageAspect + 0.5;
            } else {
              photoUv.y = (photoUv.y - 0.5) * imageAspect + 0.5;
            }
          }
          vec4 color = texture2D(photoMap, photoUv);
          color = applyCssLikeAdjustments(color, brightness, contrast, saturation);
          vec3 indicatorColor = borderColor * (1.0 - indicatorShade);
          color.rgb = mix(color.rgb, indicatorColor, indicatorMix);
          color.a = mix(color.a, 1.0, indicatorMix);
          color.rgb = mix(color.rgb, borderColor, borderMask);
          if (cutoutAlpha < 0.05) discard;
          gl_FragColor = vec4(color.rgb, color.a * cutoutAlpha);
          #include <colorspace_fragment>
        }
      `,
    });
  }

  get photoMap() { return this.uniforms.photoMap.value as THREE.Texture | null; }
  set photoMap(value: THREE.Texture | null) { this.uniforms.photoMap.value = value; }
  get brightness() { return this.uniforms.brightness.value as number; }
  set brightness(value: number) { this.uniforms.brightness.value = value; }
  get contrast() { return this.uniforms.contrast.value as number; }
  set contrast(value: number) { this.uniforms.contrast.value = value; }
  get saturation() { return this.uniforms.saturation.value as number; }
  set saturation(value: number) { this.uniforms.saturation.value = value; }
  get shapeMode() { return this.uniforms.shapeMode.value as number; }
  set shapeMode(value: number) { this.uniforms.shapeMode.value = value; }
  get imageAspect() { return this.uniforms.imageAspect.value as number; }
  set imageAspect(value: number) { this.uniforms.imageAspect.value = value; }
  get indicatorMix() { return this.uniforms.indicatorMix.value as number; }
  set indicatorMix(value: number) { this.uniforms.indicatorMix.value = value; }
  get indicatorShade() { return this.uniforms.indicatorShade.value as number; }
  set indicatorShade(value: number) { this.uniforms.indicatorShade.value = value; }
  get cardAspect() { return this.uniforms.cardAspect.value as number; }
  set cardAspect(value: number) { this.uniforms.cardAspect.value = value; }
  get cornerBottomLeft() { return this.uniforms.cornerBottomLeft.value as THREE.Vector2; }
  set cornerBottomLeft(value: THREE.Vector2) { this.uniforms.cornerBottomLeft.value = value; }
  get cornerBottomRight() { return this.uniforms.cornerBottomRight.value as THREE.Vector2; }
  set cornerBottomRight(value: THREE.Vector2) { this.uniforms.cornerBottomRight.value = value; }
  get cornerTopRight() { return this.uniforms.cornerTopRight.value as THREE.Vector2; }
  set cornerTopRight(value: THREE.Vector2) { this.uniforms.cornerTopRight.value = value; }
  get cornerTopLeft() { return this.uniforms.cornerTopLeft.value as THREE.Vector2; }
  set cornerTopLeft(value: THREE.Vector2) { this.uniforms.cornerTopLeft.value = value; }
  get borderColor() { return this.uniforms.borderColor.value as THREE.Color; }
  set borderColor(value: THREE.Color | string | number) {
    this.uniforms.borderColor.value = value instanceof THREE.Color ? value : new THREE.Color(value);
  }
  get borderWidth() { return this.uniforms.borderWidth.value as number; }
  set borderWidth(value: number) { this.uniforms.borderWidth.value = value; }
  get dashLength() { return this.uniforms.dashLength.value as number; }
  set dashLength(value: number) { this.uniforms.dashLength.value = value; }
  get dashGap() { return this.uniforms.dashGap.value as number; }
  set dashGap(value: number) { this.uniforms.dashGap.value = value; }
}

class OrbitingActivityRingMaterial extends THREE.ShaderMaterial {
  constructor() {
    super({
      uniforms: {
        ringColour: { value: new THREE.Color("#ffffff") },
        ringOpacity: { value: 0.72 },
        innerRadius: { value: 1 },
        outerRadius: { value: 1.02 },
        gapMask: { value: null },
        noiseCells: { value: 12 },
        noiseAmplitude: { value: 0.035 },
        noiseTimeScale: { value: 0.5 },
        time: { value: 0 },
      },
      vertexShader: `
        uniform float innerRadius;
        uniform float outerRadius;
        uniform float noiseCells;
        uniform float noiseAmplitude;
        uniform float noiseTimeScale;
        uniform float time;
        varying float vNoise;
        varying float vRadius;
        varying float vAngleUv;

        float hash(vec2 point) {
          return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453);
        }

        vec2 gradient(vec2 point) {
          float angle = hash(point) * 6.2831853;
          return vec2(cos(angle), sin(angle));
        }

        float periodicPerlin(vec2 point, float periodX) {
          vec2 cell = floor(point);
          vec2 local = fract(point);
          vec2 bottomLeft = vec2(mod(cell.x, periodX), cell.y);
          vec2 bottomRight = vec2(mod(cell.x + 1.0, periodX), cell.y);
          vec2 topLeft = vec2(mod(cell.x, periodX), cell.y + 1.0);
          vec2 topRight = vec2(mod(cell.x + 1.0, periodX), cell.y + 1.0);
          float fadeX = local.x * local.x * (3.0 - 2.0 * local.x);
          float fadeY = local.y * local.y * (3.0 - 2.0 * local.y);
          float bottomLeftValue = dot(gradient(bottomLeft), local);
          float bottomRightValue = dot(gradient(bottomRight), local - vec2(1.0, 0.0));
          float topLeftValue = dot(gradient(topLeft), local - vec2(0.0, 1.0));
          float topRightValue = dot(gradient(topRight), local - vec2(1.0, 1.0));
          float bottom = mix(bottomLeftValue, bottomRightValue, fadeX);
          float top = mix(topLeftValue, topRightValue, fadeX);
          return mix(bottom, top, fadeY);
        }

        float periodicNoise(vec2 point, float periodX) {
          float value = 0.0;
          float amplitude = 0.72;
          float frequency = 1.0;
          float amplitudeTotal = 0.0;

          for (int octave = 0; octave < 3; octave++) {
            value += periodicPerlin(point * frequency, periodX * frequency) * amplitude;
            amplitudeTotal += amplitude;
            amplitude *= 0.5;
            frequency *= 2.0;
          }

          return value / amplitudeTotal;
        }

        void main() {
          vec3 displaced = position;
          float radius = length(position.xy);
          float angle = atan(position.y, position.x);
          float angularCoordinate = (angle + 3.14159265) / 6.2831853 * noiseCells;
          float noise = periodicNoise(vec2(angularCoordinate, time * noiseTimeScale), noiseCells);
          float edgeDirection = radius < (innerRadius + outerRadius) * 0.5 ? -1.0 : 1.0;
          displaced.xy += normalize(position.xy) * noise * noiseAmplitude * edgeDirection;
          vNoise = noise;
          vRadius = length(displaced.xy);
          vAngleUv = (angle + 3.14159265) / 6.2831853;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 ringColour;
        uniform float ringOpacity;
        uniform float innerRadius;
        uniform float outerRadius;
        uniform sampler2D gapMask;
        varying float vNoise;
        varying float vRadius;
        varying float vAngleUv;

        void main() {
          float thicknessRatio = texture2D(gapMask, vec2(fract(vAngleUv), 0.5)).r;
          if (thicknessRatio < 0.02) discard;

          float midRadius = (innerRadius + outerRadius) * 0.5;
          float baseHalfWidth = (outerRadius - innerRadius) * 0.5;
          float allowedHalfWidth = baseHalfWidth * thicknessRatio;
          float radialDistance = abs(vRadius - midRadius);
          float edgeAlpha = 1.0 - smoothstep(
            max(0.0, allowedHalfWidth - 0.004),
            allowedHalfWidth + 0.004,
            radialDistance
          );
          if (edgeAlpha < 0.02) discard;

          gl_FragColor = vec4(ringColour, ringOpacity * edgeAlpha);
          #include <colorspace_fragment>
        }
      `,
    });
  }

  get ringColour() { return this.uniforms.ringColour.value as THREE.Color; }
  set ringColour(value: THREE.Color | string | number) {
    this.uniforms.ringColour.value = value instanceof THREE.Color ? value : new THREE.Color(value);
  }
  get ringOpacity() { return this.uniforms.ringOpacity.value as number; }
  set ringOpacity(value: number) { this.uniforms.ringOpacity.value = value; }
  get innerRadius() { return this.uniforms.innerRadius.value as number; }
  set innerRadius(value: number) { this.uniforms.innerRadius.value = value; }
  get outerRadius() { return this.uniforms.outerRadius.value as number; }
  set outerRadius(value: number) { this.uniforms.outerRadius.value = value; }
  get gapMask() { return this.uniforms.gapMask.value as THREE.Texture | null; }
  set gapMask(value: THREE.Texture | null) { this.uniforms.gapMask.value = value; }
  get noiseCells() { return this.uniforms.noiseCells.value as number; }
  set noiseCells(value: number) { this.uniforms.noiseCells.value = value; }
  get noiseAmplitude() { return this.uniforms.noiseAmplitude.value as number; }
  set noiseAmplitude(value: number) { this.uniforms.noiseAmplitude.value = value; }
  get noiseTimeScale() { return this.uniforms.noiseTimeScale.value as number; }
  set noiseTimeScale(value: number) { this.uniforms.noiseTimeScale.value = value; }
  get time() { return this.uniforms.time.value as number; }
  set time(value: number) { this.uniforms.time.value = value; }
}

extend({
  FlowerPhotoMaterial,
  AdjustedPhotoMaterial,
  OrbitingCutoutPhotoMaterial,
  OrbitingActivityRingMaterial,
});

declare module "@react-three/fiber" {
  interface ThreeElements {
    flowerPhotoMaterial: ThreeElements["shaderMaterial"] & {
      photoMap?: THREE.Texture | null;
      flowerOpacity?: number;
      brightness?: number;
      contrast?: number;
      saturation?: number;
      petalCount?: number;
      borderColor?: THREE.Color | string | number;
      borderWidth?: number;
      imageAspect?: number;
    };
    adjustedPhotoMaterial: ThreeElements["shaderMaterial"] & {
      photoMap?: THREE.Texture | null;
      brightness?: number;
      contrast?: number;
      saturation?: number;
    };
    orbitingCutoutPhotoMaterial: ThreeElements["shaderMaterial"] & {
      photoMap?: THREE.Texture | null;
      brightness?: number;
      contrast?: number;
      saturation?: number;
      cardAspect?: number;
      cornerBottomLeft?: THREE.Vector2;
      cornerBottomRight?: THREE.Vector2;
      cornerTopRight?: THREE.Vector2;
      cornerTopLeft?: THREE.Vector2;
      shapeMode?: number;
      imageAspect?: number;
      indicatorMix?: number;
      indicatorShade?: number;
      borderColor?: THREE.Color | string | number;
      borderWidth?: number;
      dashLength?: number;
      dashGap?: number;
    };
    orbitingActivityRingMaterial: ThreeElements["shaderMaterial"] & {
      ringColour?: THREE.Color | string | number;
      ringOpacity?: number;
      innerRadius?: number;
      outerRadius?: number;
      gapMask?: THREE.Texture | null;
      noiseCells?: number;
      noiseAmplitude?: number;
      noiseTimeScale?: number;
      time?: number;
    };
  }
}

interface PhotoAdjustments {
  brightness?: number;
  contrast?: number;
  saturation?: number;
}

interface SharedPhotoProps {
  id: string;
  url: string;
  width: number;
  height: number;
  isSelected: boolean;
  isHighlighted: boolean;
  adjustments?: PhotoAdjustments;
  borderColour?: string;
  onClick: () => void;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}

interface FlowerProps extends SharedPhotoProps {
  position: [number, number, number];
}

interface OrbitBannerProps extends SharedPhotoProps {
  center: [number, number, number];
  orbitRadius?: number;
  orbitHeight?: number;
  isDenseOrbit?: boolean;
}

interface OrbitPhotoHighlightProps {
  id: string;
  url: string;
  width: number;
  height: number;
  center: [number, number, number];
  orbitRadius?: number;
  orbitHeight?: number;
  isHighlighted?: boolean;
  adjustments?: PhotoAdjustments;
  borderColour?: string;
  onClick: () => void;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}

interface OrbitIconProps {
  id: string;
  iconName?: string;
  center: [number, number, number];
  orbitRadius?: number;
  orbitHeight?: number;
  activityColour?: string;
  isDenseOrbit?: boolean;
  isHighlighted: boolean;
  onClick: () => void;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}

interface CutoutCorners {
  bottomLeft: THREE.Vector2;
  bottomRight: THREE.Vector2;
  topRight: THREE.Vector2;
  topLeft: THREE.Vector2;
}

const BASE_LIFT = 0.025;
const STEM_HEIGHT = 0.28;
const TRACKING_RADIUS = 0.15;
const HEAD_RADIUS = 0.26;
const PETAL_LOBE_COUNT = 10;
const STEM_RADIUS = 0.009;
const MAX_TILT = THREE.MathUtils.degToRad(48);
const MIN_UPWARDNESS = 0.34;
const TRACKING_EASE = 0.12;
const UP = new THREE.Vector3(0, 0, 1);
const BANNER_MAX_WIDTH = 0.95;
const BANNER_MAX_HEIGHT = 0.58;
const CIRCLE_FRAME_SIZE = 0.72;
const HIGHLIGHT_HEAD_SIZE = 1.5;
const HIGHLIGHT_STEM_HEIGHT = 0.68;
const HIGHLIGHT_STEM_RADIUS = 0.018;
const HIGHLIGHT_ROTATION_SPEED = 0.65;
const ORBIT_INDICATOR_SCALE = 0.34;
const ORBIT_MIN_UNITS = 0.72;
const ORBIT_MAX_UNITS = 2.15;
export const ORBIT_HEIGHT = 0.72;
const ORBIT_SPEED = 0.16;
const ORBIT_SPEED_MIN = ORBIT_SPEED * 0.5;
const ORBIT_SPEED_MAX = ORBIT_SPEED * 1.5;
const ORBIT_RING_SEGMENTS = 512;
const ORBIT_RING_HALF_WIDTH = 0.1;
const ORBIT_RING_NOISE_CELLS = 18;
const ORBIT_RING_NOISE_AMPLITUDE = 0.09;
const ORBIT_RING_NOISE_TIME_SCALE = 0.5;
const ORBIT_GAP_MASK_RESOLUTION = 1024;
const ORBIT_GAP_PADDING = 0.055;
const CUTOUT_BORDER_COLORS = [
  "#8e1d58",
  "#eee111",
  "#ec008c",
  "#f28b20",
] as const;
const STEM_COLOR = new THREE.Color("#49d05a");
const STEM_SELECTED_COLOR = new THREE.Color("#9df7a8");
const STEM_HOVER_EMISSIVE = new THREE.Color("#d7ff8f");
const BASE_COLOR = new THREE.Color("#33b84a");
const BASE_SELECTED_COLOR = new THREE.Color("#9df7a8");

const AUDIO_ICON_HIT_RADIUS = 0.45;
const AUDIO_ICON_RING_INNER_RADIUS = 0.32;
const AUDIO_ICON_RING_OUTER_RADIUS = 0.41;
const AUDIO_ICON_SIZE = 0.82;
const AUDIO_ICON_BACKGROUND_OPACITY = 0.46;

interface OrbitWakeCycle {
  phase: number;
  period: number;
  visibleRatio: number;
  indicatorScale: number;
  indicatorShade: number;
}

interface OrbitIconPulse {
  phase: number;
  speed: number;
}

export interface OrbitGapMotion {
  id: string;
  phase: number;
  speed: number;
  visualHalfWidth: number;
  scaleMotion:
    | {
        kind: "banner";
        isDenseOrbit: boolean;
        isEngaged: boolean;
        wakeCycle: OrbitWakeCycle;
      }
    | {
        kind: "icon";
        isDenseOrbit: boolean;
        isEngaged: boolean;
        pulse: OrbitIconPulse;
      };
}

export function getOrbitMotion(id: string, radius?: number) {
  return {
    radius: radius ?? stableRange(`${id}:radius`, ORBIT_MIN_UNITS, ORBIT_MAX_UNITS),
    phase: stableRange(`${id}:phase`, 0, Math.PI * 2),
    speed: stableRange(`${id}:speed`, ORBIT_SPEED_MIN, ORBIT_SPEED_MAX),
  };
}

function getOrbitWakeCycle(id: string): OrbitWakeCycle {
  return {
    phase: stableRange(`${id}:wake:phase`, 0, 10),
    period: stableRange(`${id}:wake:period`, 7.5, 11.5),
    visibleRatio: stableRange(`${id}:wake:visible-ratio`, 0.28, 0.38),
    indicatorScale: stableRange(
      `${id}:wake:indicator-scale`,
      ORBIT_INDICATOR_SCALE * 0.5,
      ORBIT_INDICATOR_SCALE,
    ),
    indicatorShade: stableRange(`${id}:wake:indicator-shade`, 0.12, 0.42),
  };
}

function getOrbitIconPulse(id: string): OrbitIconPulse {
  return {
    phase: stableRange(`${id}:pulse:phase`, 0, Math.PI * 2),
    speed: stableRange(`${id}:pulse:speed`, 0.52, 0.78),
  };
}

function getDenseOrbitIndicatorMix(
  elapsedTime: number,
  wakeCycle: OrbitWakeCycle,
): number {
  const cycleTime = (elapsedTime + wakeCycle.phase) % wakeCycle.period;
  const visibleDuration = wakeCycle.period * wakeCycle.visibleRatio;
  const transitionDuration = Math.min(1.15, wakeCycle.period * 0.12);
  const collapseStart = visibleDuration - transitionDuration;
  const wakeStart = wakeCycle.period - transitionDuration;

  if (cycleTime < collapseStart) return 0;
  if (cycleTime < visibleDuration) {
    return THREE.MathUtils.smoothstep(cycleTime, collapseStart, visibleDuration);
  }
  if (cycleTime < wakeStart) return 1;
  return 1 - THREE.MathUtils.smoothstep(cycleTime, wakeStart, wakeCycle.period);
}

function getOrbitBannerTargetScale(
  elapsedTime: number,
  wakeCycle: OrbitWakeCycle,
  isDenseOrbit: boolean,
  isEngaged: boolean,
): { scale: number; indicatorMix: number } {
  const indicatorMix = isDenseOrbit && !isEngaged
    ? getDenseOrbitIndicatorMix(elapsedTime, wakeCycle)
    : 0;
  const orbitScale = THREE.MathUtils.lerp(1, wakeCycle.indicatorScale, indicatorMix);

  return {
    scale: orbitScale * (isEngaged ? 1.14 : 1),
    indicatorMix,
  };
}

function getOrbitIconTargetScale(
  elapsedTime: number,
  pulse: OrbitIconPulse,
  isDenseOrbit: boolean,
  isEngaged: boolean,
): number {
  const pulseScale = isDenseOrbit
    ? 0.82 + (Math.sin(elapsedTime * pulse.speed + pulse.phase) + 1) * 0.11
    : 1;
  return pulseScale * (isEngaged ? 1.16 : 1);
}

function getOrbitGapTargetScale(gap: OrbitGapMotion, elapsedTime: number): number {
  if (gap.scaleMotion.kind === "banner") {
    return getOrbitBannerTargetScale(
      elapsedTime,
      gap.scaleMotion.wakeCycle,
      gap.scaleMotion.isDenseOrbit,
      gap.scaleMotion.isEngaged,
    ).scale;
  }

  return getOrbitIconTargetScale(
    elapsedTime,
    gap.scaleMotion.pulse,
    gap.scaleMotion.isDenseOrbit,
    gap.scaleMotion.isEngaged,
  );
}

export function createOrbitGapMotion({
  id,
  radius,
  mediaKind,
  width,
  height,
  isDenseOrbit,
  isEngaged,
}: {
  id: string;
  radius: number;
  mediaKind: "image" | "video" | "audio" | "anecdote";
  width: number;
  height: number;
  isDenseOrbit: boolean;
  isEngaged: boolean;
}): OrbitGapMotion {
  const isIcon = mediaKind === "audio" || mediaKind === "anecdote";
  let visualHalfWidth: number;
  if (isIcon) {
    visualHalfWidth = AUDIO_ICON_RING_OUTER_RADIUS;
  } else if (isDenseOrbit) {
    visualHalfWidth = CIRCLE_FRAME_SIZE * 0.5;
  } else {
    const aspect = width > 0 && height > 0 ? width / height : 1;
    const markerWidth = aspect >= 1
      ? BANNER_MAX_WIDTH
      : BANNER_MAX_HEIGHT * aspect;
    visualHalfWidth = markerWidth * 0.5;
  }

  const motion = getOrbitMotion(id, radius);
  return {
    id,
    phase: motion.phase,
    speed: motion.speed,
    visualHalfWidth,
    scaleMotion: isIcon
      ? {
          kind: "icon",
          isDenseOrbit,
          isEngaged,
          pulse: getOrbitIconPulse(id),
        }
      : {
          kind: "banner",
          isDenseOrbit,
          isEngaged,
          wakeCycle: getOrbitWakeCycle(id),
        },
  };
}

const tempVector = new THREE.Vector3();
const materialSymbolTexturePromises = new Map<
  string,
  Promise<THREE.CanvasTexture>
>();

function createMaterialSymbolTexture(iconName: string) {
  const existing = materialSymbolTexturePromises.get(iconName);
  if (existing) return existing;

  const request = loadMaterialSymbols([iconName])
    .then(() => {
      const size = 256;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas rendering is unavailable.");

      context.clearRect(0, 0, size, size);
      context.fillStyle = "#ffffff";
      context.font = '400 176px "Material Symbols Outlined"';
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(iconName, size / 2, size / 2);

      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = false;
      texture.needsUpdate = true;
      return texture;
    })
    .catch((error) => {
      materialSymbolTexturePromises.delete(iconName);
      throw error;
    });
  materialSymbolTexturePromises.set(iconName, request);
  return request;
}

function useMaterialSymbolTexture(iconName?: string) {
  const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null);

  useEffect(() => {
    let active = true;
    setTexture(null);
    if (!iconName) return () => {
      active = false;
    };

    createMaterialSymbolTexture(iconName)
      .then((nextTexture) => {
        if (active) setTexture(nextTexture);
      })
      .catch((error) => {
        console.warn(
          `[orbit-icon] failed to render "${iconName}": ${(error as Error).message}`,
        );
      });
    return () => {
      active = false;
    };
  }, [iconName]);

  return texture;
}

export function TerrainPhotoFlower({
  id,
  url,
  width,
  height,
  position,
  isSelected,
  isHighlighted,
  onClick,
  onPointerEnter,
  onPointerLeave,
  adjustments,
  borderColour,
}: FlowerProps) {
  const groupRef = useRef<THREE.Group>(null);
  const headRef = useRef<THREE.Group>(null);
  const stemRef = useRef<THREE.Mesh>(null);
  const stemMaterialRef = useRef<THREE.MeshStandardMaterial>(null);
  const baseMaterialRef = useRef<THREE.MeshStandardMaterial>(null);
  const currentDirection = useRef(new THREE.Vector3(0, 0, 1));
  const lastStemDirection = useRef(new THREE.Vector3(0, 0, 1));
  const camera = useThree((state) => state.camera);
  const texture = usePhotoTexture(url);
  const [x, y, z] = position;

  const imageAspect = getTextureAspect(texture, width, height);
  const brightness = adjustmentScalar(adjustments?.brightness);
  const contrast = adjustmentScalar(adjustments?.contrast);
  const saturation = adjustmentScalar(adjustments?.saturation);
  const headSize = HEAD_RADIUS * 2;
  const stemGeometry = useMemo(() => createInitialStemGeometry(), []);
  const baseGeometry = useMemo(() => new THREE.SphereGeometry(STEM_RADIUS * 1.45, 12, 8), []);
  const pointerHandlers = useMemo(
    () => createPointerHandlers(onClick, onPointerEnter, onPointerLeave),
    [onClick, onPointerEnter, onPointerLeave],
  );

  useEffect(() => {
    return () => {
      stemGeometry.dispose();
      baseGeometry.dispose();
      stemRef.current?.geometry.dispose();
    };
  }, [baseGeometry, stemGeometry]);

  useFrame((state) => {
    const group = groupRef.current;
    const head = headRef.current;
    const stem = stemRef.current;
    if (!group || !head || !stem) return;

    const sphereCenter = new THREE.Vector3(0, 0, STEM_HEIGHT);
    const cameraLocal = group.worldToLocal(camera.position.clone());
    const targetDirection = getTiltLimitedDirection(cameraLocal, sphereCenter);
    currentDirection.current.lerp(targetDirection, TRACKING_EASE).normalize();

    const headCenter = sphereCenter.clone().add(currentDirection.current.clone().multiplyScalar(TRACKING_RADIUS));
    head.position.copy(headCenter);
    orientHeadToCamera(head, group, camera);

    if (lastStemDirection.current.angleTo(currentDirection.current) > 0.025) {
      const nextGeometry = new THREE.TubeGeometry(createStemCurve(sphereCenter, headCenter), 18, STEM_RADIUS, 8, false);
      stem.geometry.dispose();
      stem.geometry = nextGeometry;
      lastStemDirection.current.copy(currentDirection.current);
    }

    const pulse = isHighlighted ? (Math.sin(state.clock.elapsedTime * 9) + 1) * 0.5 : 0;
    const stemMaterial = stemMaterialRef.current;
    const baseMaterial = baseMaterialRef.current;
    if (stemMaterial) {
      stemMaterial.color.copy(isSelected ? STEM_SELECTED_COLOR : STEM_COLOR);
      stemMaterial.emissive.copy(STEM_HOVER_EMISSIVE);
      stemMaterial.emissiveIntensity = isHighlighted ? THREE.MathUtils.lerp(0.15, 1.25, pulse) : 0;
    }
    if (baseMaterial) {
      baseMaterial.color.copy(isSelected ? BASE_SELECTED_COLOR : BASE_COLOR);
      baseMaterial.emissive.copy(STEM_HOVER_EMISSIVE);
      baseMaterial.emissiveIntensity = isHighlighted ? THREE.MathUtils.lerp(0.06, 0.55, pulse) : 0;
    }
  });

  return (
    <group ref={groupRef} position={[x, y, z + BASE_LIFT]} {...pointerHandlers}>
      <mesh ref={stemRef} geometry={stemGeometry}>
        <meshStandardMaterial ref={stemMaterialRef} color={isSelected ? "#9df7a8" : "#49d05a"} roughness={0.62} transparent opacity={0.9} />
      </mesh>
      <mesh geometry={baseGeometry}>
        <meshStandardMaterial ref={baseMaterialRef} color={isSelected ? "#9df7a8" : "#33b84a"} roughness={0.72} transparent opacity={0.9} />
      </mesh>
      <group
        ref={headRef}
        position={[0, 0, STEM_HEIGHT + TRACKING_RADIUS]}
        scale={isHighlighted || isSelected ? 1.14 : 1}
      >
        <mesh {...pointerHandlers}>
          <planeGeometry args={[headSize, headSize]} />
          <flowerPhotoMaterial
            photoMap={texture}
            brightness={brightness}
            contrast={contrast}
            saturation={saturation}
            petalCount={PETAL_LOBE_COUNT}
            flowerOpacity={0.96}
            borderColor={borderColour ?? "#ffffff"}
            borderWidth={0.12}
            imageAspect={imageAspect}
            transparent
            side={THREE.DoubleSide}
            toneMapped={false}
            depthWrite={false}
            polygonOffset
            polygonOffsetFactor={-3}
            polygonOffsetUnits={-3}
          />
        </mesh>
      </group>
    </group>
  );
}

export function OrbitingPhotoBanner({
  id,
  url,
  width,
  height,
  center,
  orbitRadius,
  orbitHeight,
  isSelected,
  isHighlighted,
  onClick,
  onPointerEnter,
  onPointerLeave,
  adjustments,
  borderColour: assignedBorderColour,
  isDenseOrbit = false,
}: OrbitBannerProps) {
  const groupRef = useRef<THREE.Group>(null);
  const imageRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<OrbitingCutoutPhotoMaterial>(null);
  const pointerInsideRef = useRef(false);
  const pointerDragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const texture = usePhotoTexture(url);
  const orbit = useMemo(
    () => getOrbitMotion(id, orbitRadius),
    [id, orbitRadius],
  );
  const cutout = useMemo(() => createCutoutCorners(id), [id]);
  const wakeCycle = useMemo(() => getOrbitWakeCycle(id), [id]);
  const fallbackBorderColor = useMemo(() => {
    const index = Math.min(
      CUTOUT_BORDER_COLORS.length - 1,
      Math.floor(stableRange(`${id}:cutout:border-color`, 0, CUTOUT_BORDER_COLORS.length)),
    );
    return CUTOUT_BORDER_COLORS[index];
  }, [id]);
  const [cx, cy, cz] = center;
  const orbitZ = orbitHeight ?? ORBIT_HEIGHT;
  const aspect = getTextureAspect(texture, width, height);
  const brightness = adjustmentScalar(adjustments?.brightness);
  const contrast = adjustmentScalar(adjustments?.contrast);
  const saturation = adjustmentScalar(adjustments?.saturation);
  const imageW = isDenseOrbit
    ? CIRCLE_FRAME_SIZE
    : aspect >= 1 ? BANNER_MAX_WIDTH : BANNER_MAX_HEIGHT * aspect;
  const imageH = isDenseOrbit
    ? CIRCLE_FRAME_SIZE
    : aspect >= 1 ? BANNER_MAX_WIDTH / aspect : BANNER_MAX_HEIGHT;

  useFrame((state) => {
    const group = groupRef.current;
    const image = imageRef.current;
    if (!group || !image) return;
    const angle = orbit.phase + state.clock.elapsedTime * orbit.speed;
    group.position.set(
      cx + Math.cos(angle) * orbit.radius,
      cy + Math.sin(angle) * orbit.radius,
      cz + orbitZ
    );
    const isEngaged = isHighlighted || isSelected;
    const scaleState = getOrbitBannerTargetScale(
      state.clock.elapsedTime,
      wakeCycle,
      isDenseOrbit,
      isEngaged,
    );
    image.scale.lerp(tempVector.set(scaleState.scale, scaleState.scale, 1), 0.15);
    if (materialRef.current) materialRef.current.indicatorMix = scaleState.indicatorMix;
  });

  return (
    <group ref={groupRef} position={[cx + orbit.radius, cy, cz + orbitZ]}>
      <Billboard>
        <mesh
          ref={imageRef}
          renderOrder={3}
          onPointerDown={(event) => {
            pointerDragRef.current = {
              x: event.nativeEvent.clientX,
              y: event.nativeEvent.clientY,
              moved: false,
            };
          }}
          onClick={(event) => {
            if (pointerDragRef.current?.moved) {
              pointerDragRef.current = null;
              event.stopPropagation();
              return;
            }
            pointerDragRef.current = null;
            if (!isDenseOrbit && !isPointInsideCutout(event.uv, cutout)) return;
            if (isDenseOrbit && !isPointInsideCircle(event.uv)) return;
            event.stopPropagation();
            onClick();
          }}
          onPointerMove={(event) => {
            const drag = pointerDragRef.current;
            if (drag && Math.hypot(
              event.nativeEvent.clientX - drag.x,
              event.nativeEvent.clientY - drag.y,
            ) > 6) {
              drag.moved = true;
            }
            const inside = isDenseOrbit
              ? isPointInsideCircle(event.uv)
              : isPointInsideCutout(event.uv, cutout);
            if (inside === pointerInsideRef.current) return;
            pointerInsideRef.current = inside;
            document.body.style.cursor = inside ? "pointer" : "";
            if (inside) onPointerEnter();
            else onPointerLeave();
          }}
          onPointerOut={() => {
            pointerDragRef.current = null;
            if (pointerInsideRef.current) onPointerLeave();
            pointerInsideRef.current = false;
            document.body.style.cursor = "";
          }}
        >
          <planeGeometry args={[imageW, imageH]} />
          <orbitingCutoutPhotoMaterial
            ref={materialRef}
            photoMap={texture}
            brightness={brightness}
            contrast={contrast}
            saturation={saturation}
            cardAspect={imageW / imageH}
            shapeMode={isDenseOrbit ? 1 : 0}
            imageAspect={aspect}
            indicatorShade={wakeCycle.indicatorShade}
            cornerBottomLeft={cutout.bottomLeft}
            cornerBottomRight={cutout.bottomRight}
            cornerTopRight={cutout.topRight}
            cornerTopLeft={cutout.topLeft}
            borderColor={assignedBorderColour ?? fallbackBorderColor}
            borderWidth={0.04}
            dashLength={0.11}
            dashGap={0.065}
            transparent
            side={THREE.DoubleSide}
            toneMapped={false}
            depthWrite
            depthTest
            polygonOffset
            polygonOffsetFactor={-2}
            polygonOffsetUnits={-2}
          />
        </mesh>
      </Billboard>
    </group>
  );
}

export function OrbitingPhotoHighlight({
  id,
  url,
  width,
  height,
  center,
  orbitRadius,
  orbitHeight,
  isHighlighted = false,
  adjustments,
  borderColour,
  onClick,
  onPointerEnter,
  onPointerLeave,
}: OrbitPhotoHighlightProps) {
  const groupRef = useRef<THREE.Group>(null);
  const headRef = useRef<THREE.Group>(null);
  const pointerDragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const texture = usePhotoTexture(url);
  const orbit = useMemo(
    () => getOrbitMotion(id, orbitRadius),
    [id, orbitRadius],
  );
  const stemGeometry = useMemo(
    () => new THREE.CylinderGeometry(
      HIGHLIGHT_STEM_RADIUS * 0.8,
      HIGHLIGHT_STEM_RADIUS * 1.35,
      HIGHLIGHT_STEM_HEIGHT,
      12,
    ),
    [],
  );
  const baseGeometry = useMemo(
    () => new THREE.SphereGeometry(HIGHLIGHT_STEM_RADIUS * 2.1, 12, 8),
    [],
  );
  const [cx, cy, cz] = center;
  const orbitZ = orbitHeight ?? ORBIT_HEIGHT;
  const imageAspect = getTextureAspect(texture, width, height);
  const brightness = adjustmentScalar(adjustments?.brightness);
  const contrast = adjustmentScalar(adjustments?.contrast);
  const saturation = adjustmentScalar(adjustments?.saturation);

  useEffect(() => () => {
    stemGeometry.dispose();
    baseGeometry.dispose();
  }, [baseGeometry, stemGeometry]);

  useFrame((state) => {
    const group = groupRef.current;
    if (!group) return;
    const angle = orbit.phase + state.clock.elapsedTime * orbit.speed;
    group.position.set(
      cx + Math.cos(angle) * orbit.radius,
      cy + Math.sin(angle) * orbit.radius,
      cz + orbitZ,
    );
    if (headRef.current) {
      headRef.current.rotation.z = state.clock.elapsedTime * HIGHLIGHT_ROTATION_SPEED;
    }
  });

  return (
    <group ref={groupRef} position={[cx + orbit.radius, cy, cz + orbitZ]}>
      <mesh
        geometry={stemGeometry}
        position={[0, 0, HIGHLIGHT_STEM_HEIGHT / 2]}
        rotation={[Math.PI / 2, 0, 0]}
        renderOrder={5}
      >
        <meshStandardMaterial
          color="#f6cc55"
          emissive="#7e5c08"
          emissiveIntensity={isHighlighted ? 0.6 : 0.25}
          roughness={0.55}
        />
      </mesh>
      <mesh geometry={baseGeometry} renderOrder={6}>
        <meshStandardMaterial
          color="#f6cc55"
          emissive="#7e5c08"
          emissiveIntensity={isHighlighted ? 0.65 : 0.3}
          roughness={0.55}
        />
      </mesh>
      <Billboard position={[0, 0, HIGHLIGHT_STEM_HEIGHT]}>
        <group ref={headRef} scale={isHighlighted ? 1.06 : 1}>
          <mesh
            renderOrder={8}
            onPointerDown={(event) => {
              pointerDragRef.current = {
                x: event.nativeEvent.clientX,
                y: event.nativeEvent.clientY,
                moved: false,
              };
            }}
            onClick={(event) => {
              if (pointerDragRef.current?.moved) {
                pointerDragRef.current = null;
                event.stopPropagation();
                return;
              }
              pointerDragRef.current = null;
              event.stopPropagation();
              onClick();
            }}
            onPointerMove={(event) => {
              const drag = pointerDragRef.current;
              if (!drag) return;
              if (Math.hypot(
                event.nativeEvent.clientX - drag.x,
                event.nativeEvent.clientY - drag.y,
              ) > 6) {
                drag.moved = true;
              }
            }}
            onPointerOver={(event) => {
              event.stopPropagation();
              document.body.style.cursor = "pointer";
              onPointerEnter();
            }}
            onPointerOut={(event) => {
              event.stopPropagation();
              pointerDragRef.current = null;
              document.body.style.cursor = "";
              onPointerLeave();
            }}
          >
            <planeGeometry args={[HIGHLIGHT_HEAD_SIZE, HIGHLIGHT_HEAD_SIZE]} />
            <orbitingCutoutPhotoMaterial
              photoMap={texture}
              brightness={brightness}
              contrast={contrast}
              saturation={saturation}
              cardAspect={1}
              shapeMode={1}
              imageAspect={imageAspect}
              indicatorMix={0}
              indicatorShade={0}
              borderColor={borderColour ?? "#f6cc55"}
              borderWidth={0.065}
              dashLength={0.34}
              dashGap={0.16}
              transparent
              side={THREE.DoubleSide}
              toneMapped={false}
              depthWrite={false}
              depthTest={false}
            />
          </mesh>
        </group>
      </Billboard>
    </group>
  );
}

export function OrbitingActivityRing({
  center,
  radius,
  colour,
  orbitHeight,
  gaps,
}: {
  center: [number, number, number];
  radius: number;
  colour: string;
  orbitHeight?: number;
  gaps: OrbitGapMotion[];
}) {
  const groupRef = useRef<THREE.Group>(null);
  const materialRef = useRef<OrbitingActivityRingMaterial>(null);
  const gapScalesRef = useRef(new Map<string, number>());
  const gapMask = useMemo(() => {
    const data = new Uint8Array(ORBIT_GAP_MASK_RESOLUTION * 4);
    data.fill(255);
    const texture = new THREE.DataTexture(
      data,
      ORBIT_GAP_MASK_RESOLUTION,
      1,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    );
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    return { data, texture };
  }, []);
  const [cx, cy, cz] = center;
  const orbitZ = orbitHeight ?? ORBIT_HEIGHT;
  const innerRadius = radius - ORBIT_RING_HALF_WIDTH;
  const outerRadius = radius + ORBIT_RING_HALF_WIDTH;

  useEffect(() => () => gapMask.texture.dispose(), [gapMask]);

  useFrame((state) => {
    const elapsedTime = state.clock.elapsedTime;
    if (groupRef.current) groupRef.current.rotation.z = elapsedTime * ORBIT_SPEED;
    if (materialRef.current) materialRef.current.time = elapsedTime;

    gapMask.data.fill(255);
    for (const gap of gaps) {
      const localAngle = gap.phase + elapsedTime * (gap.speed - ORBIT_SPEED);
      const centerUv = THREE.MathUtils.euclideanModulo(
        localAngle + Math.PI,
        Math.PI * 2,
      ) / (Math.PI * 2);
      const targetScale = getOrbitGapTargetScale(gap, elapsedTime);
      const currentScale = THREE.MathUtils.lerp(
        gapScalesRef.current.get(gap.id) ?? 1,
        targetScale,
        0.15,
      );
      gapScalesRef.current.set(gap.id, currentScale);
      const toHalfAngle = (halfWidth: number) => Math.asin(
        THREE.MathUtils.clamp(halfWidth / Math.max(radius, 0.001), 0, 0.94),
      );
      const coreHalfAngle = toHalfAngle(gap.visualHalfWidth * currentScale);
      const outerHalfAngle = toHalfAngle(
        gap.visualHalfWidth * currentScale + ORBIT_GAP_PADDING,
      );
      const outerUv = outerHalfAngle / (Math.PI * 2);
      const firstSample = Math.floor(
        (centerUv - outerUv) * ORBIT_GAP_MASK_RESOLUTION,
      );
      const lastSample = Math.ceil(
        (centerUv + outerUv) * ORBIT_GAP_MASK_RESOLUTION,
      );

      for (let sample = firstSample; sample <= lastSample; sample++) {
        const wrappedSample = THREE.MathUtils.euclideanModulo(
          sample,
          ORBIT_GAP_MASK_RESOLUTION,
        );
        const sampleUv = (wrappedSample + 0.5) / ORBIT_GAP_MASK_RESOLUTION;
        const directDistance = Math.abs(sampleUv - centerUv);
        const angularDistance = Math.min(
          directDistance,
          1 - directDistance,
        ) * Math.PI * 2;
        const thicknessRatio = THREE.MathUtils.smoothstep(
          angularDistance,
          coreHalfAngle,
          outerHalfAngle,
        );
        const offset = wrappedSample * 4;
        const encodedRatio = Math.round(thicknessRatio * 255);
        const nextRatio = Math.min(gapMask.data[offset], encodedRatio);
        gapMask.data[offset] = nextRatio;
        gapMask.data[offset + 1] = nextRatio;
        gapMask.data[offset + 2] = nextRatio;
      }
    }
    gapMask.texture.needsUpdate = true;
  });

  return (
    <group
      ref={groupRef}
      position={[cx, cy, cz + orbitZ]}
    >
      <mesh renderOrder={0}>
        <ringGeometry args={[innerRadius, outerRadius, ORBIT_RING_SEGMENTS]} />
        <orbitingActivityRingMaterial
          ref={materialRef}
          ringColour={colour}
          ringOpacity={0.72}
          innerRadius={innerRadius}
          outerRadius={outerRadius}
          gapMask={gapMask.texture}
          noiseCells={ORBIT_RING_NOISE_CELLS}
          noiseAmplitude={ORBIT_RING_NOISE_AMPLITUDE}
          noiseTimeScale={ORBIT_RING_NOISE_TIME_SCALE}
          transparent
          side={THREE.DoubleSide}
          depthWrite
          depthTest
        />
      </mesh>
    </group>
  );
}

export function OrbitingIconMarker({
  id,
  iconName,
  center,
  orbitRadius,
  orbitHeight,
  activityColour,
  isDenseOrbit = false,
  isHighlighted,
  onClick,
  onPointerEnter,
  onPointerLeave,
}: OrbitIconProps) {
  const groupRef = useRef<THREE.Group>(null);
  const iconRef = useRef<THREE.Group>(null);
  const assignedIconTexture = useMaterialSymbolTexture(iconName);
  const orbit = useMemo(
    () => getOrbitMotion(id, orbitRadius),
    [id, orbitRadius],
  );
  const pulse = useMemo(() => getOrbitIconPulse(id), [id]);
  const triangle = useMemo(() => {
    const shape = new THREE.Shape();
    shape.moveTo(-0.11, -0.18);
    shape.lineTo(0.21, 0);
    shape.lineTo(-0.11, 0.18);
    shape.closePath();
    return shape;
  }, []);
  const [cx, cy, cz] = center;
  const orbitZ = orbitHeight ?? ORBIT_HEIGHT;
  const color = "#ffffff";

  useFrame((state) => {
    const group = groupRef.current;
    const icon = iconRef.current;
    if (!group || !icon) return;
    const angle = orbit.phase + state.clock.elapsedTime * orbit.speed;
    group.position.set(
      cx + Math.cos(angle) * orbit.radius,
      cy + Math.sin(angle) * orbit.radius,
      cz + orbitZ,
    );
    const targetScale = getOrbitIconTargetScale(
      state.clock.elapsedTime,
      pulse,
      isDenseOrbit,
      isHighlighted,
    );
    icon.scale.lerp(tempVector.set(targetScale, targetScale, 1), 0.15);
  });

  return (
    <group ref={groupRef} position={[cx + orbit.radius, cy, cz + orbitZ]}>
      <Billboard>
        <group
          ref={iconRef}
          onClick={(event) => {
            event.stopPropagation();
            onClick();
          }}
          onPointerOver={(event) => {
            event.stopPropagation();
            document.body.style.cursor = "pointer";
            onPointerEnter();
          }}
          onPointerOut={(event) => {
            event.stopPropagation();
            document.body.style.cursor = "";
            onPointerLeave();
          }}
        >
          <mesh position={[0, 0, -0.001]}>
            <circleGeometry args={[AUDIO_ICON_HIT_RADIUS, 48]} />
            <meshBasicMaterial
              transparent
              opacity={0}
              depthWrite={false}
              color="#ffffff"
            />
          </mesh>
          <mesh position={[0, 0, -0.0005]}>
            <circleGeometry args={[AUDIO_ICON_RING_OUTER_RADIUS, 48]} />
            <meshBasicMaterial
              color={activityColour ?? "#8a9099"}
              transparent
              opacity={isHighlighted ? 1 : AUDIO_ICON_BACKGROUND_OPACITY}
              depthWrite
              depthTest
              side={THREE.DoubleSide}
              toneMapped={false}
            />
          </mesh>
          {assignedIconTexture ? (
            <mesh position={[0, 0, 0.002]}>
              <planeGeometry args={[AUDIO_ICON_SIZE, AUDIO_ICON_SIZE]} />
              <meshBasicMaterial
                map={assignedIconTexture}
                color={color}
                transparent
                alphaTest={0.04}
                depthWrite={false}
                depthTest
                side={THREE.DoubleSide}
                toneMapped={false}
              />
            </mesh>
          ) : (
            <>
              <mesh>
                <ringGeometry
                  args={[
                    AUDIO_ICON_RING_INNER_RADIUS,
                    AUDIO_ICON_RING_OUTER_RADIUS,
                    48,
                  ]}
                />
                <meshBasicMaterial
                  color={color}
                  side={THREE.DoubleSide}
                  toneMapped={false}
                />
              </mesh>
              <mesh position={[0.036, 0, 0.002]}>
                <shapeGeometry args={[triangle]} />
                <meshBasicMaterial
                  color={color}
                  side={THREE.DoubleSide}
                  toneMapped={false}
                />
              </mesh>
            </>
          )}
        </group>
      </Billboard>
    </group>
  );
}

function adjustmentScalar(value?: number) {
  if (!Number.isFinite(value)) return 1;
  return THREE.MathUtils.clamp(Math.round(value as number), 50, 150) / 100;
}

function getTextureAspect(texture: THREE.Texture, fallbackWidth: number, fallbackHeight: number) {
  const image = texture.image as {
    naturalWidth?: number;
    naturalHeight?: number;
    width?: number;
    height?: number;
  } | null;
  const textureWidth = image?.naturalWidth ?? image?.width ?? 0;
  const textureHeight = image?.naturalHeight ?? image?.height ?? 0;
  if (textureWidth > 0 && textureHeight > 0) return textureWidth / textureHeight;
  return Number.isFinite(fallbackWidth / fallbackHeight) && fallbackHeight > 0
    ? fallbackWidth / fallbackHeight
    : 1;
}

function orientHeadToCamera(head: THREE.Object3D, parent: THREE.Object3D, camera: THREE.Camera) {
  const cameraWorldQuaternion = camera.getWorldQuaternion(new THREE.Quaternion());
  const parentWorldQuaternion = parent.getWorldQuaternion(new THREE.Quaternion()).invert();
  head.quaternion.copy(parentWorldQuaternion.multiply(cameraWorldQuaternion));
}

function usePhotoTexture(url: string) {
  const gl = useThree((state) => state.gl);
  const fallbackTexture = useMemo(() => {
    const texture = new THREE.DataTexture(
      new Uint8Array([34, 38, 48, 255]),
      1,
      1,
      THREE.RGBAFormat,
    );
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }, []);
  const [texture, setTexture] = useState<THREE.Texture>(fallbackTexture);

  useEffect(() => {
    let active = true;
    let loadedTexture: THREE.Texture | null = null;
    setTexture(fallbackTexture);

    new THREE.TextureLoader().load(
      url,
      (nextTexture) => {
        loadedTexture = nextTexture;
        nextTexture.colorSpace = THREE.SRGBColorSpace;
        nextTexture.minFilter = THREE.LinearMipmapLinearFilter;
        nextTexture.magFilter = THREE.LinearFilter;
        nextTexture.generateMipmaps = true;
        nextTexture.anisotropy = Math.min(4, gl.capabilities.getMaxAnisotropy());
        nextTexture.needsUpdate = true;
        if (active) setTexture(nextTexture);
        else nextTexture.dispose();
      },
      undefined,
      () => {
        if (active) {
          console.warn(`[viewer] thumbnail unavailable: ${url}`);
          setTexture(fallbackTexture);
        }
      },
    );

    return () => {
      active = false;
      loadedTexture?.dispose();
    };
  }, [fallbackTexture, gl, url]);

  useEffect(
    () => () => {
      fallbackTexture.dispose();
    },
    [fallbackTexture],
  );

  return texture;
}

function createPointerHandlers(
  onClick: () => void,
  onPointerEnter: () => void,
  onPointerLeave: () => void
) {
  let dragStart: { x: number; y: number; moved: boolean } | null = null;
  return {
    onClick: (event: ThreeEvent<MouseEvent>) => {
      event.stopPropagation();
      if (dragStart?.moved) {
        dragStart = null;
        return;
      }
      dragStart = null;
      onClick();
    },
    onPointerDown: (event: ThreeEvent<PointerEvent>) => {
      dragStart = {
        x: event.nativeEvent.clientX,
        y: event.nativeEvent.clientY,
        moved: false,
      };
    },
    onPointerMove: (event: ThreeEvent<PointerEvent>) => {
      if (!dragStart) return;
      if (Math.hypot(
        event.nativeEvent.clientX - dragStart.x,
        event.nativeEvent.clientY - dragStart.y,
      ) > 6) {
        dragStart.moved = true;
      }
    },
    onPointerOver: (event: ThreeEvent<PointerEvent>) => {
      event.stopPropagation();
      document.body.style.cursor = "pointer";
      onPointerEnter();
    },
    onPointerOut: (event: ThreeEvent<PointerEvent>) => {
      event.stopPropagation();
      dragStart = null;
      document.body.style.cursor = "";
      onPointerLeave();
    },
  };
}

function getTiltLimitedDirection(cameraLocal: THREE.Vector3, sphereCenter: THREE.Vector3) {
  const ideal = cameraLocal.sub(sphereCenter).normalize();
  if (!Number.isFinite(ideal.x) || !Number.isFinite(ideal.y) || !Number.isFinite(ideal.z)) {
    return UP.clone();
  }

  ideal.z = Math.max(ideal.z, MIN_UPWARDNESS);
  ideal.normalize();

  const angleFromUp = UP.angleTo(ideal);
  if (angleFromUp <= MAX_TILT) return ideal;

  return UP.clone().lerp(ideal, MAX_TILT / angleFromUp).normalize();
}

function createStemCurve(sphereCenter: THREE.Vector3, headCenter: THREE.Vector3) {
  const lowerStem = new THREE.Vector3(0, 0, STEM_HEIGHT * 0.48);
  const neckControl = sphereCenter.clone().lerp(headCenter, 0.42);
  return new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    lowerStem,
    sphereCenter,
    neckControl,
    headCenter,
  ]);
}

function createInitialStemGeometry() {
  const sphereCenter = new THREE.Vector3(0, 0, STEM_HEIGHT);
  const headCenter = new THREE.Vector3(0, 0, STEM_HEIGHT + TRACKING_RADIUS);
  return new THREE.TubeGeometry(createStemCurve(sphereCenter, headCenter), 18, STEM_RADIUS, 8, false);
}

function createCutoutCorners(id: string): CutoutCorners {
  const inset = (corner: string, axis: string) =>
    stableRange(`${id}:cutout:${corner}:${axis}`, 0.03, 0.13);
  return {
    bottomLeft: new THREE.Vector2(inset("bottom-left", "x"), inset("bottom-left", "y")),
    bottomRight: new THREE.Vector2(1 - inset("bottom-right", "x"), inset("bottom-right", "y")),
    topRight: new THREE.Vector2(1 - inset("top-right", "x"), 1 - inset("top-right", "y")),
    topLeft: new THREE.Vector2(inset("top-left", "x"), 1 - inset("top-left", "y")),
  };
}

function isPointInsideCutout(point: THREE.Vector2 | undefined, corners: CutoutCorners) {
  if (!point) return false;
  const polygon = [
    corners.bottomLeft,
    corners.bottomRight,
    corners.topRight,
    corners.topLeft,
  ];
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    const cross =
      (end.x - start.x) * (point.y - start.y) -
      (end.y - start.y) * (point.x - start.x);
    if (cross < 0) return false;
  }
  return true;
}

function isPointInsideCircle(point: THREE.Vector2 | undefined) {
  if (!point) return false;
  const centeredX = point.x * 2 - 1;
  const centeredY = point.y * 2 - 1;
  return centeredX * centeredX + centeredY * centeredY <= 0.88 * 0.88;
}

function stableRange(seed: string, min: number, max: number) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  const normalized = (Math.abs(hash) % 1000) / 999;
  return min + normalized * (max - min);
}
