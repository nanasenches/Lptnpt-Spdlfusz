import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const projectRoot = resolve(import.meta.dirname, '..');
const sourcePath = resolve(projectRoot, 'public', 'models', 'deimos-ii.glb');
const bodyPath = resolve(projectRoot, 'public', 'models', 'deimos-ii-body.glb');
const nosePath = resolve(projectRoot, 'public', 'models', 'deimos-ii-nose.glb');

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const TRIANGLES = 4;
const UNSIGNED_BYTE = 5121;
const UNSIGNED_SHORT = 5123;
const UNSIGNED_INT = 5125;
const FLOAT = 5126;

// The CAD export uses centimetres. The DEIMOS II nose cone starts 9.8 cm
// before the model tip at z = 134.91 cm.
const NOSE_BASE_Z_CM = 125.11;
const UPPER_FUSELAGE_MESHES = new Set([7, 8]);

function align4(value) {
  return (value + 3) & ~3;
}

function parseGlb(buffer) {
  if (buffer.readUInt32LE(0) !== GLB_MAGIC || buffer.readUInt32LE(4) !== 2) {
    throw new Error('O modelo DEIMOS II não é um GLB 2.0 válido.');
  }

  let json = null;
  let binary = null;
  let offset = 12;
  while (offset < buffer.length) {
    const length = buffer.readUInt32LE(offset);
    const type = buffer.readUInt32LE(offset + 4);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === JSON_CHUNK) {
      json = JSON.parse(data.toString('utf8').replace(/[\s\0]+$/, ''));
    } else if (type === BIN_CHUNK) {
      binary = Buffer.from(data);
    }
    offset += 8 + length;
  }

  if (!json || !binary) throw new Error('O GLB não contém os blocos JSON e BIN esperados.');
  return { json, binary };
}

function componentReader(componentType) {
  if (componentType === UNSIGNED_BYTE) return { size: 1, read: (buffer, offset) => buffer.readUInt8(offset) };
  if (componentType === UNSIGNED_SHORT) return { size: 2, read: (buffer, offset) => buffer.readUInt16LE(offset) };
  if (componentType === UNSIGNED_INT) return { size: 4, read: (buffer, offset) => buffer.readUInt32LE(offset) };
  if (componentType === FLOAT) return { size: 4, read: (buffer, offset) => buffer.readFloatLE(offset) };
  throw new Error(`Tipo de componente GLTF não suportado: ${componentType}`);
}

function accessorValues(json, binary, accessorIndex) {
  const accessor = json.accessors[accessorIndex];
  const view = json.bufferViews[accessor.bufferView];
  const component = componentReader(accessor.componentType);
  const componentsPerValue = accessor.type === 'VEC3' ? 3 : 1;
  const packedSize = component.size * componentsPerValue;
  const stride = view.byteStride || packedSize;
  const baseOffset = (view.byteOffset || 0) + (accessor.byteOffset || 0);
  const values = [];

  for (let index = 0; index < accessor.count; index += 1) {
    const valueOffset = baseOffset + index * stride;
    if (componentsPerValue === 1) {
      values.push(component.read(binary, valueOffset));
    } else {
      values.push([
        component.read(binary, valueOffset),
        component.read(binary, valueOffset + component.size),
        component.read(binary, valueOffset + component.size * 2),
      ]);
    }
  }
  return values;
}

function partitionPrimitive(json, binary, primitive) {
  if ((primitive.mode ?? TRIANGLES) !== TRIANGLES) {
    throw new Error('A fuselagem superior não usa triângulos GLTF.');
  }
  const positions = accessorValues(json, binary, primitive.attributes.POSITION);
  const indices = primitive.indices === undefined
    ? positions.map((_, index) => index)
    : accessorValues(json, binary, primitive.indices);
  const body = [];
  const nose = [];

  for (let index = 0; index < indices.length; index += 3) {
    const triangle = indices.slice(index, index + 3);
    if (triangle.length < 3) continue;
    const meanZ = triangle.reduce((sum, vertexIndex) => sum + positions[vertexIndex][2], 0) / 3;
    (meanZ >= NOSE_BASE_Z_CM ? nose : body).push(...triangle);
  }

  if (!body.length || !nose.length) {
    throw new Error('Não foi possível separar a coifa da fuselagem superior.');
  }
  return { body, nose };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function appendIndices(json, chunks, indices) {
  const currentLength = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const alignedLength = align4(currentLength);
  if (alignedLength > currentLength) chunks.push(Buffer.alloc(alignedLength - currentLength));

  const data = Buffer.alloc(indices.length * 4);
  indices.forEach((value, index) => data.writeUInt32LE(value, index * 4));
  const byteOffset = chunks.reduce((total, chunk) => total + chunk.length, 0);
  chunks.push(data);

  const bufferViewIndex = json.bufferViews.push({
    buffer: 0,
    byteOffset,
    byteLength: data.length,
    target: 34963,
  }) - 1;
  return json.accessors.push({
    bufferView: bufferViewIndex,
    byteOffset: 0,
    componentType: UNSIGNED_INT,
    count: indices.length,
    type: 'SCALAR',
    min: [Math.min(...indices)],
    max: [Math.max(...indices)],
  }) - 1;
}

function buildVariant(sourceJson, sourceBinary, partitions, variant) {
  const json = cloneJson(sourceJson);
  const chunks = [Buffer.from(sourceBinary)];

  for (const meshIndex of UPPER_FUSELAGE_MESHES) {
    json.meshes[meshIndex].primitives.forEach((primitive, primitiveIndex) => {
      primitive.indices = appendIndices(
        json,
        chunks,
        partitions.get(`${meshIndex}:${primitiveIndex}`)[variant],
      );
    });
  }

  if (variant === 'nose') {
    // Keep only the root and the upper-fuselage hierarchy in the recovery model.
    json.nodes[0].children = [20];
  }

  const binary = Buffer.concat(chunks);
  json.buffers[0].byteLength = binary.length;
  return encodeGlb(json, binary);
}

function encodeGlb(json, binary) {
  const jsonSource = Buffer.from(JSON.stringify(json));
  const jsonLength = align4(jsonSource.length);
  const binaryLength = align4(binary.length);
  const output = Buffer.alloc(12 + 8 + jsonLength + 8 + binaryLength);
  output.writeUInt32LE(GLB_MAGIC, 0);
  output.writeUInt32LE(2, 4);
  output.writeUInt32LE(output.length, 8);
  output.writeUInt32LE(jsonLength, 12);
  output.writeUInt32LE(JSON_CHUNK, 16);
  jsonSource.copy(output, 20);
  output.fill(0x20, 20 + jsonSource.length, 20 + jsonLength);
  const binaryHeader = 20 + jsonLength;
  output.writeUInt32LE(binaryLength, binaryHeader);
  output.writeUInt32LE(BIN_CHUNK, binaryHeader + 4);
  binary.copy(output, binaryHeader + 8);
  return output;
}

const source = await readFile(sourcePath);
const { json, binary } = parseGlb(source);
const partitions = new Map();

for (const meshIndex of UPPER_FUSELAGE_MESHES) {
  json.meshes[meshIndex].primitives.forEach((primitive, primitiveIndex) => {
    partitions.set(
      `${meshIndex}:${primitiveIndex}`,
      partitionPrimitive(json, binary, primitive),
    );
  });
}

await writeFile(bodyPath, buildVariant(json, binary, partitions, 'body'));
await writeFile(nosePath, buildVariant(json, binary, partitions, 'nose'));

const triangleTotals = Array.from(partitions.values()).reduce(
  (totals, partition) => ({
    body: totals.body + partition.body.length / 3,
    nose: totals.nose + partition.nose.length / 3,
  }),
  { body: 0, nose: 0 },
);

console.log(JSON.stringify({ bodyPath, nosePath, triangleTotals }, null, 2));
