// Interactive 3D globe of Generation > Digital twin: the map of GlobeMap.js (wave heights on a dark-gray world), drag
// to turn it, wheel / pinch to zoom, click to pick a point (onPick(lat, lon)). An HTML marker (any element) follows the
// picked point and hides behind the globe.
//
// Two textures: the whole world (GlobeMap.baseMapNow, 11 px/°), and, when the camera comes close, the part in view at
// 2 or 4 times that (a detail, GlobeMap.renderRegion), drawn over it and faded in at its edges. The detail follows the
// view once the camera stops.
//
// Its own renderer and canvas, apart from the sea: it draws only when something changed (camera, texture, size).
//
// Texture: equirectangular (lon -180..180 from left to right, lat 90..-90 from top to bottom), as THREE.SphereGeometry
// maps it (u = (lon + 180) / 360, v = (lat + 90) / 180): lon 0 on +x, lon 90°E on -z, north on +y.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { baseMapNow, renderRegion, MAP_COLORS, BASE_PX_PER_DEG, DETAIL_WAVE_LEVEL } from './GlobeMap.js';

const RADIUS = 1;
const DISTANCE = [1.45, 6], START_DISTANCE = 4.3; // Camera from the centre (radius 1); 4.3: the whole globe and its haze
const FOV = 32;
const CLICK_PX = 5;   // A drag shorter than this is a click
const CLICK_MS = 600;
const UPLOAD_MS = 250; // A texture that is still being drawn is sent to the GPU at most this often

// DETAIL: from 1.4 times the resolution of the world on screen; 2 or 4 times it (one or two levels more)
const DETAIL_FROM = 1.4;
const DETAIL_LEVELS = [2, 4];
const DETAIL_MAX_PX = 2560;   // Largest side of a detail (canvas)
const DETAIL_MARGIN = 0.25;   // Around the view, on each side (fraction of the view): room to turn a little
const DETAIL_WAIT_MS = 350;   // After the camera stops
const DETAIL_FADE_S = 0.35;
const DETAIL_EDGE = 0.06;     // Fade at its edges (fraction of the detail)

export class Globe {

  constructor(canvas, { marker = null, onPick = null, onLoading = null, lat = 25, lon = -15 } = {}) {
    this.canvas = canvas;
    this.marker = marker;
    this.onPick = onPick;
    this.onLoading = onLoading; // ({base: 'loading' | 'ready' | 'error', detail: boolean})
    this.picked = null;
    this.status = { base: 'loading', detail: false };

    // Renderer, scene, camera
    const renderer = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.01, 50);
    this.camera.position.copy(Globe.vectorOf(lat, lon, START_DISTANCE));

    // Unlit: the colours of the map are those of its legend
    this.material = createGlobeMaterial();
    this.globe = new THREE.Mesh(new THREE.SphereGeometry(RADIUS, 192, 96), this.material);
    this.scene.add(this.globe);
    this.scene.add(createAtmosphere());

    // Controls: turn and zoom around the centre, slower when close
    const controls = this.controls = new OrbitControls(this.camera, canvas);
    Object.assign(controls, { enablePan: false, enableDamping: true, dampingFactor: 0.1, rotateSpeed: 0.5,
      zoomSpeed: 0.6, minDistance: DISTANCE[0], maxDistance: DISTANCE[1] });
    controls.addEventListener('change', () => {
      controls.rotateSpeed = 0.5 * Math.min(1, (this.camera.position.length() - RADIUS) / (START_DISTANCE - RADIUS)) + 0.04;
      this.dirty = true;
      this.viewChangedAt = performance.now();
      this.detailPending = true;
    });

    // Click (not a drag): pick a point
    this.onPointerDown = e => { this.down = { x: e.clientX, y: e.clientY, t: performance.now() }; };
    this.onPointerUp = e => {
      const d = this.down; this.down = null;
      if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > CLICK_PX || performance.now() - d.t > CLICK_MS) return;
      const p = this.pick(e.clientX, e.clientY);
      if (p && this.onPick) this.onPick(p.lat, p.lon);
    };
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointerup', this.onPointerUp);

    // Size of the canvas: its box in the page
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();

    // The world: shared by every globe, drawn as its tiles come
    const base = baseMapNow(c => this.setBase(c));
    this.time = base.time;
    this.offBase = base.off;
    base.job.done.then(() => this.setStatus({ base: 'ready' }), e => { console.error(e); this.setStatus({ base: 'error' }); });

    this.dirty = true;
    this.loop = this.loop.bind(this);
    this.frame = requestAnimationFrame(this.loop);
  }

  // Unit vector (times a distance) of a latitude and longitude, in the frame of the sphere
  static vectorOf(lat, lon, r = 1) {
    const phi = lat * Math.PI / 180, lambda = lon * Math.PI / 180;
    return new THREE.Vector3(r * Math.cos(phi) * Math.cos(lambda), r * Math.sin(phi), -r * Math.cos(phi) * Math.sin(lambda));
  }
  static latLonOf(v) {
    const p = v.clone().normalize();
    return { lat: Math.asin(p.y) * 180 / Math.PI, lon: Math.atan2(-p.z, p.x) * 180 / Math.PI };
  }

  setStatus(partial) {
    Object.assign(this.status, partial);
    if (this.onLoading) this.onLoading({ ...this.status });
  }

  // TEXTURES
  setBase(canvas) {
    const u = this.material.uniforms.baseMap;
    if (u.value.image !== canvas) {
      const old = u.value;
      u.value = mapTexture(canvas, this.renderer, true);
      old.dispose();
    } else this.basePending = true;
    this.dirty = true;
  }

  // DETAIL: what the view needs ({region, view}) or null (the world is sharp enough)
  wantedDetail() {
    const h = this.camera.position.length() - RADIUS;
    const pxPerDeg = this.renderer.domElement.height / (2 * h * Math.tan(FOV / 2 * Math.PI / 180)) * Math.PI / 180;
    const scale = pxPerDeg / BASE_PX_PER_DEG;
    if (scale < DETAIL_FROM) return null;
    const view = this.visibleBounds();
    if (!view) return null;
    // The view and a margin round it
    const m = DETAIL_MARGIN;
    let west = view.west - view.lonSpan * m, lonSpan = view.lonSpan * (1 + 2 * m);
    const north = Math.min(90, view.north + view.latSpan * m), south = Math.max(-90, view.north - view.latSpan * (1 + m));
    if (lonSpan >= 300) { west = -180; lonSpan = 360; }
    const latSpan = north - south;
    const level = scale < DETAIL_LEVELS[0] * 1.4 ? DETAIL_LEVELS[0] : DETAIL_LEVELS[1];
    const p = Math.min(BASE_PX_PER_DEG * level, DETAIL_MAX_PX / lonSpan, DETAIL_MAX_PX / latSpan);
    if (p < BASE_PX_PER_DEG * DETAIL_FROM) return null; // Too wide to be sharper than the world (e.g. over a pole)
    return { view, region: { west, north, lonSpan, latSpan, pxPerDeg: p } };
  }
  // Longitudes and latitudes in view: {west (in the frame of the longitude under the camera), north, lonSpan, latSpan}
  visibleBounds() {
    const raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2();
    const centre = Globe.latLonOf(this.camera.position);
    const N = 9;
    let west = Infinity, east = -Infinity, north = -90, south = 90, hits = 0;
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      ndc.set(i / (N - 1) * 2 - 1, j / (N - 1) * 2 - 1);
      raycaster.setFromCamera(ndc, this.camera);
      const hit = raycaster.intersectObject(this.globe)[0];
      if (!hit) continue;
      hits++;
      const { lat, lon } = Globe.latLonOf(hit.point);
      const l = centre.lon + (((lon - centre.lon) % 360 + 540) % 360 - 180); // Unwrapped round the centre
      west = Math.min(west, l); east = Math.max(east, l);
      north = Math.max(north, lat); south = Math.min(south, lat);
    }
    if (!hits) return null;
    // A pole in view: every longitude, up to the pole
    for (const pole of [90, -90]) {
      const v = Globe.vectorOf(pole, 0, RADIUS);
      const s = v.clone().project(this.camera);
      if (v.dot(this.camera.position.clone().sub(v)) > 0 && Math.abs(s.x) <= 1 && Math.abs(s.y) <= 1) {
        west = -180; east = 180;
        if (pole > 0) north = 90; else south = -90;
      }
    }
    return { west, north, lonSpan: Math.max(0.5, east - west), latSpan: Math.max(0.5, north - south) };
  }
  updateDetail() {
    const want = this.wantedDetail();
    if (!want) { this.cancelDetailJob(); this.detailTarget = 0; this.dirty = true; return; }
    const sharpEnough = d => d && d.region.pxPerDeg >= want.region.pxPerDeg * 0.85 && covers(d.region, want.view);
    if (sharpEnough(this.detail)) { this.detailTarget = 1; this.dirty = true; return; }
    if (sharpEnough(this.detailJob)) return; // On its way

    this.cancelDetailJob();
    const job = this.detailJob = renderRegion(want.region, { time: this.time, waveLevel: DETAIL_WAVE_LEVEL, onUpdate: () => {
      if (this.detail && this.detail.job === job) this.detailUpload = true;
    } });
    this.setStatus({ detail: true });
    job.ready.then(() => {
      if (this.detailJob !== job || this.disposed) return;
      this.showDetail(job);
      job.done.catch(e => console.warn(e)).finally(() => { if (this.detailJob === job) { this.detailJob = null; this.setStatus({ detail: false }); } });
    });
  }
  cancelDetailJob() {
    if (!this.detailJob) return;
    if (!this.detail || this.detail.job !== this.detailJob) this.detailJob.cancel();
    this.detailJob = null;
    this.setStatus({ detail: false });
  }
  showDetail(job) {
    const u = this.material.uniforms, r = job.region;
    if (this.detail && this.detail.job !== job) this.detail.job.cancel();
    const old = u.detailMap.value;
    u.detailMap.value = mapTexture(job.canvas, this.renderer, false);
    old.dispose();
    u.detailBox.value.set((r.west + 180) / 360, (r.north + 90) / 180, r.lonSpan / 360, r.latSpan / 180);
    u.detailMix.value = 0; // Fades in
    this.detail = { job, region: r };
    this.detailTarget = 1;
    this.dirty = true;
  }

  // PICKING: the latitude and longitude under a point of the screen, or null off the globe
  pick(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1);
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, this.camera);
    const hit = raycaster.intersectObject(this.globe)[0];
    return hit ? Globe.latLonOf(hit.point) : null;
  }

  // Point the marker follows (null hides it)
  setPicked(lat, lon) {
    this.picked = lat == null ? null : { lat, lon, v: Globe.vectorOf(lat, lon, RADIUS) };
    this.dirty = true;
  }
  // Turn the camera, at its distance, to look at a point
  lookAt(lat, lon) {
    this.camera.position.copy(Globe.vectorOf(lat, lon, this.camera.position.length()));
    this.controls.update();
    this.dirty = true;
  }

  // DRAWING
  resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
    this.detailPending = true;
    this.viewChangedAt = performance.now();
  }
  loop(t) {
    this.frame = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = this.lastFrame ? Math.min(0.1, (now - this.lastFrame) / 1000) : 0;
    this.lastFrame = now;
    this.controls.update(); // Damping: 'change' (dirty) while it slows down

    // Textures still being drawn: sent again now and then
    if ((this.basePending || this.detailUpload) && !(now - this.lastUpload < UPLOAD_MS)) {
      if (this.basePending) this.material.uniforms.baseMap.value.needsUpdate = true;
      if (this.detailUpload) this.material.uniforms.detailMap.value.needsUpdate = true;
      this.basePending = this.detailUpload = false;
      this.lastUpload = now;
      this.dirty = true;
    }
    // The detail of the view, once the camera has stopped
    if (this.detailPending && now - this.viewChangedAt > DETAIL_WAIT_MS) {
      this.detailPending = false;
      this.updateDetail();
    }
    // Fade of the detail
    const mix = this.material.uniforms.detailMix;
    const target = this.detailTarget || 0;
    if (mix.value != target) {
      const step = dt / DETAIL_FADE_S;
      mix.value = target > mix.value ? Math.min(target, mix.value + step) : Math.max(target, mix.value - step);
      this.dirty = true;
    }

    if (!this.dirty) return;
    this.dirty = false;
    this.renderer.render(this.scene, this.camera);
    this.placeMarker();
  }
  placeMarker() {
    if (!this.marker) return;
    const p = this.picked;
    // Visible while its side of the globe faces the camera
    const facing = p && p.v.dot(this.camera.position.clone().sub(p.v)) > 0;
    if (!facing) { this.marker.style.visibility = 'hidden'; return; }
    const s = p.v.clone().project(this.camera);
    const x = (s.x + 1) / 2 * this.canvas.clientWidth, y = (1 - s.y) / 2 * this.canvas.clientHeight;
    this.marker.style.visibility = 'visible';
    this.marker.style.transform = `translate(${x}px, ${y}px)`;
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.offBase();
    if (this.detailJob) this.detailJob.cancel();
    if (this.detail) this.detail.job.cancel();
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.controls.dispose();
    const u = this.material.uniforms;
    u.baseMap.value.dispose(); u.detailMap.value.dispose();
    this.scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}


// Whether a region (of a detail) holds a view; longitudes compared round the globe
function covers(region, view) {
  if (view.north > region.north + 1e-6 || view.north - view.latSpan < region.north - region.latSpan - 1e-6) return false;
  if (region.lonSpan >= 360) return true;
  const offset = ((view.west - region.west) % 360 + 360) % 360;
  return offset + view.lonSpan <= region.lonSpan + 1e-6;
}

// Texture of a map canvas. The world: mipmaps (seen from afar); a detail: seen about 1:1, and its fract() in the shader
// would break the mipmap at its western edge
function mapTexture(canvas, renderer, mipmaps) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  if (!mipmaps) { t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; }
  return t;
}
// Before the map: the colour of the ocean
function plainTexture(css) {
  const c = new THREE.Color(css).convertLinearToSRGB();
  const t = new THREE.DataTexture(new Uint8Array([c.r * 255, c.g * 255, c.b * 255, 255]), 1, 1);
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

// The world, and the detail over its box (u0, v of its north edge, u span, v span), faded in at its edges
function createGlobeMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      baseMap: { value: plainTexture(MAP_COLORS.ocean) },
      detailMap: { value: plainTexture(MAP_COLORS.ocean) },
      detailBox: { value: new THREE.Vector4(0, 1, 1, 1) },
      detailMix: { value: 0 },
    },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D baseMap;
      uniform sampler2D detailMap;
      uniform vec4 detailBox;
      uniform float detailMix;
      varying vec2 vUv;
      void main() {
        vec4 color = texture2D(baseMap, vUv);
        if (detailMix > 0.0) {
          // Position in the detail: west to east (round the globe), south to north (the canvas is upside down in v)
          vec2 d = vec2(fract(vUv.x - detailBox.x) / detailBox.z, 1.0 - (detailBox.y - vUv.y) / detailBox.w);
          if (d.x <= 1.0 && d.y >= 0.0 && d.y <= 1.0) {
            float ex = detailBox.z >= 0.999 ? 1.0 : min(d.x, 1.0 - d.x);
            float ey = min(detailBox.y >= 0.999 ? 1.0 : 1.0 - d.y, detailBox.y - detailBox.w <= 0.001 ? 1.0 : d.y);
            float w = detailMix * smoothstep(0.0, ${DETAIL_EDGE.toFixed(3)}, min(ex, ey));
            color = mix(color, texture2D(detailMap, d), w);
          }
        }
        gl_FragColor = color;
        #include <colorspace_fragment>
      }`,
  });
}

// Thin blue haze around the globe: the inside of a larger sphere, brighter towards its rim
function createAtmosphere() {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { color: { value: new THREE.Color(0.35, 0.6, 1.0) } },
    vertexShader: /* glsl */`
      varying vec3 vNormal;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 color;
      varying vec3 vNormal;
      void main() {
        // Seen from inside, the rim of the globe is where the normal turns most away from the camera (-0.45 for
        // a radius of 1.12), the outer edge of the haze where it is side-on (0)
        float glow = 0.75 * pow(clamp(-vNormal.z / 0.45, 0.0, 1.0), 2.0);
        gl_FragColor = vec4(color * glow, 1.0);
      }`,
  });
  return new THREE.Mesh(new THREE.SphereGeometry(RADIUS * 1.12, 96, 48), material);
}
