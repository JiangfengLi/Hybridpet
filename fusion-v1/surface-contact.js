import * as THREE from "../vendor/three.module.min.js";

function frontPatch(root, direction) {
  root.updateWorldMatrix(true, true);
  const meshes = [];
  root.traverse((node) => { if (node.isMesh && node.visible) meshes.push(node); });
  let furthest = -Infinity;
  const vertices = [];
  for (const mesh of meshes) {
    for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
      const point = mesh.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);
      const projection = point.dot(direction);
      furthest = Math.max(furthest, projection);
      vertices.push({ point, projection });
    }
  }
  const point = new THREE.Vector3();
  let count = 0;
  for (const vertex of vertices) {
    if (vertex.projection >= furthest - .055) { point.add(vertex.point); count++; }
  }
  return count ? { point: point.divideScalar(count), meshes } : null;
}

// Sample the facing surfaces in their deformed state, not the undeformed bounds.
export function findContactPair(left, right) {
  const axis = right.getWorldPosition(new THREE.Vector3()).sub(left.getWorldPosition(new THREE.Vector3()));
  axis.y = 0;
  if (axis.lengthSq() < 1e-8) return null;
  axis.normalize();
  const a = frontPatch(left, axis), b = frontPatch(right, axis.clone().negate());
  if (!a || !b) return null;
  const center = a.point.clone().add(b.point).multiplyScalar(.5);
  const tangent = axis.clone().cross(new THREE.Vector3(0, 1, 0));
  const ray = new THREE.Raycaster();
  let closest = null;
  // Mixed characters can touch at a different height from two identical ones.
  const heights = [...new Set([a.point.y, b.point.y, center.y, a.point.y + .1, b.point.y + .1])];
  const depths = [...new Set([a.point.dot(tangent), b.point.dot(tangent), center.dot(tangent)])];
  for (const y of heights) {
    for (const depth of depths) {
      const anchor = center.clone().setY(y).addScaledVector(tangent, depth - center.dot(tangent));
      const hits = [a, b].map((patch, index) => {
        const outward = axis.clone().multiplyScalar(index ? -1 : 1);
        ray.set(anchor.clone().addScaledVector(outward, 2), outward.negate());
        return ray.intersectObjects(patch.meshes, false)[0];
      });
      if (!hits.every(Boolean)) continue;
      const separation = hits[1].point.clone().sub(hits[0].point).dot(axis);
      const gap = Math.max(0, separation);
      if (!closest || gap < closest.gap) {
        closest = { gap, overlap: Math.max(0, -separation), hits, axis,
          point: hits[0].point.clone().add(hits[1].point).multiplyScalar(.5) };
      }
    }
  }
  return closest;
}

function defaultReadPixels(image) {
  if (image.data && image.width && image.height) {
    if (!(image.data instanceof Uint8Array || image.data instanceof Uint8ClampedArray)) return null;
    return { data: image.data, width: image.width, height: image.height };
  }
  const width = image.naturalWidth || image.width, height = image.naturalHeight || image.height;
  if (!width || !height) return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0);
  return context.getImageData(0, 0, width, height);
}

export function createSurfaceSampler({ readPixels = defaultReadPixels } = {}) {
  let cache = new WeakMap();
  function pixels(texture) {
    const image = texture.source?.data;
    if (!image || typeof image !== "object") return null;
    const stored = cache.get(image);
    if (stored?.version === texture.source.version) return stored.pixels;
    let data = null;
    try { data = readPixels(image); } catch { /* Tainted or unsupported images use material color. */ }
    cache.set(image, { version: texture.source.version, pixels: data });
    return data;
  }
  return {
    prepare(root) {
      root.traverse((mesh) => {
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        materials.forEach((material) => { if (material?.map) pixels(material.map); });
      });
    },
    sample(hit) {
      const mesh = hit.object, face = hit.face;
      const material = Array.isArray(mesh.material) ? mesh.material[face?.materialIndex ?? 0] : mesh.material;
      const color = material?.color?.clone() || new THREE.Color("white");
      let source = "material";
      if (material?.vertexColors && mesh.geometry.attributes.color && hit.barycoord && face) {
        const value = THREE.Triangle.getInterpolatedAttribute(mesh.geometry.attributes.color, face.a, face.b, face.c, hit.barycoord, new THREE.Vector3());
        color.multiply(new THREE.Color().setRGB(value.x, value.y, value.z));
        source = "vertex";
      }
      const map = material?.map;
      if (map) {
        source = "material-fallback";
        let uv = map.channel === 0 ? hit.uv?.clone() : null;
        const attribute = mesh.geometry.getAttribute(map.channel ? `uv${map.channel}` : "uv");
        if (!uv && attribute && face && hit.barycoord) {
          uv = THREE.Triangle.getInterpolatedAttribute(attribute, face.a, face.b, face.c, hit.barycoord, new THREE.Vector2());
        }
        const image = uv && pixels(map);
        if (image) {
          if (map.matrixAutoUpdate) map.updateMatrix();
          map.transformUv(uv);
          const x = Math.min(image.width - 1, Math.max(0, Math.floor(uv.x * image.width)));
          const y = Math.min(image.height - 1, Math.max(0, Math.floor(uv.y * image.height)));
          const channels = image.data.length / (image.width * image.height);
          if (channels === 3 || channels === 4) {
            const i = (y * image.width + x) * channels;
            color.multiply(new THREE.Color().setRGB(image.data[i] / 255, image.data[i + 1] / 255, image.data[i + 2] / 255,
              map.colorSpace === THREE.SRGBColorSpace ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace));
            source = "texture";
          }
        }
      }
      return { color, source };
    },
    dispose() { cache = new WeakMap(); },
  };
}
