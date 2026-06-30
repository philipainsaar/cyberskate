'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const lerp = (a, b, t) => a + (b - a) * t;

// Polish-pass tuning values based on the actual uploaded GLBs.
// skate-park.glb is authored as a tiny diorama, so it must be enlarged for gameplay.
const PARK_SCALE = 28;
const SKATER_HEIGHT = 2.95;
const SKATER_FACING_OFFSET = 0;
const SPAWN_Z_BIAS = -0.33;
const WALKABLE_NORMAL_Y = 0.42;
const PLAYER_RADIUS = 0.58;

function makeNoise(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function makeCanvasTexture(kind, size = 512) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const rnd = makeNoise(kind.length * 977 + size);

  ctx.fillStyle = '#15130f';
  ctx.fillRect(0, 0, size, size);

  if (kind === 'brick') {
    ctx.fillStyle = '#3a1711';
    ctx.fillRect(0, 0, size, size);
    const brickH = 32;
    const brickW = 78;
    for (let y = 0; y < size + brickH; y += brickH) {
      const offset = (Math.floor(y / brickH) % 2) * (brickW / 2);
      for (let x = -brickW; x < size + brickW; x += brickW) {
        const shade = 30 + Math.floor(rnd() * 36);
        ctx.fillStyle = `rgb(${shade + 45}, ${shade * 0.45}, ${shade * 0.32})`;
        ctx.fillRect(x + offset + 2, y + 2, brickW - 4, brickH - 4);
      }
    }
  }

  if (kind === 'concrete') {
    const grd = ctx.createLinearGradient(0, 0, size, size);
    grd.addColorStop(0, '#252622');
    grd.addColorStop(1, '#11120f');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 2200; i++) {
      const a = 0.04 + rnd() * 0.12;
      const c = 40 + Math.floor(rnd() * 60);
      ctx.fillStyle = `rgba(${c}, ${c}, ${c}, ${a})`;
      ctx.fillRect(rnd() * size, rnd() * size, 1 + rnd() * 4, 1 + rnd() * 4);
    }
  }

  if (kind === 'wood') {
    ctx.fillStyle = '#74421f';
    ctx.fillRect(0, 0, size, size);
    for (let y = 0; y < size; y += 26) {
      ctx.fillStyle = y % 52 === 0 ? '#8c5228' : '#653718';
      ctx.fillRect(0, y, size, 22);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestMipmapNearestFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function mat(color, roughness = 0.85, metalness = 0.05, emissive = null, map = null) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness,
    emissive: emissive || 0x000000,
    emissiveIntensity: emissive ? 0.7 : 0,
    map
  });
}

function createFallbackPlayer(materials) {
  const root = new THREE.Group();
  root.name = 'FallbackSkaterRoot';

  const boardGroup = new THREE.Group();
  const deck = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.09, 2.15), materials.deck);
  deck.position.y = 0.12;
  deck.castShadow = true;
  boardGroup.add(deck);

  const axleGeo = new THREE.CylinderGeometry(0.035, 0.035, 1.0, 8);
  const wheelGeo = new THREE.CylinderGeometry(0.13, 0.13, 0.16, 10);
  [-0.68, 0.68].forEach((z) => {
    const axle = new THREE.Mesh(axleGeo, materials.metal);
    axle.rotation.z = Math.PI / 2;
    axle.position.set(0, 0.02, z);
    boardGroup.add(axle);
    [-0.55, 0.55].forEach((x) => {
      const wh = new THREE.Mesh(wheelGeo, materials.wheel);
      wh.rotation.z = Math.PI / 2;
      wh.position.set(x, -0.1, z);
      wh.castShadow = true;
      boardGroup.add(wh);
    });
  });
  root.add(boardGroup);

  const body = new THREE.Group();
  body.position.y = 0.25;
  root.add(body);

  const hips = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.32, 0.44), materials.blackCloth);
  hips.position.set(0, 1.02, -0.05);
  body.add(hips);

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.8, 0.38), materials.blackCloth);
  torso.position.set(0, 1.55, -0.03);
  torso.rotation.x = -0.12;
  body.add(torso);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.48, 0.38), materials.skin);
  head.position.set(0, 2.22, 0.02);
  body.add(head);

  const hair = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.3, 0.48), materials.hair);
  hair.position.set(0, 2.43, -0.02);
  body.add(hair);

  const bun = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.32, 0.32), materials.hair);
  bun.position.set(0, 2.72, -0.05);
  body.add(bun);

  const limb = (w, h, d, material, x, y, z, rx = 0, rz = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    m.position.set(x, y, z);
    m.rotation.x = rx;
    m.rotation.z = rz;
    body.add(m);
  };

  limb(0.25, 0.68, 0.28, materials.blackCloth, -0.32, 0.72, 0.02, 0.18, 0.1);
  limb(0.25, 0.68, 0.28, materials.blackCloth, 0.32, 0.72, 0.02, -0.18, -0.1);
  limb(0.32, 0.42, 0.62, materials.boots, -0.3, 0.23, 0.28, -0.18, 0);
  limb(0.32, 0.42, 0.62, materials.boots, 0.3, 0.23, -0.28, 0.15, 0);
  limb(0.2, 0.72, 0.2, materials.skin, -0.58, 1.55, 0.0, 0.1, -0.75);
  limb(0.2, 0.72, 0.2, materials.skin, 0.58, 1.55, 0.0, -0.1, 0.75);

  root.userData.boardGroup = boardGroup;
  root.userData.skaterGroup = body;
  root.traverse((obj) => {
    if (obj.isMesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });
  return root;
}

function initAudio() {
  if (typeof window === 'undefined') return null;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return null;
  const ctx = new AudioContext();
  const master = ctx.createGain();
  master.gain.value = 0.32;
  master.connect(ctx.destination);

  const rollOsc = ctx.createOscillator();
  const rollGain = ctx.createGain();
  const rollFilter = ctx.createBiquadFilter();
  rollOsc.type = 'sawtooth';
  rollOsc.frequency.value = 45;
  rollGain.gain.value = 0;
  rollFilter.type = 'lowpass';
  rollFilter.frequency.value = 130;
  rollOsc.connect(rollFilter);
  rollFilter.connect(rollGain);
  rollGain.connect(master);
  rollOsc.start();

  const beep = (freq, dur, type = 'square', gain = 0.12) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    o.connect(g);
    g.connect(master);
    o.start();
    o.stop(ctx.currentTime + dur + 0.02);
  };

  const scrape = (dur = 0.12, gain = 0.2) => {
    const buffer = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const source = ctx.createBufferSource();
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 900;
    g.gain.value = gain;
    source.buffer = buffer;
    source.connect(f);
    f.connect(g);
    g.connect(master);
    source.start();
  };

  return {
    ctx,
    rollGain,
    rollOsc,
    setRolling(speed, onGround) {
      const target = onGround ? clamp(speed / 18, 0, 1) * 0.18 : 0;
      rollGain.gain.setTargetAtTime(target, ctx.currentTime, 0.05);
      rollOsc.frequency.setTargetAtTime(36 + speed * 8, ctx.currentTime, 0.04);
    },
    pop() { beep(190, 0.09, 'triangle', 0.2); },
    land() { scrape(0.08, 0.18); beep(70, 0.06, 'sine', 0.08); },
    trick() { beep(500 + Math.random() * 320, 0.08, 'square', 0.11); },
    bonk() { scrape(0.09, 0.25); beep(85, 0.08, 'sawtooth', 0.13); },
    grind() { scrape(0.11, 0.13); }
  };
}

function normalizeObjectToGround(object, targetHeight = 2.8) {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const scale = targetHeight / Math.max(size.y, 0.001);
  object.scale.multiplyScalar(scale);
  object.updateMatrixWorld(true);
  const scaledBox = new THREE.Box3().setFromObject(object);
  const scaledCenter = scaledBox.getCenter(new THREE.Vector3());
  object.position.x -= scaledCenter.x;
  object.position.z -= scaledCenter.z;
  object.position.y -= scaledBox.min.y;
  object.updateMatrixWorld(true);
  return object;
}

function fitParkToWorld(parkRoot) {
  parkRoot.scale.setScalar(PARK_SCALE);
  parkRoot.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(parkRoot);
  const center = box.getCenter(new THREE.Vector3());
  parkRoot.position.x -= center.x;
  parkRoot.position.z -= center.z;
  parkRoot.position.y -= box.min.y;
  parkRoot.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(parkRoot);
}

function loadGLB(loader, url) {
  return new Promise((resolve, reject) => {
    loader.load(url, resolve, undefined, reject);
  });
}

export default function CyberSkateGame() {
  const mountRef = useRef(null);
  const [stats, setStats] = useState({ score: 0, combo: 1, speed: 0, trick: 'LOADING' });

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x070605);
    scene.fog = new THREE.Fog(0x070605, 24, 120);

    const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 400);
    camera.position.set(0, 4.2, -7.5);

    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.domElement.className = 'gameCanvas';
    mount.appendChild(renderer.domElement);

    const textures = {
      concrete: makeCanvasTexture('concrete'),
      wood: makeCanvasTexture('wood')
    };
    textures.concrete.repeat.set(16, 16);
    textures.wood.repeat.set(2, 4);

    const materials = {
      concrete: mat(0x30302b, 0.93, 0.02, null, textures.concrete),
      wood: mat(0x7b4625, 0.78, 0.03, null, textures.wood),
      metal: mat(0x7d776b, 0.45, 0.65),
      deck: mat(0x12100d, 0.72, 0.12),
      wheel: mat(0xf3d8a1, 0.52, 0.1),
      skin: mat(0xd09363, 0.85, 0.02),
      blackCloth: mat(0x070706, 0.88, 0.03),
      hair: mat(0x050505, 0.7, 0.02),
      boots: mat(0x0a0a09, 0.62, 0.18)
    };

    const hemi = new THREE.HemisphereLight(0x75839b, 0x150f0b, 1.1);
    scene.add(hemi);
    const warm = new THREE.DirectionalLight(0xffb45b, 1.35);
    warm.position.set(-8, 18, -12);
    warm.castShadow = true;
    warm.shadow.mapSize.set(1024, 1024);
    warm.shadow.camera.near = 0.5;
    warm.shadow.camera.far = 120;
    warm.shadow.camera.left = -50;
    warm.shadow.camera.right = 50;
    warm.shadow.camera.top = 50;
    warm.shadow.camera.bottom = -50;
    scene.add(warm);

    const greenLight = new THREE.PointLight(0x83ff30, 1.3, 28, 2.1);
    greenLight.position.set(4, 5, 8);
    scene.add(greenLight);
    const amber1 = new THREE.PointLight(0xffb035, 1.6, 40, 2);
    amber1.position.set(-14, 9, 19);
    scene.add(amber1);
    const amber2 = new THREE.PointLight(0xffcc6c, 1.2, 34, 2);
    amber2.position.set(18, 7, -18);
    scene.add(amber2);

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), materials.concrete);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    const colliders = [];
    const rails = [];
    const parkCollisionMeshes = [];
    const downRay = new THREE.Raycaster();
    const downOrigin = new THREE.Vector3();
    const downDir = new THREE.Vector3(0, -1, 0);
    const wallRay = new THREE.Raycaster();
    const wallOrigin = new THREE.Vector3();
    const wallDir = new THREE.Vector3();

    const playerRoot = new THREE.Group();
    const playerLean = new THREE.Group();
    playerRoot.add(playerLean);
    scene.add(playerRoot);

    const state = {
      pos: new THREE.Vector3(0, 0, -12),
      y: 0,
      vy: 0,
      yaw: 0,
      speed: 0,
      grounded: true,
      grindTimer: 0,
      score: 0,
      combo: 1,
      trick: 'LOADING',
      lastStatT: 0,
      wasGrounded: true,
      hitCooldown: 0,
      trickCooldown: 0,
      airtime: 0,
      loaded: false
    };

    const input = {
      steer: 0,
      brake: false,
      pushPower: 0,
      jumpQueued: false,
      trickQueued: false,
      keys: new Set(),
      pointer: null
    };

    const audio = { current: null };
    const ensureAudio = () => {
      if (!audio.current) audio.current = initAudio();
      if (audio.current?.ctx?.state === 'suspended') audio.current.ctx.resume();
    };

    const animationMixers = [];
    let currentVisual = null;
    const animationControls = { mixer: null, action: null, clipName: '' };

    function mountPlayerVisual(object) {
      if (currentVisual) playerLean.remove(currentVisual);
      currentVisual = object;
      playerLean.add(currentVisual);
    }

    function addBoundaryWalls(bounds) {
      const size = bounds.getSize(new THREE.Vector3());
      const center = bounds.getCenter(new THREE.Vector3());
      const thickness = 1;
      const h = Math.max(size.y + 6, 8);
      const halfW = size.x / 2 + 2;
      const halfD = size.z / 2 + 2;
      colliders.push(
        { name: 'back boundary', x: center.x, z: center.z + halfD, w: size.x + 4, d: thickness, h },
        { name: 'front boundary', x: center.x, z: center.z - halfD, w: size.x + 4, d: thickness, h },
        { name: 'left boundary', x: center.x - halfW, z: center.z, w: thickness, d: size.z + 4, h },
        { name: 'right boundary', x: center.x + halfW, z: center.z, w: thickness, d: size.z + 4, h }
      );
    }

    function addFallbackGrindZones(bounds) {
      const size = bounds.getSize(new THREE.Vector3());
      const center = bounds.getCenter(new THREE.Vector3());
      rails.push(
        { name: 'center ledge helper', x: center.x, z: center.z, len: Math.max(6, size.x * 0.34), horizontal: true, h: 1.05 },
        { name: 'side rail helper', x: center.x - size.x * 0.24, z: center.z + size.z * 0.12, len: Math.max(6, size.z * 0.32), horizontal: false, h: 1.0 }
      );
    }

    function registerParkCollision(parkRoot) {
      parkRoot.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(parkRoot);
      const boundsSize = bounds.getSize(new THREE.Vector3());
      addBoundaryWalls(bounds);

      const meshes = [];
      parkRoot.traverse((obj) => {
        if (!obj.isMesh) return;
        obj.castShadow = true;
        obj.receiveShadow = true;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((m) => {
          if (!m) return;
          if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
          m.roughness = Math.min(1, m.roughness ?? 0.9);
          m.needsUpdate = true;
        });
        parkCollisionMeshes.push(obj);
        const box = new THREE.Box3().setFromObject(obj);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        meshes.push({ obj, box, size, center });
      });

      const singleMergedParkMesh = meshes.length <= 2;
      for (const item of meshes) {
        const obj = item.obj;
        const box = item.box;
        const size = item.size;
        const center = item.center;
        const lowerName = (obj.name || '').toLowerCase();
        const isMainMergedMesh = singleMergedParkMesh || (size.x > boundsSize.x * 0.7 && size.z > boundsSize.z * 0.7);

        const isRailByName = lowerName.includes('rail') || lowerName.includes('grind');
        const isThinRailShape = size.y < 0.8 && ((size.x > 3 && size.z < 1.1) || (size.z > 3 && size.x < 1.1));
        if (isRailByName || isThinRailShape) {
          rails.push({
            name: obj.name || 'rail',
            x: center.x,
            z: center.z,
            len: Math.max(size.x, size.z),
            horizontal: size.x >= size.z,
            h: box.max.y
          });
          continue;
        }

        // If the park was exported as one merged mesh, a bounding box collider would block the whole map.
        // Use triangle raycasts for the merged mesh instead, and keep only boundaries + helper rails.
        if (isMainMergedMesh) continue;

        const looksRideableSlope = (
          box.min.y < 0.65 &&
          size.y > 0.3 &&
          size.y < 7 &&
          (size.x > 2 || size.z > 2) &&
          (size.y / Math.max(size.x, size.z)) < 0.6 &&
          (lowerName.includes('ramp') || lowerName.includes('quarter') || lowerName.includes('bank') || lowerName.includes('kicker'))
        );

        if (!looksRideableSlope && size.x > 0.35 && size.y > 0.35 && size.z > 0.35) {
          colliders.push({
            name: obj.name || 'park object',
            x: center.x,
            z: center.z,
            w: size.x,
            d: size.z,
            h: box.max.y
          });
        }
      }

      if (!rails.length) addFallbackGrindZones(bounds);
      return bounds;
    }

    function wouldHitParkWall(from, move, radius) {
      if (!parkCollisionMeshes.length || move.lengthSq() < 0.0001) return false;
      wallDir.copy(move).normalize();
      const far = move.length() + radius + 0.18;
      const heights = [0.55, 1.15, 2.0];
      for (const h of heights) {
        wallOrigin.set(from.x, state.y + h, from.z).addScaledVector(wallDir, -0.08);
        wallRay.set(wallOrigin, wallDir);
        wallRay.far = far;
        const hits = wallRay.intersectObjects(parkCollisionMeshes, true);
        for (const hit of hits) {
          if (hit.distance > far) continue;
          const n = hit.face?.normal ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
          if (n.y < WALKABLE_NORMAL_Y && hit.point.y > state.y + 0.18 && hit.point.y < state.y + 2.7) return true;
        }
      }
      return false;
    }

    function findSpawnPoint(bounds) {
      const size = bounds.getSize(new THREE.Vector3());
      const center = bounds.getCenter(new THREE.Vector3());
      const preferred = new THREE.Vector3(center.x, 0, center.z + size.z * SPAWN_Z_BIAS);
      const candidates = [preferred];
      for (let iz = -3; iz <= 2; iz++) {
        for (let ix = -2; ix <= 2; ix++) {
          candidates.push(new THREE.Vector3(
            center.x + ix * size.x * 0.11,
            0,
            center.z + (SPAWN_Z_BIAS + iz * 0.09) * size.z
          ));
        }
      }
      let best = preferred;
      let bestScore = -Infinity;
      for (const c of candidates) {
        const g = getGroundInfo(c.x, c.z, 4);
        const flatness = g.normal.y;
        const score = flatness * 10 - Math.abs(c.x - center.x) * 0.03 - Math.abs(c.z - preferred.z) * 0.02 + g.y * 0.02;
        if (flatness > 0.55 && score > bestScore) {
          bestScore = score;
          best = new THREE.Vector3(c.x, g.y, c.z);
        }
      }
      return best;
    }

    const loader = new GLTFLoader();
    let disposed = false;

    const loadAssets = async () => {
      try {
        const [parkGltf, skaterGltf] = await Promise.all([
          loadGLB(loader, '/models/skate-park.glb'),
          loadGLB(loader, '/models/skater.glb')
        ]);
        if (disposed) return;

        const park = parkGltf.scene;
        park.position.set(0, 0, 0);
        park.rotation.y = 0;
        scene.add(park);
        const fittedParkBounds = fitParkToWorld(park);
        const parkBounds = registerParkCollision(park);
        const parkSize = parkBounds.getSize(new THREE.Vector3());

        const visual = new THREE.Group();
        const skaterScene = skaterGltf.scene;
        normalizeObjectToGround(skaterScene, SKATER_HEIGHT);
        skaterScene.rotation.y = SKATER_FACING_OFFSET;
        skaterScene.traverse((obj) => {
          if (!obj.isMesh) return;
          obj.castShadow = true;
          obj.receiveShadow = true;
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          mats.forEach((m) => {
            if (!m) return;
            if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
            if (m.emissive) m.emissiveIntensity = Math.max(m.emissiveIntensity || 0, 0.18);
            m.needsUpdate = true;
          });
        });
        visual.add(skaterScene);
        visual.userData.boardGroup = skaterScene;
        visual.userData.skaterGroup = skaterScene;
        mountPlayerVisual(visual);

        if (skaterGltf.animations?.length) {
          const mixer = new THREE.AnimationMixer(skaterScene);
          const clip = skaterGltf.animations.find((c) => /skate|idle|walk|run|base/i.test(c.name)) || skaterGltf.animations[0];
          const action = mixer.clipAction(clip);
          action.enabled = true;
          action.setEffectiveWeight(1);
          action.play();
          animationMixers.push(mixer);
          animationControls.mixer = mixer;
          animationControls.action = action;
          animationControls.clipName = clip.name;
        }

        const spawn = findSpawnPoint(parkBounds || fittedParkBounds);
        state.pos.set(spawn.x, spawn.y, spawn.z);
        state.y = spawn.y;
        state.yaw = 0;
        state.trick = `READY ${Math.round(parkSize.x)}x${Math.round(parkSize.z)}`;
        state.loaded = true;
      } catch (err) {
        console.error('GLB load failed, using fallback skater / park floor.', err);
        const fallback = createFallbackPlayer(materials);
        fallback.userData.boardGroup = fallback.userData.boardGroup || fallback;
        fallback.userData.skaterGroup = fallback.userData.skaterGroup || fallback;
        mountPlayerVisual(fallback);
        colliders.push(
          { name: 'left wall', x: -36, z: 0, w: 1.2, d: 72, h: 20 },
          { name: 'right wall', x: 36, z: 0, w: 1.2, d: 72, h: 20 },
          { name: 'front wall', x: 0, z: -36, w: 72, d: 1.2, h: 12 },
          { name: 'back wall', x: 0, z: 36, w: 72, d: 1.2, h: 12 }
        );
        state.trick = 'FALLBACK';
        state.loaded = true;
      }
    };
    loadAssets();

    const resolveBox = (candidate, b, radius) => {
      const minX = b.x - b.w / 2 - radius;
      const maxX = b.x + b.w / 2 + radius;
      const minZ = b.z - b.d / 2 - radius;
      const maxZ = b.z + b.d / 2 + radius;
      if (candidate.x < minX || candidate.x > maxX || candidate.z < minZ || candidate.z > maxZ) return false;

      const topRide = state.y >= b.h - 0.55 && state.vy <= 0.7;
      if (topRide && b.h <= 5.5) return false;

      const pushLeft = Math.abs(candidate.x - minX);
      const pushRight = Math.abs(maxX - candidate.x);
      const pushBack = Math.abs(candidate.z - minZ);
      const pushFront = Math.abs(maxZ - candidate.z);
      const minPush = Math.min(pushLeft, pushRight, pushBack, pushFront);
      if (minPush === pushLeft) candidate.x = minX;
      else if (minPush === pushRight) candidate.x = maxX;
      else if (minPush === pushBack) candidate.z = minZ;
      else candidate.z = maxZ;
      return true;
    };

    const getGroundInfo = (x, z, currentY) => {
      if (!parkCollisionMeshes.length) return { y: 0, normal: new THREE.Vector3(0, 1, 0) };
      downOrigin.set(x, currentY + 80, z);
      downRay.set(downOrigin, downDir);
      downRay.far = 140;
      const hits = downRay.intersectObjects(parkCollisionMeshes, true);
      if (!hits.length) return { y: 0, normal: new THREE.Vector3(0, 1, 0) };
      let best = null;
      for (const hit of hits) {
        if (hit.point.y > currentY + 7.0) continue;
        if (!best || hit.point.y > best.point.y) best = hit;
      }
      if (!best) return { y: 0, normal: new THREE.Vector3(0, 1, 0) };
      const worldNormal = best.face?.normal ? best.face.normal.clone().transformDirection(best.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
      return { y: best.point.y, normal: worldNormal };
    };

    const doJump = (force = 9.4) => {
      if (!state.grounded && state.grindTimer <= 0) return;
      state.vy = force;
      state.grounded = false;
      state.grindTimer = 0;
      state.airtime = 0;
      input.jumpQueued = false;
      state.trick = 'OLLIE';
      audio.current?.pop();
    };

    const doTrick = () => {
      if (state.trickCooldown > 0) return;
      state.trickCooldown = 0.25;
      state.score += Math.round(150 * state.combo);
      state.combo = Math.min(12, state.combo + 1);
      state.trick = state.grounded ? 'MANUAL TAP' : 'AIR TWIST';
      audio.current?.trick();
    };

    const onPointerDown = (e) => {
      ensureAudio();
      input.pointer = {
        id: e.pointerId,
        sx: e.clientX,
        sy: e.clientY,
        lx: e.clientX,
        ly: e.clientY,
        t: performance.now(),
        moved: 0
      };
      mount.setPointerCapture?.(e.pointerId);
    };

    const onPointerMove = (e) => {
      if (!input.pointer || input.pointer.id !== e.pointerId) return;
      const p = input.pointer;
      const dx = e.clientX - p.sx;
      const dy = e.clientY - p.sy;
      const ddx = e.clientX - p.lx;
      const ddy = e.clientY - p.ly;
      p.lx = e.clientX;
      p.ly = e.clientY;
      p.moved += Math.abs(ddx) + Math.abs(ddy);

      input.steer = clamp(dx / 85, -1, 1);
      const upDelta = Math.max(0, -ddy);
      const downTotal = Math.max(0, dy);
      if (upDelta > 0.2) input.pushPower += upDelta * 0.11;
      input.brake = downTotal > 16 && Math.abs(dy) > Math.abs(dx) * 0.55;
      if (-dy > 94 && performance.now() - p.t < 420 && state.grounded) input.jumpQueued = true;
    };

    const onPointerUp = (e) => {
      if (!input.pointer || input.pointer.id !== e.pointerId) return;
      const p = input.pointer;
      const dx = e.clientX - p.sx;
      const dy = e.clientY - p.sy;
      const dt = performance.now() - p.t;
      if (-dy > 32 && dt < 360) input.pushPower += 8.2;
      if (-dy > 122 && dt < 440) input.jumpQueued = true;
      if (Math.abs(dx) > 80 && dt < 360 && !state.grounded) input.trickQueued = true;
      if (p.moved < 10) input.trickQueued = true;
      input.pointer = null;
      input.brake = false;
      input.steer *= 0.25;
    };

    const onKeyDown = (e) => {
      ensureAudio();
      input.keys.add(e.code);
      if (e.code === 'Space') input.jumpQueued = true;
      if (e.code === 'KeyF') input.trickQueued = true;
    };
    const onKeyUp = (e) => input.keys.delete(e.code);

    mount.addEventListener('pointerdown', onPointerDown);
    mount.addEventListener('pointermove', onPointerMove);
    mount.addEventListener('pointerup', onPointerUp);
    mount.addEventListener('pointercancel', onPointerUp);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    let raf = 0;
    let last = performance.now();
    const playerRadius = PLAYER_RADIUS;
    const forward = new THREE.Vector3();
    const cameraTarget = new THREE.Vector3();
    const desiredCamera = new THREE.Vector3();
    const lookTarget = new THREE.Vector3();

    const animate = (now) => {
      const dt = Math.min(0.033, (now - last) / 1000 || 0.016);
      last = now;
      animationMixers.forEach((mixer) => mixer.update(dt));
      if (animationControls.action) {
        const moving = state.speed > 1.2 || !state.grounded;
        animationControls.action.paused = !moving;
        animationControls.action.timeScale = clamp(0.55 + state.speed / 9, 0.6, 2.4);
      }

      const keyForward = input.keys.has('KeyW') || input.keys.has('ArrowUp');
      const keyBrake = input.keys.has('KeyS') || input.keys.has('ArrowDown');
      const keyLeft = input.keys.has('KeyA') || input.keys.has('ArrowLeft');
      const keyRight = input.keys.has('KeyD') || input.keys.has('ArrowRight');
      if (keyForward) input.pushPower += 0.55;
      input.brake = input.brake || keyBrake;
      let steer = input.steer;
      if (keyLeft) steer -= 1;
      if (keyRight) steer += 1;
      steer = clamp(steer, -1, 1);

      const push = clamp(input.pushPower, 0, 12.5);
      state.speed += push * 0.96;
      input.pushPower = Math.max(0, input.pushPower - 20 * dt);

      const maxSpeed = 24.5;
      const friction = state.grounded ? 0.985 : 0.995;
      state.speed *= Math.pow(friction, dt * 60);
      if (input.brake) {
        state.speed -= (18 + state.speed * 1.2) * dt;
        if (state.speed < 0) state.speed = 0;
      }
      state.speed = clamp(state.speed, 0, maxSpeed);

      const stationaryAim = state.speed < 0.75;
      const turnRate = stationaryAim ? 2.65 : lerp(1.7, 4.15, clamp(state.speed / maxSpeed, 0, 1));
      state.yaw -= steer * turnRate * dt;
      if (!input.pointer) input.steer *= Math.pow(0.05, dt);

      if (input.jumpQueued) doJump(state.speed > 12 ? 10.3 : 9.35);
      if (input.trickQueued) {
        doTrick();
        input.trickQueued = false;
      }
      state.trickCooldown = Math.max(0, state.trickCooldown - dt);
      state.hitCooldown = Math.max(0, state.hitCooldown - dt);

      forward.set(Math.sin(state.yaw), 0, Math.cos(state.yaw));
      const move = forward.clone().multiplyScalar(state.speed * dt);
      const candidate = state.pos.clone().add(move);
      let hit = false;
      for (const b of colliders) hit = resolveBox(candidate, b, playerRadius) || hit;
      hit = wouldHitParkWall(state.pos, move, playerRadius) || hit;
      if (hit) {
        state.speed *= 0.28;
        state.combo = 1;
        state.trick = 'BONK';
        if (state.hitCooldown <= 0) {
          state.hitCooldown = 0.22;
          audio.current?.bonk();
        }
      }
      if (!hit) state.pos.copy(candidate);

      const groundInfo = getGroundInfo(state.pos.x, state.pos.z, state.y);
      const groundY = groundInfo.y;
      state.wasGrounded = state.grounded;
      if (!state.grounded || state.vy > 0 || state.y > groundY + 0.02) {
        state.vy -= 20.5 * dt;
        state.y += state.vy * dt;
        state.airtime += dt;
      } else {
        state.y = groundY;
      }
      if (state.y <= groundY) {
        state.y = groundY;
        if (!state.wasGrounded && state.airtime > 0.15) {
          state.score += Math.round((80 + state.airtime * 180) * state.combo);
          state.trick = 'LAND';
          audio.current?.land();
        }
        state.grounded = true;
        state.vy = 0;
        state.airtime = 0;
      } else {
        state.grounded = false;
      }

      let grinding = false;
      for (const rail of rails) {
        const dx = Math.abs(state.pos.x - rail.x);
        const dz = Math.abs(state.pos.z - rail.z);
        const close = rail.horizontal ? dx < rail.len / 2 && dz < 0.7 : dz < rail.len / 2 && dx < 0.7;
        if (close && Math.abs(state.y - rail.h) < 0.72 && state.speed > 3.2) {
          grinding = true;
          state.y = rail.h;
          state.vy = Math.max(state.vy, 0);
          state.grounded = false;
          state.grindTimer += dt;
          state.score += Math.round(22 * state.combo * dt * 60);
          state.combo = Math.min(12, state.combo + dt * 0.25);
          state.trick = 'GRIND';
          if (Math.floor(state.grindTimer * 8) !== Math.floor((state.grindTimer - dt) * 8)) audio.current?.grind();
          break;
        }
      }
      if (!grinding) state.grindTimer = 0;

      playerRoot.position.set(state.pos.x, state.y, state.pos.z);
      playerRoot.rotation.y = state.yaw;
      const tilt = clamp(steer, -1, 1) * clamp(state.speed / 12, 0, 1) * 0.22;
      playerLean.rotation.z = lerp(playerLean.rotation.z, -tilt * 0.35, 0.14);
      playerLean.position.y = state.grounded ? Math.sin(now * 0.016 * Math.max(state.speed, 1)) * 0.02 : 0.05;
      if (!state.grounded) {
        playerLean.rotation.x = lerp(playerLean.rotation.x, -0.08 + clamp(state.vy * 0.02, -0.2, 0.2), 0.08);
      } else {
        playerLean.rotation.x = lerp(playerLean.rotation.x, 0, 0.12);
      }

      desiredCamera.copy(state.pos).addScaledVector(forward, -6.8).add(new THREE.Vector3(0, 3.4 + clamp(state.speed / 10, 0, 1.0), 0));
      cameraTarget.lerp(desiredCamera, 1 - Math.pow(0.00005, dt));
      camera.position.copy(cameraTarget);
      lookTarget.copy(state.pos).addScaledVector(forward, 5.2).add(new THREE.Vector3(0, 1.45, 0));
      camera.lookAt(lookTarget);

      greenLight.position.set(state.pos.x - forward.x * 2.3, state.y + 3.2, state.pos.z - forward.z * 2.3);
      audio.current?.setRolling(state.speed, state.grounded && !input.brake);

      if (now - state.lastStatT > 120) {
        state.lastStatT = now;
        setStats({
          score: Math.floor(state.score),
          combo: Number(state.combo).toFixed(1),
          speed: Math.round(state.speed * 4),
          trick: state.trick
        });
      }

      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    };

    raf = requestAnimationFrame(animate);

    const onResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', onResize);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      mount.removeEventListener('pointerdown', onPointerDown);
      mount.removeEventListener('pointermove', onPointerMove);
      mount.removeEventListener('pointerup', onPointerUp);
      mount.removeEventListener('pointercancel', onPointerUp);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('resize', onResize);
      audio.current?.ctx?.close?.();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
      scene.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose?.();
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose?.());
          else obj.material.dispose?.();
        }
      });
    };
  }, []);

  return (
    <main className="gameShell" ref={mountRef}>
      <div className="touchPad" aria-hidden="true" />
      <div className="hud">
        <div className="hudBox">
          <span className="hudLabel">score</span>
          <span className="hudValue">{stats.score}</span>
        </div>
        <div className="hudBox">
          <span className="hudLabel">combo</span>
          <span className="hudValue">x{stats.combo}</span>
        </div>
        <div className="hudBox">
          <span className="hudLabel">speed</span>
          <span className="hudValue">{stats.speed}</span>
        </div>
      </div>
      <div className="toast">
        {stats.trick} · GLB skater + park · swipe up to push · swipe up-left/up-right to carve · swipe down to brake · fast swipe up to ollie
      </div>
      <div className="cornerNote">WASD / arrows · space ollie · F trick</div>
      <div className="scanlines" />
    </main>
  );
}
