import * as THREE from 'three';
import { cushionGeometry, skirtGeometry, cushionPiping } from './upholstery';
import { extrudeArm, extrudeBack, backProfile, rolledArmOutline } from './profiles';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import {
  buildSofaParts,
  type SofaDocument,
  type SofaPart,
  type SurfaceAnchor,
  type Vec3,
} from './model';

export interface StudioDimension {
  id: string;
  name: string;
  value: number;
  a: THREE.Vector3;
  b: THREE.Vector3;
  edit?: { partId?: string; field: 'width' | 'height' | 'depth' };
}
interface StudioCallbacks {
  select(id: string | null): void;
  move(id: string, delta: Vec3): void;
  measure(a: SurfaceAnchor, b: SurfaceAnchor): void;
  edit(dimension: StudioDimension, anchor: HTMLElement): void;
  label(id: string, offset: { x: number; y: number }): void;
}
const v = (p: Vec3) => new THREE.Vector3(p.x, p.y, p.z);

export class SofaRenderer {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(35, 1, 1, 4000);
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  transform: TransformControls;
  model = new THREE.Group();
  dimensionsGroup = new THREE.Group();
  parts = new Map<string, { mesh: THREE.Group; part: SofaPart }>();
  dimensions: StudioDimension[] = [];
  selected: string | null = null;
  mode: 'orbit' | 'move' | 'measure' = 'orbit';
  showDimensions = true;
  showGrid = false;
  exploded = false;
  private doc!: SofaDocument;
  private labels = new Map<string, HTMLButtonElement>();
  private raycaster = new THREE.Raycaster();
  private resizeObserver: ResizeObserver;
  private frame = 0;
  private active = false;
  private moved = false;
  private down = { x: 0, y: 0 };
  private firstAnchor: SurfaceAnchor | null = null;
  private firstMarker: THREE.Mesh;
  private grid: THREE.GridHelper;
  private fabricTexture: THREE.CanvasTexture;
  private environment: THREE.WebGLRenderTarget;
  private geometryMaterials: THREE.Material[] = [];
  private statusElement: HTMLElement;
  private selectedOutline: THREE.Box3Helper;
  private oldPosition = new THREE.Vector3();
  private labelDrag: {
    id: string;
    x: number;
    y: number;
    original: { x: number; y: number };
    moved: boolean;
  } | null = null;
  private abort = new AbortController();

  constructor(
    private host: HTMLElement,
    private overlay: HTMLElement,
    private callbacks: StudioCallbacks
  ) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.8;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.prepend(this.renderer.domElement);
    this.renderer.domElement.setAttribute(
      'aria-label',
      'Interactive 3D sofa. Drag to orbit, scroll to zoom, click a part to edit.'
    );
    this.renderer.domElement.tabIndex = 0;
    this.scene.background = new THREE.Color('#e9e7e1');
    this.scene.fog = new THREE.Fog('#e9e7e1', 900, 1900);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.environment = pmrem.fromScene(room, 0.05);
    this.scene.environment = this.environment.texture;
    this.scene.environmentIntensity = 0.55;
    room.dispose();
    pmrem.dispose();
    this.scene.add(new THREE.HemisphereLight('#fff9ef', '#888c83', 0.8));
    const key = new THREE.DirectionalLight('#fff6e7', 2);
    key.position.set(-170, 350, 180);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -450;
    key.shadow.camera.right = 450;
    key.shadow.camera.top = 450;
    key.shadow.camera.bottom = -450;
    key.shadow.camera.near = 10;
    key.shadow.camera.far = 1000;
    key.shadow.bias = -0.0002;
    key.shadow.normalBias = 0.3;
    key.shadow.radius = 5;
    this.scene.add(key);
    const fill = new THREE.DirectionalLight('#e5ecf2', 0.7);
    fill.position.set(240, 180, -150);
    this.scene.add(fill);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(4000, 4000),
      new THREE.MeshStandardMaterial({ color: '#e9e7e1', roughness: 1 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.25;
    floor.receiveShadow = true;
    this.scene.add(floor);
    this.grid = new THREE.GridHelper(1000, 50, '#9eaaa0', '#c3c9c1');
    this.grid.position.y = 0.02;
    this.grid.visible = false;
    this.scene.add(this.grid);
    this.scene.add(this.model, this.dimensionsGroup);
    this.selectedOutline = new THREE.Box3Helper(new THREE.Box3(), new THREE.Color('#8e9a60'));
    this.selectedOutline.visible = false;
    this.scene.add(this.selectedOutline);
    this.firstMarker = new THREE.Mesh(
      new THREE.SphereGeometry(1.5, 12, 12),
      new THREE.MeshBasicMaterial({ color: '#bf613d', depthTest: false })
    );
    this.firstMarker.visible = false;
    this.scene.add(this.firstMarker);
    this.camera.position.set(320, 210, 380);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 42, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 70;
    this.controls.maxDistance = 1100;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.transform = new TransformControls(this.camera, this.renderer.domElement);
    this.transform.setMode('translate');
    this.transform.setSize(0.75);
    this.scene.add(this.transform.getHelper());
    this.transform.addEventListener('dragging-changed', event => {
      this.controls.enabled = !event.value && this.mode !== 'measure';
      if (event.value && this.transform.object)
        this.oldPosition.copy(this.transform.object.position);
    });
    this.transform.addEventListener('mouseUp', () => {
      const object = this.transform.object;
      if (object && this.selected) {
        const delta = object.position.clone().sub(this.oldPosition);
        if (delta.length() > 0.01)
          this.callbacks.move(this.selected, { x: delta.x, y: delta.y, z: delta.z });
      }
    });
    this.fabricTexture = this.makeFabric('linen');
    this.statusElement = document.createElement('span');
    this.statusElement.className = 's3d-render-status';
    this.statusElement.textContent = '';
    host.append(this.statusElement);
    const signal = this.abort.signal;
    this.renderer.domElement.addEventListener(
      'pointerdown',
      e => {
        this.down = { x: e.clientX, y: e.clientY };
        this.moved = false;
      },
      { signal }
    );
    this.renderer.domElement.addEventListener(
      'pointermove',
      e => {
        if (Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 5) this.moved = true;
      },
      { signal }
    );
    this.renderer.domElement.addEventListener(
      'pointerup',
      e => {
        if (!this.moved && !this.transform.dragging && e.button === 0) this.pick(e);
      },
      { signal }
    );
    this.renderer.domElement.addEventListener(
      'webglcontextlost',
      e => {
        e.preventDefault();
        this.statusElement.textContent =
          '3D graphics paused. Close and reopen the studio to restore.';
        this.pause();
      },
      { signal }
    );
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
  }
  private makeFabric(family: SofaDocument['fabric']['family']) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    const image = ctx.createImageData(256, 256);
    let random = 9127;
    for (let y = 0; y < 256; y++)
      for (let x = 0; x < 256; x++) {
        random = (Math.imul(random, 1664525) + 1013904223) | 0;
        const noise = (random >>> 24) / 255;
        const weave =
          family === 'boucle'
            ? Math.sin(x * 1.9 + Math.cos(y * 0.7)) * Math.cos(y * 1.5 + x * 0.2)
            : family === 'velvet'
              ? Math.sin(x * 0.2 + y * 2) * 0.2
              : ((x % 5 < 2 ? 1 : -1) + (y % 5 < 2 ? 1 : -1)) * 0.35;
        const c = Math.max(0, Math.min(255, 160 + weave * 35 + (noise - 0.5) * 45));
        const i = (y * 256 + x) * 4;
        image.data[i] = c;
        image.data[i + 1] = c;
        image.data[i + 2] = c;
        image.data[i + 3] = 255;
      }
    ctx.putImageData(image, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(9, 9);
    texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    return texture;
  }
  private clear(group: THREE.Group) {
    group.traverse(object => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
        object.geometry.dispose();
      }
    });
    group.clear();
  }
  update(doc: SofaDocument, selected: string | null = this.selected) {
    const oldFamily = this.doc?.fabric.family;
    this.doc = doc;
    this.selected = selected;
    this.transform.detach();
    this.clear(this.model);
    this.parts.clear();
    this.geometryMaterials.forEach(m => m.dispose());
    this.geometryMaterials = [];
    if (oldFamily !== doc.fabric.family) {
      this.fabricTexture.dispose();
      this.fabricTexture = this.makeFabric(doc.fabric.family);
    }
    const colour = new THREE.Color(doc.fabric.colour);
    const material = new THREE.MeshPhysicalMaterial({
      color: colour,
      roughness: doc.fabric.family === 'velvet' ? 0.82 : 0.98,
      bumpMap: this.fabricTexture,
      bumpScale: doc.fabric.family === 'boucle' ? 0.32 : 0.12,
      sheen: 1,
      sheenRoughness: 0.8,
      sheenColor: new THREE.Color('#b8b1a6'),
      envMapIntensity: 0.55,
    });
    const accent = material.clone();
    accent.color.lerp(new THREE.Color('#e4ded1'), 0.34);
    const piping = material.clone();
    piping.color.multiplyScalar(0.9);
    piping.bumpScale = 0.04;
    const legMaterial = new THREE.MeshStandardMaterial({ color: '#97724b', roughness: 0.7 });
    const clothMaterial = material.clone();
    clothMaterial.side = THREE.DoubleSide;
    this.geometryMaterials.push(material, accent, piping, legMaterial, clothMaterial);
    const parts = buildSofaParts(doc);
    for (const part of parts) {
      const group = new THREE.Group();
      group.name = part.name;
      group.userData.partId = part.id;
      group.position.copy(v(part.position));
      group.rotation.set(part.rotation.x, part.rotation.y, part.rotation.z, 'YXZ');
      const { x: w, y: h, z: d } = part.size;
      let geometry: THREE.BufferGeometry;
      if (part.role === 'skirt') geometry = skirtGeometry(part, doc.construction);
      else if (['seat', 'back', 'pillow'].includes(part.role)) geometry = cushionGeometry(part);
      else if (part.role === 'leg' && part.shape === 'round')
        geometry = new THREE.CylinderGeometry(w * 0.43, w * 0.34, h, 12);
      else if (part.role === 'arm' && part.shape === 'round')
        geometry = extrudeArm(part, doc.construction);
      else if (part.profile === 'raised-back') geometry = extrudeBack(part, doc.construction);
      else if (part.shape === 'knife' || part.shape === 'half-knife') {
        geometry = new THREE.SphereGeometry(1, 48, 32);
        const a = geometry.getAttribute('position');
        const power = (n: number, e: number) => Math.sign(n) * Math.pow(Math.abs(n), e);
        for (let i = 0; i < a.count; i++)
          a.setXYZ(
            i,
            (power(a.getX(i), 0.45) * w) / 2,
            (power(a.getY(i), 0.45) * h) / 2,
            (power(a.getZ(i), 0.9) * d) / 2
          );
        geometry.computeVertexNormals();
      } else {
        const radius =
          Math.min(w, h, d) *
          (part.shape === 'round'
            ? 0.46
            : part.shape === 'rounded'
              ? 0.36
              : part.role === 'leg'
                ? 0.035
                : part.role === 'frame'
                  ? 0.07
                  : 0.23);
        geometry = new RoundedBoxGeometry(w, h, d, 5, radius);
        if (part.shape === 'wedge') {
          const a = geometry.getAttribute('position');
          for (let i = 0; i < a.count; i++) {
            const factor = 0.66 + 0.34 * (0.5 - a.getY(i) / h);
            a.setX(i, a.getX(i) * factor);
          }
          geometry.computeVertexNormals();
        }
      }
      const mesh = new THREE.Mesh(
        geometry,
        part.role === 'leg' || part.profile === 'timber'
          ? legMaterial
          : part.role === 'skirt'
            ? clothMaterial
            : part.role === 'pillow'
              ? accent
              : material
      );
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.userData.partId = part.id;
      group.add(mesh);
      if (['seat', 'back', 'pillow'].includes(part.role) && part.piping) {
        const seam = cushionPiping(part, geometry);
        if (seam) group.add(new THREE.Mesh(seam, piping));
      }
      if (part.role === 'arm' && part.shape === 'round' && part.piping) {
        const points = rolledArmOutline(w, h, doc.construction)
          .getPoints(80)
          .map(p => new THREE.Vector3(p.x, p.y, d / 2 + 0.12));
        if (part.id.endsWith('arm-right')) points.forEach(p => (p.x = -p.x));
        const seam = new THREE.TubeGeometry(
          new THREE.CatmullRomCurve3(points, true, 'centripetal'),
          160,
          0.12,
          4,
          true
        );
        group.add(new THREE.Mesh(seam, piping));
      }
      if (this.exploded) {
        if (part.role === 'seat') group.position.y += 28;
        if (part.role === 'back') group.position.y += 48;
        if (part.role === 'pillow') group.position.y += 60;
      }
      this.model.add(group);
      this.parts.set(part.id, { mesh: group, part });
    }
    this.model.updateMatrixWorld(true);
    this.refreshSelection();
    this.buildDimensions();
  }
  select(id: string | null) {
    this.selected = id;
    this.refreshSelection();
    this.buildDimensions();
  }
  private refreshSelection() {
    const found = this.selected ? this.parts.get(this.selected) : null;
    this.selectedOutline.visible = !!found;
    if (found) {
      this.selectedOutline.box.setFromObject(found.mesh);
      if (this.mode === 'move') this.transform.attach(found.mesh);
    } else this.transform.detach();
  }
  setMode(mode: typeof this.mode) {
    this.mode = mode;
    this.controls.enabled = mode !== 'measure';
    this.firstAnchor = null;
    this.firstMarker.visible = false;
    this.transform.detach();
    if (mode === 'move' && this.selected) {
      const part = this.parts.get(this.selected);
      if (part) this.transform.attach(part.mesh);
    }
    this.renderer.domElement.style.cursor = mode === 'measure' ? 'crosshair' : 'grab';
  }
  setGrid(show: boolean) {
    this.grid.visible = show;
    this.showGrid = show;
  }
  setDimensions(show: boolean) {
    this.showDimensions = show;
    this.dimensionsGroup.visible = show;
    this.overlay.hidden = !show;
  }
  private addLine(a: THREE.Vector3, b: THREE.Vector3, material: THREE.LineBasicMaterial) {
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), material);
    this.dimensionsGroup.add(line);
  }
  private anchor(anchor: SurfaceAnchor) {
    const found = this.parts.get(anchor.partId);
    if (!found) return null;
    return found.mesh.localToWorld(
      new THREE.Vector3(
        anchor.point.x * found.part.size.x,
        anchor.point.y * found.part.size.y,
        anchor.point.z * found.part.size.z
      )
    );
  }
  private buildDimensions() {
    this.dimensionsGroup.traverse(o => {
      if (o instanceof THREE.Line || o instanceof THREE.Mesh) {
        const m = o.material;
        if (Array.isArray(m)) m.forEach(x => x.dispose());
        else m.dispose();
      }
    });
    this.clear(this.dimensionsGroup);
    this.labels.forEach(e => e.remove());
    this.labels.clear();
    this.dimensions = [];
    const found = this.selected ? this.parts.get(this.selected) : null;
    if (found) {
      const { size } = found.part;
      const wp = (x: number, y: number, z: number) =>
        found.mesh.localToWorld(new THREE.Vector3(x, y, z));
      this.dimensions = [
        {
          id: `${found.part.id}:width`,
          name: 'Width',
          value: size.x,
          a: wp(-size.x / 2, size.y / 2 + 5, size.z / 2 + 4),
          b: wp(size.x / 2, size.y / 2 + 5, size.z / 2 + 4),
          edit: { partId: found.part.id, field: 'width' },
        },
        {
          id: `${found.part.id}:height`,
          name: found.part.role === 'seat' ? 'Thickness' : 'Height',
          value: size.y,
          a: wp(-size.x / 2 - 7, -size.y / 2, size.z / 2),
          b: wp(-size.x / 2 - 7, size.y / 2, size.z / 2),
          edit: { partId: found.part.id, field: 'height' },
        },
        {
          id: `${found.part.id}:depth`,
          name: found.part.role === 'back' || found.part.role === 'pillow' ? 'Thickness' : 'Depth',
          value: size.z,
          a: wp(size.x / 2 + 7, size.y / 2, -size.z / 2),
          b: wp(size.x / 2 + 7, size.y / 2, size.z / 2),
          edit: { partId: found.part.id, field: 'depth' },
        },
      ];
    } else {
      const box = new THREE.Box3().setFromObject(this.model);
      const { min, max } = box;
      const size = box.getSize(new THREE.Vector3());
      if (!box.isEmpty())
        this.dimensions = [
          {
            id: 'overall:width',
            name: 'Width',
            value: size.x,
            a: new THREE.Vector3(min.x, 1, max.z + 19),
            b: new THREE.Vector3(max.x, 1, max.z + 19),
            edit: this.doc.modules ? undefined : { field: 'width' },
          },
          {
            id: 'overall:depth',
            name: 'Depth',
            value: size.z,
            a: new THREE.Vector3(max.x + 19, 1, min.z),
            b: new THREE.Vector3(max.x + 19, 1, max.z),
            edit: this.doc.modules ? undefined : { field: 'depth' },
          },
          {
            id: 'overall:height',
            name: 'Height',
            value: size.y,
            a: new THREE.Vector3(min.x - 19, min.y, min.z),
            b: new THREE.Vector3(min.x - 19, max.y, min.z),
            edit: undefined,
          },
        ];
    }
    if (found?.part.profile === 'raised-back') {
      const points = backProfile(found.part.size.z, found.part.size.y, this.doc.construction);
      const wp = (i: number) =>
        found.mesh.localToWorld(
          new THREE.Vector3(-found.part.size.x / 2 - 3, points[i].y, points[i].z)
        );
      this.dimensions = [
        [0, 1, 'F1 · Base depth'],
        [0, 3, 'F2 · Rear edge'],
        [3, 2, 'F3 · Top depth'],
        [1, 2, 'F4 · Front rake'],
      ].map(([a, b, name], i) => {
        const start = wp(Number(a)),
          end = wp(Number(b));
        return {
          id: `${found.part.id}:F${i + 1}`,
          name: String(name),
          value: start.distanceTo(end),
          a: start,
          b: end,
        };
      });
    }
    for (const custom of this.doc.customDimensions) {
      const a = this.anchor(custom.a),
        b = this.anchor(custom.b);
      if (a && b)
        this.dimensions.push({ id: custom.id, name: 'Measurement', value: a.distanceTo(b), a, b });
    }
    for (const dimension of this.dimensions) {
      const mat = new THREE.LineBasicMaterial({
        color: '#65745d',
        transparent: true,
        opacity: 0.85,
        depthTest: false,
      });
      this.addLine(dimension.a, dimension.b, mat);
      const direction = dimension.b.clone().sub(dimension.a).normalize();
      const arrowSize = Math.min(2, dimension.value * 0.12);
      for (const [point, sign] of [
        [dimension.a, 1],
        [dimension.b, -1],
      ] as const) {
        const arrow = new THREE.Mesh(
          new THREE.ConeGeometry(arrowSize * 0.35, arrowSize, 8),
          new THREE.MeshBasicMaterial({ color: '#65745d', depthTest: false })
        );
        arrow.position.copy(point).addScaledVector(direction, (sign * arrowSize) / 2);
        arrow.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          direction.clone().multiplyScalar(-sign)
        );
        arrow.renderOrder = 3;
        this.dimensionsGroup.add(arrow);
      }
      const element = document.createElement('button');
      element.type = 'button';
      element.className = 's3d-dimension';
      element.dataset.dimensionId = dimension.id;
      element.setAttribute(
        'aria-label',
        `${dimension.name} ${dimension.value.toFixed(1)} cm. ${dimension.edit ? 'Click to edit. ' : ''}Drag to move label.`
      );
      element.innerHTML = `<span>${dimension.name}</span><strong>${Number(dimension.value.toFixed(1))}<small>cm</small></strong>`;
      this.overlay.append(element);
      this.labels.set(dimension.id, element);
      element.addEventListener('pointerdown', event => {
        event.stopPropagation();
        element.setPointerCapture(event.pointerId);
        this.labelDrag = {
          id: dimension.id,
          x: event.clientX,
          y: event.clientY,
          original: { ...(this.doc.labelOffsets[dimension.id] || { x: 0, y: 0 }) },
          moved: false,
        };
      });
      element.addEventListener('pointermove', event => {
        if (!this.labelDrag || this.labelDrag.id !== dimension.id) return;
        const deltaX = event.clientX - this.labelDrag.x,
          deltaY = event.clientY - this.labelDrag.y;
        if (Math.hypot(deltaX, deltaY) > 4) this.labelDrag.moved = true;
        if (this.labelDrag.moved)
          this.doc.labelOffsets[dimension.id] = {
            x: this.labelDrag.original.x + deltaX / this.host.clientWidth,
            y: this.labelDrag.original.y + deltaY / this.host.clientHeight,
          };
      });
      element.addEventListener('pointerup', () => {
        const drag = this.labelDrag;
        this.labelDrag = null;
        if (drag?.moved) {
          const offset = { ...this.doc.labelOffsets[dimension.id] };
          this.doc.labelOffsets[dimension.id] = drag.original;
          this.callbacks.label(dimension.id, offset);
        } else if (dimension.edit) this.callbacks.edit(dimension, element);
      });
      element.addEventListener('keydown', event => {
        if ((event.key === 'Enter' || event.key === ' ') && dimension.edit) {
          event.preventDefault();
          this.callbacks.edit(dimension, element);
        }
      });
    }
    this.dimensionsGroup.visible = this.showDimensions;
  }
  private pick(event: PointerEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.raycaster.setFromCamera(
      new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        (-(event.clientY - rect.top) / rect.height) * 2 + 1
      ),
      this.camera
    );
    const hits = this.raycaster.intersectObjects(this.model.children, true);
    const hit = hits.find(h => h.object.userData.partId);
    if (!hit) {
      if (this.mode !== 'measure') this.callbacks.select(null);
      return;
    }
    const id = String(hit.object.userData.partId);
    if (this.mode === 'measure') {
      const found = this.parts.get(id)!;
      const local = found.mesh.worldToLocal(hit.point.clone());
      const anchor = {
        partId: id,
        point: {
          x: local.x / found.part.size.x,
          y: local.y / found.part.size.y,
          z: local.z / found.part.size.z,
        },
      };
      if (!this.firstAnchor) {
        this.firstAnchor = anchor;
        this.firstMarker.position.copy(hit.point);
        this.firstMarker.visible = true;
        this.statusElement.textContent = 'Now click the other end of your measurement.';
      } else {
        this.callbacks.measure(this.firstAnchor, anchor);
        this.firstAnchor = null;
        this.firstMarker.visible = false;
        this.statusElement.textContent = 'Measurement added. Click two points to add another.';
      }
    } else this.callbacks.select(id);
  }
  view(name: 'perspective' | 'front' | 'side' | 'back' | 'top') {
    const box = new THREE.Box3().setFromObject(this.model);
    const center = box.getCenter(new THREE.Vector3());
    center.y = Math.max(25, center.y * 0.85);
    const extent = Math.max(
      box.getSize(new THREE.Vector3()).x,
      box.getSize(new THREE.Vector3()).z,
      170
    );
    const viewExtent =
      name === 'side'
        ? Math.max(box.getSize(new THREE.Vector3()).z, box.getSize(new THREE.Vector3()).y, 100)
        : extent;
    const distance = (viewExtent * 2.05) / Math.min(1, this.camera.aspect);
    const direction =
      name === 'front'
        ? new THREE.Vector3(0, 0.05, 1)
        : name === 'back'
          ? new THREE.Vector3(0, 0.05, -1)
          : name === 'side'
            ? new THREE.Vector3(-1, 0.05, 0)
            : name === 'top'
              ? new THREE.Vector3(0, 1, 0.001)
              : new THREE.Vector3(
                  this.doc.catalogueModel ? -1 : 1,
                  0.45,
                  this.doc.catalogueModel === 'cloud-corner' ? 1 : 1.6
                ).normalize();
    this.controls.target.copy(center);
    this.camera.position.copy(center).addScaledVector(direction, distance);
    this.controls.update();
  }
  resize() {
    const w = this.host.clientWidth,
      h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
  resume() {
    if (this.active) return;
    this.active = true;
    this.resize();
    const render = () => {
      if (!this.active) return;
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      this.positionLabels();
      this.frame = requestAnimationFrame(render);
    };
    render();
  }
  pause() {
    this.active = false;
    cancelAnimationFrame(this.frame);
  }
  private positionLabels() {
    for (const dimension of this.dimensions) {
      const e = this.labels.get(dimension.id);
      if (!e) continue;
      const midpoint = dimension.a
        .clone()
        .add(dimension.b)
        .multiplyScalar(0.5)
        .project(this.camera);
      const offset = this.doc.labelOffsets[dimension.id] || { x: 0, y: 0 };
      let x = (midpoint.x * 0.5 + 0.5 + offset.x) * this.host.clientWidth;
      let y = (-midpoint.y * 0.5 + 0.5 + offset.y) * this.host.clientHeight;
      if (this.selected && !this.doc.labelOffsets[dimension.id]) {
        if (dimension.edit?.field === 'height') {
          x -= 40;
          y += 5;
        }
        if (dimension.edit?.field === 'depth') {
          x += 45;
          y -= 5;
        }
        if (dimension.edit?.field === 'width') y -= 26;
      }
      if (!this.doc.labelOffsets[dimension.id] && /:F[1-4]$/.test(dimension.id)) {
        if (dimension.id.endsWith(':F1')) y += 42;
        if (dimension.id.endsWith(':F2')) {
          x -= 78;
          y -= 8;
        }
        if (dimension.id.endsWith(':F3')) y -= 62;
        if (dimension.id.endsWith(':F4')) {
          x += 78;
          y -= 8;
        }
      }
      e.style.left = `${Math.max(110, Math.min(this.host.clientWidth - 45, x))}px`;
      e.style.top = `${Math.max(38, Math.min(this.host.clientHeight - 40, y))}px`;
      e.hidden = midpoint.z > 1 || midpoint.z < -1;
    }
  }
  async snapshot(): Promise<Blob> {
    this.renderer.render(this.scene, this.camera);
    const canvas = document.createElement('canvas');
    canvas.width = this.renderer.domElement.width;
    canvas.height = this.renderer.domElement.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(this.renderer.domElement, 0, 0);
    const scale = canvas.width / this.host.clientWidth;
    if (this.showDimensions)
      for (const d of this.dimensions) {
        const label = this.labels.get(d.id);
        if (!label || label.hidden) continue;
        const x = parseFloat(label.style.left) * scale,
          y = parseFloat(label.style.top) * scale;
        ctx.font = `${13 * scale}px sans-serif`;
        const text = `${d.name} · ${Number(d.value.toFixed(1))} cm`;
        const w = ctx.measureText(text).width + 20 * scale;
        ctx.fillStyle = '#faf9f3';
        ctx.beginPath();
        ctx.roundRect(x - w / 2, y - 14 * scale, w, 28 * scale, 6 * scale);
        ctx.fill();
        ctx.fillStyle = '#35412f';
        ctx.textAlign = 'center';
        ctx.fillText(text, x, y + 4 * scale);
      }
    return new Promise((resolve, reject) =>
      canvas.toBlob(
        blob => (blob ? resolve(blob) : reject(new Error('Image export failed.'))),
        'image/png'
      )
    );
  }
  async glb(): Promise<Blob> {
    const root = this.model.clone(true);
    root.scale.setScalar(0.01);
    root.updateMatrixWorld(true);
    const data = await new GLTFExporter().parseAsync(root, { binary: true });
    return new Blob([data as ArrayBuffer], { type: 'model/gltf-binary' });
  }
  dispose() {
    this.pause();
    this.abort.abort();
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.transform.dispose();
    this.fabricTexture.dispose();
    this.environment.dispose();
    this.scene.traverse(o => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Line) {
        o.geometry.dispose();
        const m = o.material;
        if (Array.isArray(m)) m.forEach(x => x.dispose());
        else m.dispose();
      }
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.overlay.replaceChildren();
  }
}
