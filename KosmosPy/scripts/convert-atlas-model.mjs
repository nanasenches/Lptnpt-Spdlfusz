import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
} from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = process.argv[2];
const modelDirectory = path.join(projectRoot, 'public', 'models');
const fullPath = path.join(modelDirectory, 'atlas.glb');
const bodyPath = path.join(modelDirectory, 'atlas-body.glb');
const nosePath = path.join(modelDirectory, 'atlas-nose.glb');

const WORLD_SCALE_M_PER_UNIT = 0.001;
const NOSE_BASE_Z = 185.64;
const MODEL_CENTER_Z_M = 1.35;

if (!sourcePath) {
  throw new Error('Informe o arquivo FBX do Atlas como primeiro argumento.');
}

class NodeFileReader {
  constructor() {
    this.result = null;
    this.onloadend = null;
  }

  async readAsArrayBuffer(blob) {
    this.result = await blob.arrayBuffer();
    this.onloadend?.();
  }

  async readAsDataURL(blob) {
    const buffer = Buffer.from(await blob.arrayBuffer());
    this.result = `data:${blob.type || 'application/octet-stream'};base64,${buffer.toString('base64')}`;
    this.onloadend?.();
  }
}

globalThis.FileReader ??= NodeFileReader;

function smoothStep(value) {
  const clamped = Math.max(0, Math.min(1, value));
  return clamped * clamped * (3 - 2 * clamped);
}

function angularDistance(angle, center) {
  return Math.abs(Math.atan2(Math.sin(angle - center), Math.cos(angle - center)));
}

function inSymmetricPetal(theta, halfWidth) {
  return Math.min(
    angularDistance(theta, 0),
    angularDistance(theta, Math.PI / 2),
    angularDistance(theta, Math.PI),
    angularDistance(theta, -Math.PI_OVER_TWO),
  ) <= halfWidth;
}

function paintVertex(meshName, materialName, x, y, z) {
  const navy = new Color('#102f5b');
  const navyHighlight = new Color('#1c4677');
  const pearl = new Color('#dde1e4');
  const silver = new Color('#aeb5bb');
  const graphite = new Color('#313840');
  const hardware = new Color('#59636c');
  const theta = Math.atan2(y, x);
  const radius = Math.hypot(x, y);

  if (meshName === 'fus_inf') {
    const progress = (z - 32.3) / (106.84 - 32.3);
    const petalProgress = smoothStep((progress - 0.24) / 0.76);
    const halfWidth = 0.08 + 1.47 * petalProgress;
    return progress >= 0.24 && inSymmetricPetal(theta, halfWidth) ? navy : pearl;
  }

  if (meshName === 'coifa') {
    if (z < NOSE_BASE_Z) {
      const progress = (z - 108.34) / (NOSE_BASE_Z - 108.34);
      const leaf = Math.sin(Math.PI * Math.max(0, Math.min(1, progress)));
      const halfWidth = 0.15 + 0.86 * leaf;
      return inSymmetricPetal(theta, halfWidth) ? pearl : navyHighlight;
    }

    const noseProgress = (z - NOSE_BASE_Z) / (260.34 - NOSE_BASE_Z);
    const whiteHalfWidth = Math.max(0, 1.54 * (1 - smoothStep(noseProgress / 0.72)));
    if (noseProgress < 0.76 && inSymmetricPetal(theta, whiteHalfWidth)) return pearl;
    if (noseProgress > 0.965) return silver;
    return navy;
  }

  if (meshName === 'boattail') {
    return radius > 8.25 ? graphite : silver;
  }

  if (meshName.startsWith('coup')) return silver;
  if (meshName === 'Body1' && z > 250) return silver;
  if (materialName.includes('Stainless Steel')) return hardware;
  return graphite;
}

function applyPaint(root) {
  root.traverse((object) => {
    if (!object.isMesh) return;
    let geometry = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone();
    const position = geometry.getAttribute('position');
    const colors = new Float32Array(position.count * 3);
    const materialName = Array.isArray(object.material)
      ? object.material.map((material) => material?.name || '').join(' ')
      : object.material?.name || '';

    for (let index = 0; index < position.count; index += 1) {
      const color = paintVertex(
        object.name,
        materialName,
        position.getX(index),
        position.getY(index),
        position.getZ(index),
      );
      colors[index * 3] = color.r;
      colors[index * 3 + 1] = color.g;
      colors[index * 3 + 2] = color.b;
    }

    geometry.setAttribute('color', new BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    for (const attributeName of Object.keys(geometry.attributes)) {
      if (!['position', 'normal', 'color'].includes(attributeName)) {
        geometry.deleteAttribute(attributeName);
      }
    }
    geometry = mergeVertices(geometry, 1e-5);
    object.geometry = geometry;
    object.material = new MeshStandardMaterial({
      name: `${object.name || 'Atlas'} paint`,
      color: 0xffffff,
      vertexColors: true,
      metalness: object.name.startsWith('coup') || materialName.includes('Steel') ? 0.48 : 0.2,
      roughness: 0.42,
    });
    object.castShadow = false;
    object.receiveShadow = false;
  });
}

function splitGeometry(geometry, keepNose) {
  if (geometry.index) geometry = geometry.toNonIndexed();
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const color = geometry.getAttribute('color');
  const attributes = { position: [], normal: [], color: [] };

  for (let start = 0; start < position.count; start += 3) {
    const meanZ = (position.getZ(start) + position.getZ(start + 1) + position.getZ(start + 2)) / 3;
    if ((meanZ >= NOSE_BASE_Z) !== keepNose) continue;
    for (let index = start; index < start + 3; index += 1) {
      attributes.position.push(position.getX(index), position.getY(index), position.getZ(index));
      attributes.normal.push(normal.getX(index), normal.getY(index), normal.getZ(index));
      attributes.color.push(color.getX(index), color.getY(index), color.getZ(index));
    }
  }

  const output = new BufferGeometry();
  output.setAttribute('position', new Float32BufferAttribute(attributes.position, 3));
  output.setAttribute('normal', new Float32BufferAttribute(attributes.normal, 3));
  output.setAttribute('color', new Float32BufferAttribute(attributes.color, 3));
  output.computeBoundingSphere();
  return output;
}

function makeVariant(source, variant) {
  const stagedRoot = source.clone(true);
  const removals = [];
  stagedRoot.traverse((object) => {
    if (!object.isMesh) return;
    object.geometry = object.geometry.clone();
    object.material = object.material.clone();

    if (object.name === 'coifa') {
      if (variant === 'body') object.geometry = splitGeometry(object.geometry, false);
      if (variant === 'nose') object.geometry = splitGeometry(object.geometry, true);
      return;
    }

    const isTip = object.name === 'Body1' && object.geometry.boundingBox?.min.z > 250;
    if (variant === 'body' && isTip) removals.push(object);
    if (variant === 'nose' && !isTip) removals.push(object);
  });
  for (const object of removals) object.parent?.remove(object);
  stagedRoot.updateMatrixWorld(true);

  const root = new Group();
  root.name = `Atlas ${variant}`;
  stagedRoot.traverse((object) => {
    if (!object.isMesh) return;
    const geometry = object.geometry.clone();
    geometry.applyMatrix4(object.matrixWorld);
    geometry.scale(
      WORLD_SCALE_M_PER_UNIT,
      WORLD_SCALE_M_PER_UNIT,
      WORLD_SCALE_M_PER_UNIT,
    );
    geometry.translate(0, 0, -MODEL_CENTER_Z_M);
    const mesh = new Mesh(geometry, object.material.clone());
    mesh.name = object.name;
    root.add(mesh);
  });
  root.updateMatrixWorld(true);
  return root;
}

async function exportBinary(root, destination) {
  const exporter = new GLTFExporter();
  const output = await exporter.parseAsync(root, {
    binary: true,
    onlyVisible: true,
    truncateDrawRange: true,
  });
  await writeFile(destination, Buffer.from(output));
}

const source = await readFile(path.resolve(sourcePath));
const root = new FBXLoader().parse(
  source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength),
  '',
);
applyPaint(root);
root.traverse((object) => {
  if (object.isMesh) object.geometry.computeBoundingBox();
});

await exportBinary(makeVariant(root, 'full'), fullPath);
await exportBinary(makeVariant(root, 'body'), bodyPath);
await exportBinary(makeVariant(root, 'nose'), nosePath);

console.log(JSON.stringify({
  sourcePath: path.resolve(sourcePath),
  worldScaleMetersPerUnit: WORLD_SCALE_M_PER_UNIT,
  noseBaseMeters: 0.5094,
  outputs: { fullPath, bodyPath, nosePath },
}, null, 2));
