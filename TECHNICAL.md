# GENESIS — Technical Graphics Breakdown

> Mathematical and implementation details for every custom graphics technique
> used in the project. Written for CGV rubric reference.

---

## Table of Contents

1. [Custom GLSL Shaders](#1-custom-glsl-shaders)
2. [Procedural Texture Generation](#2-procedural-texture-generation)
3. [Camera Mathematics](#3-camera-mathematics)
4. [Collision System](#4-collision-system)
5. [Animation Retargeting](#5-animation-retargeting)
6. [Lighting Pipeline](#6-lighting-pipeline)
7. [Renderer Configuration](#7-renderer-configuration)

---

## 1. Custom GLSL Shaders

### 1.1 Procedural Cratered Moon (`src/shaders/moon.js`)

A fully procedural moon rendered in a fragment shader — zero texture assets.
The moon is a sphere whose surface colour and displacement are computed per
pixel from noise functions.

#### Noise Foundation

```glsl
float hash(vec3 p) {
    return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
}
```

A pseudo-random hash using the classic `sin(dot(...))` trick. The large
multiplier (43758.5453) ensures adjacent integer coordinates produce
uncorrelated outputs.

#### Value Noise with Trilinear Interpolation

```glsl
float noise(vec3 p) {
    vec3 i = floor(p);        // integer cell coordinate
    vec3 f = fract(p);        // fractional position within cell
    f = f * f * (3.0 - 2.0 * f);  // Hermite smoothstep (C¹ continuous)

    // 8 corner hashes, trilinearly interpolated
    float a = hash(i);
    float b = hash(i + vec3(1,0,0));
    // ... 6 more corners ...
    return mix(mix(x1,x2,f.y), mix(x3,x4,f.y), f.z);
}
```

The smoothstep `f * f * (3 - 2f)` replaces linear interpolation to eliminate
first-derivative discontinuities at cell boundaries.

#### Fractal Brownian Motion (4 octaves)

```glsl
float fbm(vec3 p) {
    float v = 0.0, a = 0.5;
    for (int k = 0; k < 4; k++) {
        v += a * noise(p);
        p *= 2.03;   // lacunarity ≈ 2
        a *= 0.5;    // persistence = 0.5
    }
    return v;
}
```

Each octave doubles the frequency and halves the amplitude, producing
multi-scale terrain detail.

#### Crater Function

```glsl
float crater(vec3 p, vec3 center, float size, float strength) {
    float d = acos(clamp(dot(p, center), -1.0, 1.0));  // angular distance on sphere
    float distortion = noise(p * 18.0) * 0.10 + noise(p * 37.0) * 0.045;
    float radius = size * (1.0 + distortion);           // noisy rim
    float x = d / radius;

    // Bowl: smooth falloff from rim to centre
    float bowl = 1.0 - smoothstep(0.08, 1.0, x);
    // Flat floor: depressed centre
    float floorShape = 1.0 - smoothstep(0.0, 0.34, x);
    // Raised rim: annular bump at the crater edge
    float rim = smoothstep(0.68 + rimNoise * 0.06, 0.82 + rimNoise * 0.06, x)
              * (1.0 - smoothstep(0.82, 1.08, x));

    return bowl * strength + floorShape * strength * 0.18 - rim * strength * 0.10;
}
```

Each crater is a composite of three shapes:
- **Bowl** — the main depression
- **Floor** — a flat darkened centre (impact melt)
- **Rim** — a raised annular ring (ejecta blanket), subtracted from height

6 large craters are placed at fixed positions, 45 medium and 65 tiny craters
are placed procedurally via hashed coordinates.

#### Normal-from-Height Derivation

```glsl
// Sample height at neighbouring points to compute surface normal
float s = 0.004;  // sample offset
vec3 tangent  = normalize(cross(p, vec3(0,1,0)));
vec3 tangent2 = normalize(cross(p, tangent));

float h1 = craterMap(normalize(p + tangent  * s));
float h2 = craterMap(normalize(p + tangent2 * s));

// Finite-difference normal
vec3 normal = normalize(p - tangent * ((h1-h)/s) * 0.55
                          - tangent2 * ((h2-h)/s) * 0.55);
```

The shader computes the height at two neighbouring samples along the surface
tangent plane, then derives the normal via central differences. The `0.55`
factor controls normal map intensity.

#### Lunar Maria (Dark Patches)

```glsl
float mariaNoise = noise(p * 2.4) * 0.65 + noise(p * 5.0) * 0.35;
float maria = smoothstep(0.42, 0.68, mariaNoise);
vec3 moon = mix(brightRock, darkRock, maria * 0.55);
```

Two noise octaves at different frequencies are blended, then thresholded
with `smoothstep` to produce the dark basaltic plains visible on the real
Moon.

#### Final Lighting

```glsl
float diffuse = max(dot(normal, lightDir), 0.0);  // Lambertian
float lighting = 0.48 + diffuse * 0.52;            // 48% ambient + 52% diffuse
moon *= lighting;
```

A simple Lambertian model with a high ambient floor so the dark side is
never pure black.

---

### 1.2 Nebula Sky Dome (`src/shaders/shaders.js`)

An animated skybox using two layers of fractal noise drifting at different
speeds to create a living nebula effect.

```glsl
// Two fbm layers at different scales and drift rates
float n1 = fbm(d * 2.6 + vec3(0.0, uTime * 0.008, uTime * 0.012));
float n2 = fbm(d * 5.2 - vec3(uTime * 0.015, 0.0, 0.0));

// Three-colour gradient driven by noise thresholds
vec3 col = mix(uA, uB, smoothstep(0.25, 0.85, n1));
col = mix(col, uC, smoothstep(0.55, 0.95, n2) * 0.7);
```

The sky direction `d` is the normalised vertex position on a BackSide
sphere — every fragment's position IS its sky direction.

#### Star Field

```glsl
float s = hash13(floor(d * 220.0));         // one hash per sky cell
float tw = 0.5 + 0.5 * sin(uTime * 2.5 + s * 40.0);  // time-based twinkle
col += vec3(step(0.9975, s)) * tw * 0.9;    // only the brightest 0.25% become stars
```

Stars are hashed from quantised sky directions. Only the top 0.25% of hash
values pass the `step` threshold, and each star twinkles at a rate set by
its own hash.

---

### 1.3 God Ray Volumetric Light (`src/shaders/shaders.js`)

A cone mesh with a custom shader that fakes volumetric light scattering.

```glsl
// Bright at the top (uv.y = 1), fading downward
float vertical = smoothstep(0.0, 0.4, vUv.y) * (0.4 + 0.6 * vUv.y);

// Softer at silhouette edges (view-dependent)
float rim = abs(dot(normalize(vNormal), normalize(vView)));

// Time-based flicker (two incommensurate sine waves)
float flicker = 0.85 + 0.1 * sin(uTime * 7.0) + 0.05 * sin(uTime * 13.7);

gl_FragColor = vec4(vec3(0.85, 0.8, 1.0), vertical * rim * 0.35 * flicker);
```

Rendered with `AdditiveBlending` and `depthWrite: false` so overlapping
rays accumulate brightness without z-fighting.

---

### 1.4 Dissolve Death Effect (`src/shaders/shaders.js`)

A noise-driven dissolve that burns defeated enemies away from the feet up.

#### Technique: Material Injection

Instead of replacing the character's materials (which would lose skinning
and texture support), the dissolve uniforms are injected into the existing
`MeshStandardMaterial` pipeline via `onBeforeCompile`:

```javascript
mat.onBeforeCompile = (shader) => {
    shader.uniforms.uDissolve = uniforms.uDissolve;
    shader.uniforms.uNoise = { value: noiseTex };
    shader.uniforms.uEdge = { value: new THREE.Color(edgeColor) };
    shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\n...')
        .replace('gl_FragColor = vec4(...)', '...dissolve math...');
};
```

#### Fragment Shader Logic

```glsl
float n = texture2D(uNoise, vMapUv * 2.0).r;  // sample noise at 2× UV scale
float edge = smoothstep(uDissolve - 0.06, uDissolve + 0.06, n);
if (n < uDissolve) discard;                     // burned away
vec3 edgeGlow = uEdge * (1.0 - edge) * 3.0;    // orange glow at burn line
gl_FragColor.rgb += edgeGlow;
```

The `uDissolve` uniform sweeps from 0.0 (intact) to 1.0 (fully dissolved).
The `smoothstep` around the threshold creates a glowing edge band.

#### Noise Texture Generation

```javascript
function createNoiseTexture(size = 128) {
    // 1. Fill canvas with white noise
    // 2. Apply 2 blur passes → blobby cloud pattern
    // 3. Return as repeating CanvasTexture
}
```

Two Gaussian blur passes turn pixel static into organic cloud shapes, so
the dissolve eats the model in irregular patches rather than as uniform
static.

---

### 1.5 Water Shader (`src/levels/level1.js`)

An animated pond with vertex displacement, Fresnel reflections, and glints.

#### Vertex Displacement

```glsl
// Two crossing sine waves for organic surface motion
pos.z += sin(position.x * 1.6 + uTime * 1.4) * 0.05
       + cos(position.y * 1.9 + uTime * 1.1) * 0.05;
```

#### Fresnel Reflection

```glsl
float fresnel = pow(1.0 - abs(vView.z), 2.0);  // Schlick approximation
vec3 col = mix(deep, skyRef, fresnel * 0.75 + ripple * 0.15);
```

At grazing angles (view parallel to surface), the water reflects the sky
colour. At normal incidence, the deep water colour dominates.

#### Glint Highlights

```glsl
float glint = pow(noise(vP * 5.0 + uTime * 0.8), 12.0);
col += vec3(1.0, 0.8, 0.5) * glint * 2.0;
```

A high-frequency noise raised to the 12th power produces sharp, bright
specular-like highlights that drift across the surface.

---

### 1.6 Firefly Particles (`src/levels/level1.js`)

Point sprites with per-particle procedural motion and pulsing brightness.

#### Vertex Shader

```glsl
attribute float seed;  // per-particle random seed

// Lissajous-style drift: each axis uses a different frequency
p.x += sin(uTime * 0.31 + seed * 17.0) * 1.6;
p.y += sin(uTime * 0.23 + seed * 29.0) * 0.9;
p.z += cos(uTime * 0.27 + seed * 13.0) * 1.6;

// Size attenuation: closer = larger
float pulse = 0.6 + 0.4 * sin(uTime * 2.2 + seed * 40.0);
gl_PointSize = (3.2 * pulse) * (160.0 / -mv.z);
```

#### Fragment Shader

```glsl
float d = length(gl_PointCoord - 0.5);  // distance from sprite centre
float a = smoothstep(0.5, 0.06, d);     // soft circular falloff
a *= 0.55 + 0.45 * sin(uTime * 2.2 + vSeed * 40.0);  // pulse
gl_FragColor = vec4(vec3(0.75, 1.0, 0.35) * 1.6, a);
```

---

### 1.7 Sky Dome (`src/levels/level1.js`)

A procedural sunset sky with clouds, stars, and a moon disc.

```glsl
// Three-colour vertical gradient: horizon → rose → zenith
vec3 horizon = vec3(0.98, 0.55, 0.32);
vec3 rose    = vec3(0.55, 0.30, 0.52);
vec3 zenith  = vec3(0.10, 0.08, 0.28);
vec3 col = mix(horizon, rose, smoothstep(0.0, 0.22, h));
col = mix(col, zenith, smoothstep(0.18, 0.65, h));

// Cloud layer: noise projected onto the sky hemisphere
float cl = noise(d.xz / max(d.y + 0.25, 0.12) * 1.4 + uTime * 0.008);
col += vec3(0.9, 0.5, 0.45) * smoothstep(0.55, 0.85, cl) * ...;

// Moon disc + halo
float md = dot(d, moonDir);
float disc = smoothstep(0.9992, 0.9996, md);
float halo = pow(max(md, 0.0), 220.0) * 0.5;
```

---

## 2. Procedural Texture Generation

### 2.1 Normal Maps from Height (`src/utils/utils.js`)

#### Algorithm: Sobel Filter on Grayscale Heightmap

```javascript
function heightCanvasToNormalTexture(canvas, strength) {
    // 1. Read grayscale pixels as height values [0, 1]
    // 2. For each pixel, compute central differences:
    //    dx = (height[x+1] - height[x-1]) * strength
    //    dy = (height[y+1] - height[y-1]) * strength
    // 3. Build tangent-space normal:
    //    normal = normalize(vec3(-dx, dy, 1))
    // 4. Encode to [0, 255] range:
    //    R = (-dx * 0.5 + 0.5) * 255
    //    G = ( dy * 0.5 + 0.5) * 255
    //    B = ( inv * 0.5 + 0.5) * 255
}
```

The canvas wraps at edges (modulo indexing) so the resulting normal map
tiles seamlessly.

#### Height Field Generators

- **Brushed metal** (`moonSteelNormal`): 260 random horizontal streaks + a
  4×4 panel grid, fed through the Sobel pipeline.
- **Wet asphalt roughness**: Dark puddle patches on a lighter base — the
  roughness map (not a normal map) controls PBR shininess.
- **Tech floor conduits**: Glowing line grid on dark panels — used as both
  diffuse map and emissive map so conduits self-illuminate.

### 2.2 Equirectangular Environment Maps

```javascript
function equirectTexture(w, h, draw) {
    // 1. Paint on a 2:1 canvas (equirectangular projection)
    // 2. Wrap as CanvasTexture with EquirectangularReflectionMapping
    // 3. Three.js PMREMGenerator auto-converts to filtered cubemap for PBR
}
```

Two environment maps are generated:
- **Moon void** (`moonEnvTexture`): Near-black sky, 1400 stars, nebula
  ellipses, Earth radial gradient — used for monument plaza reflections.
- **Neon street** (`neonEnvTexture`): Deep navy gradient, sparse stars,
  horizontal neon sign bands — used for wet asphalt reflections.

### 2.3 Canvas Texture Factory

```javascript
function canvasTexture(size, drawFn, { srgb = true }) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    drawFn(canvas.getContext('2d'), size);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 4;
    return tex;
}
```

All textures are generated at runtime from seeded PRNGs (`mulberry32`) so
the map looks identical on every load.

---

## 3. Camera Mathematics

### 3.1 Third-Person Camera

The camera orbits the player using spherical coordinates:

```
camera.x = player.x + distance * sin(yaw) * cos(pitch)
camera.y = player.y + distance * sin(pitch)
camera.z = player.z + distance * cos(yaw) * cos(pitch)
```

Mouse movement adjusts `yaw` and `pitch`; the camera always `lookAt`s the
player position.

### 3.2 Cinematic Camera System (`src/ui/CinematicCamera.js`)

A queued shot system with smooth interpolation between camera positions.

#### Shot Definition

```javascript
shots = [
    {
        pos: [x, y, z],        // camera position (or function returning {x,y,z})
        look: [x, y, z],       // look-at target (or function)
        duration: 4000,        // hold time in ms
        transition: 800,       // interpolation time in ms
        ease: 'in-out',        // easing function
        drift: [x, y, z],      // slow slide offset
    }
];
```

#### Interpolation

```javascript
// Smooth-step easing: t² * (3 - 2t)
function easeInOut(t) {
    return t * t * (3 - 2 * t);
}

// Each frame:
const progress = shotTimer / transitionDuration;
const t = easeInOut(Math.min(1, progress));
camera.position.lerpVectors(fromPos, toPos, t);
lookTarget.lerpVectors(fromLook, toLook, t);
```

#### Dynamic Target Tracking

When `pos` or `look` is a function, it is re-evaluated every frame so the
camera can track a moving subject (walking enemy, player character).

---

## 4. Collision System

### 4.1 2.5D Cylinder-vs-AABB (`src/physics/CollisionSystem.js`)

Characters are modelled as vertical cylinders (radius R, height H). World
colliders are axis-aligned bounding boxes (AABBs).

#### Resolution Algorithm

```
For each collider Box3:
    1. Check vertical overlap: entity occupies [pos.y, pos.y + H]
       If pos.y + H < box.min.y OR pos.y > box.max.y → skip (no collision)

    2. Find closest point on AABB in XZ plane:
       cx = clamp(pos.x, box.min.x, box.max.x)
       cz = clamp(pos.z, box.min.z, box.max.z)

    3. Compute distance² from entity centre to closest point:
       dx = pos.x - cx
       dz = pos.z - cz
       distSq = dx² + dz²

    4a. If distSq > 0 AND distSq < R²:
        → Perimeter touch: push entity away from wall
        overlap = R - sqrt(distSq)
        pos.x += (dx / dist) * overlap
        pos.z += (dz / dist) * overlap

    4b. If distSq == 0:
        → Centre is INSIDE the box: eject along shortest axis
        Compare distances to all 4 walls, push out the closest one
```

#### Entity Separation

```javascript
function pushOutOfCircle(pos, center, minDist) {
    const dx = pos.x - center.x;
    const dz = pos.z - center.z;
    const distSq = dx * dx + dz * dz;
    if (distSq >= minDist * minDist) return;  // no overlap
    const dist = sqrt(distSq);
    const push = (minDist - dist) / dist;
    pos.x += dx * push;
    pos.z += dz * push;
}
```

Prevents enemies from overlapping the player (or each other) by pushing
them apart along their shared centre line.

---

## 5. Animation Retargeting

### 5.1 Bone Name Normalisation

Mixamo rigs use bone names like `mixamorig:Spine` or `mixamorigSpine`. The
retargeting system normalises these to a canonical form:

```javascript
function normalizeBoneName(n) {
    return n.replace(/^mixamorig:?/i, '')   // strip prefix
            .replace(/[^a-zA-Z0-9]/g, '')   // remove non-alphanumeric
            .toLowerCase();                  // case-insensitive
}
// 'mixamorig:RightHand' → 'righthand'
// 'mixamorigSpine2'    → 'spine2'
```

### 5.2 Clip Remapping

For each bone track in the source clip, find the matching bone in the
target model by normalised name, then redirect the track:

```javascript
function remapClip(clip, model) {
    // Build a map: normalised name → actual bone
    const boneMap = new Map();
    model.traverse((o) => {
        if (o.isBone) boneMap.set(normalizeBoneName(o.name), o);
    });

    // For each track in the clip, redirect to the target bone
    for (const track of clip.tracks) {
        const targetBone = boneMap.get(normalizeBoneName(track.name));
        if (targetBone) track.name = targetBone.name;  // redirect
    }
    return clip;
}
```

This allows any Mixamo clip to drive any Mixamo rig, regardless of the
original character.

---

## 6. Lighting Pipeline

### 6.1 Shadow Map Configuration

```javascript
const sun = new THREE.DirectionalLight(0xffd6cf, 1.7);
sun.position.set(-80, 100, -40);
sun.castShadow = true;
sun.shadow.mapSize.width = 2048;
sun.shadow.mapSize.height = 2048;
sun.shadow.camera.left = -120;
sun.shadow.camera.right = 120;
sun.shadow.camera.top = 120;
sun.shadow.camera.bottom = -120;
sun.shadow.camera.near = 0.5;
sun.shadow.camera.far = 500;
```

The shadow frustum is tuned per level to cover the playable area without
wasting shadow map resolution on empty space.

### 6.2 Dynamic Light Flicker

```javascript
// Every point light in livingLights[] gets a subtle organic flicker
for (const light of this.livingLights) {
    const flicker = 0.95 + 0.05 * Math.sin(time * 3.7 + light.phase);
    light.intensity = light.baseIntensity * flicker;
}
```

Each light has a random `phase` offset so they don't all pulse in sync.

### 6.3 Emissive Materials

Building windows use the same texture as both `map` and `emissiveMap`:

```javascript
const wallMat = new THREE.MeshStandardMaterial({
    map: windowTexture,
    emissiveMap: windowTexture,
    emissive: new THREE.Color(0xffffff),
    emissiveIntensity: 0.8,
});
```

Lit windows (painted bright in the texture) glow; dark windows don't.

---

## 7. Renderer Configuration

```javascript
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));  // cap at 2× for performance
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;           // soft shadows
renderer.toneMapping = THREE.ACESFilmicToneMapping;     // cinematic colour
renderer.toneMappingExposure = 1.35;
renderer.autoClear = false;                             // manual clear for multi-pass
```

### ACES Filmic Tone Mapping

The ACES (Academy Color Encoding System) curve compresses HDR values into
the displayable [0, 1] range while preserving colour relationships in
highlights. This gives the game a cinematic look without post-processing.

### PCF Shadow Maps

Percentage-Closer Filtering softens shadow edges by sampling multiple
nearby texels and comparing each to the fragment depth, then averaging the
results. This eliminates hard aliasing on shadow boundaries.

---

## Summary of Graphics Techniques

| Category | Techniques Demonstrated |
|----------|------------------------|
| **Shaders** | 8 custom GLSL programs (vertex + fragment) |
| **Procedural Generation** | Noise-based terrain, textures, environment maps |
| **Materials** | PBR (MeshStandardMaterial), normal mapping, emissive mapping |
| **Lighting** | Hemisphere, directional, point lights; shadow mapping; dynamic flicker |
| **Animation** | FBX retargeting, state blending, procedural vertex animation |
| **Camera** | Third-person orbit, cinematic queued shots with interpolation |
| **Physics** | Custom cylinder-vs-AABB collision, raycasting |
| **Post-Processing** | Dissolve effect, damage flash, tone mapping |
| **Audio** | Positional 3D sound with distance falloff and stereo panning |
| **Optimisation** | Texture atlasing (canvas-generated), instanced geometry, LOD-aware shadow frustums |
