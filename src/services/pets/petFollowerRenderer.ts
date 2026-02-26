// Pet Follower Renderer — animated pixel pet that follows the cursor
// Single canvas element, rAF-driven, auto-pauses when tab hidden

import { buildPetConfig, type PetConfig } from './petConfig';

type AnimState = 'idle' | 'walk' | 'run' | 'sleep';
type BehaviorMode = 'follow' | 'roam' | 'sleep' | 'idle';
type SpecialAction = 'none' | 'zoomies' | 'inspect' | 'wake-stretch';
type ToyState = 'none' | 'dragging' | 'dropped' | 'carrying';

const ROAM_MIN_MARGIN = 24;
const ROAM_REACHED_DISTANCE = 8;

class PetFollowerRenderer {
  private config: PetConfig | null = null;
  private sprites: Record<string, HTMLImageElement> = {};
  private sleepSpriteKeys: string[] = [];
  private overlay: HTMLDivElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private rafId = 0;
  private mounted = false;

  // Position state
  private petX = 0;
  private petY = 0;
  private targetX = 0;
  private targetY = 0;
  private facingLeft = false;
  private roamTargetX = 0;
  private roamTargetY = 0;
  private roamPauseUntil = 0;
  private roamSleepUntil = 0;
  private nextRoamSleepAt = 0;
  private offscreenSleepPending = false;
  private offscreenSleepAnchorX = 0;
  private offscreenSleepAnchorY = 0;
  private specialAction: SpecialAction = 'none';
  private specialUntil = 0;
  private nextZoomiesAt = 0;
  private nextInspectAt = 0;
  private inspectAnchorX = 0;
  private inspectAnchorY = 0;
  private wasSleepingLastTick = false;
  private toyState: ToyState = 'none';
  private toyX = 0;
  private toyY = 0;
  private toyHomeX = 0;
  private toyHomeY = 0;
  private toyRadius = 10;
  private toyReturnCallback: (() => void) | null = null;
  private pointerX = 0;
  private pointerY = 0;
  private cursorOnScreen = true;

  // Animation state
  private animState: AnimState = 'idle';
  private behaviorMode: BehaviorMode = 'idle';
  private frame = 0;
  private frameTick = 0;
  private lastPointerMoveTime = 0;

  private handleMouseMove = (e: MouseEvent) => {
    const now = performance.now();
    this.cursorOnScreen = true;
    this.pointerX = e.clientX;
    this.pointerY = e.clientY;
    this.lastPointerMoveTime = now;
    // Don't override target during toy interaction — updateToyBehavior handles it
    if (this.toyState === 'none') {
      this.targetX = e.clientX - 30;
      this.targetY = e.clientY + 10;
    }
  };

  private handleMouseOut = (e: MouseEvent) => {
    if (!e.relatedTarget) {
      this.cursorOnScreen = false;
    }
  };

  private handleMouseEnter = () => {
    this.cursorOnScreen = true;
    this.lastPointerMoveTime = performance.now();
  };

  private handleWindowBlur = () => {
    this.cursorOnScreen = false;
  };

  private handleWindowFocus = () => {
    this.lastPointerMoveTime = performance.now();
  };

  async mount(petId: string): Promise<void> {
    if (this.mounted) this.unmount();

    const config = buildPetConfig(petId);
    if (!config) return;
    this.config = config;

    // Preload sprite sheets
    this.sleepSpriteKeys = [];
    const spriteLoads: Promise<void>[] = [];
    const animKeys: Array<Exclude<AnimState, 'sleep'>> = ['idle', 'walk', 'run'];
    for (const key of animKeys) {
      spriteLoads.push(this.loadSprite(key, config.animations[key].path));
    }
    (config.sleepFrames || []).forEach((frameCfg, idx) => {
      const key = `sleep:${idx}`;
      this.sleepSpriteKeys.push(key);
      spriteLoads.push(this.loadSprite(key, frameCfg.path));
    });
    await Promise.all(spriteLoads);

    // Create overlay
    this.overlay = document.createElement('div');
    this.overlay.id = 'petFollowerOverlay';
    this.overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      z-index: 9999;
      pointer-events: none;
    `;

    this.canvas = document.createElement('canvas');
    this.canvas.width = config.displaySize;
    this.canvas.height = config.displaySize;
    this.canvas.style.cssText = `
      position: absolute;
      width: ${config.displaySize}px;
      height: ${config.displaySize}px;
      image-rendering: pixelated;
    `;

    this.ctx = this.canvas.getContext('2d');
    this.overlay.appendChild(this.canvas);
    document.body.appendChild(this.overlay);

    // Initialize position at center
    this.petX = window.innerWidth / 2;
    this.petY = window.innerHeight / 2;
    this.targetX = this.petX;
    this.targetY = this.petY;
    this.pointerX = this.petX;
    this.pointerY = this.petY;
    this.roamTargetX = this.petX;
    this.roamTargetY = this.petY;
    this.roamPauseUntil = 0;
    this.roamSleepUntil = 0;
    this.nextRoamSleepAt =
      performance.now() +
      this.randomBetween(config.behavior.roamSleepGapMinMs, config.behavior.roamSleepGapMaxMs);
    this.offscreenSleepPending = false;
    this.offscreenSleepAnchorX = this.petX;
    this.offscreenSleepAnchorY = this.petY;
    this.specialAction = 'none';
    this.specialUntil = 0;
    this.nextZoomiesAt =
      performance.now() +
      this.randomBetween(
        config.behavior.zoomiesCooldownMinMs,
        config.behavior.zoomiesCooldownMaxMs
      );
    this.nextInspectAt =
      performance.now() +
      this.randomBetween(
        config.behavior.inspectCooldownMinMs,
        config.behavior.inspectCooldownMaxMs
      );
    this.inspectAnchorX = this.petX;
    this.inspectAnchorY = this.petY;
    this.wasSleepingLastTick = false;

    // Listen for mouse
    document.addEventListener('mousemove', this.handleMouseMove);
    document.addEventListener('mouseout', this.handleMouseOut);
    document.addEventListener('mouseenter', this.handleMouseEnter);
    window.addEventListener('blur', this.handleWindowBlur);
    window.addEventListener('focus', this.handleWindowFocus);

    this.mounted = true;
    (window as any).__petFollowerRenderer = this;
    this.cursorOnScreen = true;
    this.lastPointerMoveTime = performance.now();
    this.tick(performance.now());
  }

  unmount(): void {
    this.mounted = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    document.removeEventListener('mousemove', this.handleMouseMove);
    document.removeEventListener('mouseout', this.handleMouseOut);
    document.removeEventListener('mouseenter', this.handleMouseEnter);
    window.removeEventListener('blur', this.handleWindowBlur);
    window.removeEventListener('focus', this.handleWindowFocus);
    this.overlay?.remove();
    this.overlay = null;
    this.canvas = null;
    this.ctx = null;
    this.sprites = {};
    this.config = null;
    this.sleepSpriteKeys = [];
    this.frame = 0;
    this.frameTick = 0;
    this.toyState = 'none';
    this.toyReturnCallback = null;
    if ((window as any).__petFollowerRenderer === this) {
      (window as any).__petFollowerRenderer = null;
    }
  }

  isMounted(): boolean {
    return this.mounted;
  }

  isToyActive(): boolean {
    return this.toyState !== 'none';
  }

  startToyDrag(x: number, y: number, homeX: number, homeY: number, onReturn?: () => void): void {
    if (!this.mounted || !this.config) return;
    this.toyHomeX = homeX;
    this.toyHomeY = homeY;
    this.toyX = x;
    this.toyY = y;
    this.toyState = 'dragging';
    this.toyReturnCallback = typeof onReturn === 'function' ? onReturn : null;
    this.clearSpecialAction();
    this.roamPauseUntil = 0;
    this.roamSleepUntil = 0;
  }

  moveToyDrag(x: number, y: number): void {
    if (this.toyState !== 'dragging') return;
    const clamped = this.clampToViewport(x, y);
    this.toyX = clamped.x;
    this.toyY = clamped.y;
  }

  endToyDrag(): void {
    if (this.toyState !== 'dragging') return;
    this.toyState = 'dropped';
  }

  cancelToyDrag(): void {
    this.toyState = 'none';
    const callback = this.toyReturnCallback;
    this.toyReturnCallback = null;
    callback?.();
  }

  private loadSprite(key: string, path: string): Promise<void> {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        this.sprites[key] = img;
        resolve();
      };
      img.onerror = () => resolve(); // non-critical
      img.src = path;
    });
  }

  private tick = (now: number): void => {
    if (!this.mounted) return;
    this.rafId = requestAnimationFrame(this.tick);

    if (!this.config || !this.ctx || !this.canvas) return;

    if (document.hidden) return;

    this.behaviorMode = this.getBehaviorMode(now);
    if (this.toyState !== 'none') {
      this.behaviorMode = 'follow';
    }

    const isSleepingNow = this.behaviorMode === 'sleep';
    if (this.wasSleepingLastTick && !isSleepingNow && this.cursorOnScreen) {
      this.beginWakeStretch(now);
    }
    this.wasSleepingLastTick = isSleepingNow;

    if (
      this.cursorOnScreen &&
      (this.specialAction === 'zoomies' || this.specialAction === 'inspect')
    ) {
      this.clearSpecialAction();
    }
    if (this.specialAction !== 'none' && now >= this.specialUntil) {
      this.clearSpecialAction();
    }

    if (this.toyState !== 'none') {
      this.updateToyBehavior();
    } else if (this.behaviorMode === 'follow') {
      this.targetX = this.pointerX - 30;
      this.targetY = this.pointerY + 10;
      this.roamPauseUntil = 0;
    } else {
      this.updateOffscreenBehavior(now);
    }

    // Lerp toward target
    const dx = this.targetX - this.petX;
    const dy = this.targetY - this.petY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    const shouldMove =
      (this.behaviorMode === 'follow' || this.behaviorMode === 'roam') &&
      this.specialAction !== 'wake-stretch';
    if (shouldMove && dist > 2) {
      const lerp =
        this.behaviorMode === 'roam'
          ? this.config.behavior.roamLerp
          : this.config.behavior.followLerp;
      const effectiveLerp = this.specialAction === 'zoomies' ? Math.max(lerp, 0.12) : lerp;
      this.petX += dx * effectiveLerp;
      this.petY += dy * effectiveLerp;

      // Determine facing direction
      if (Math.abs(dx) > 1) {
        this.facingLeft = dx < 0;
      }
    }

    // Determine animation state
    let newState: AnimState;
    if (this.behaviorMode === 'sleep' && this.sleepSpriteKeys.length > 0) {
      newState = 'sleep';
    } else if (this.specialAction === 'wake-stretch') {
      newState = 'idle';
    } else if (this.specialAction === 'zoomies') {
      newState = 'run';
    } else if (!shouldMove || dist < 3) {
      newState = 'idle';
    } else if (this.behaviorMode === 'roam') {
      newState = 'walk';
    } else if (dist > 100) {
      newState = 'run';
    } else {
      newState = 'walk';
    }

    if (newState !== this.animState) {
      this.animState = newState;
      this.frame = 0;
      this.frameTick = 0;
    }

    // Advance frame (~10 FPS for movement animations, slower for sleep)
    this.frameTick++;
    const animSpeed = this.animState === 'run' ? 4 : this.animState === 'sleep' ? 18 : 6;
    if (this.frameTick >= animSpeed) {
      this.frameTick = 0;
      if (this.animState === 'sleep') {
        const sleepFrames = Math.max(this.sleepSpriteKeys.length, 1);
        this.frame = (this.frame + 1) % sleepFrames;
      } else {
        const anim = this.config.animations[this.animState];
        this.frame = (this.frame + 1) % anim.frameCount;
      }
    }

    // Render
    this.render();
  };

  private render(): void {
    if (!this.ctx || !this.canvas || !this.config || !this.overlay) return;

    const spriteKey = this.getCurrentSpriteKey();
    const sprite = this.sprites[spriteKey];
    if (!sprite) return;

    const { frameSize, displaySize } = this.config;
    const sx = this.animState === 'sleep' ? 0 : this.frame * frameSize;

    this.ctx.clearRect(0, 0, displaySize, displaySize);
    this.ctx.save();

    if (this.facingLeft) {
      this.ctx.scale(-1, 1);
      this.ctx.drawImage(
        sprite,
        sx,
        0,
        frameSize,
        frameSize,
        -displaySize,
        0,
        displaySize,
        displaySize
      );
    } else {
      this.ctx.drawImage(sprite, sx, 0, frameSize, frameSize, 0, 0, displaySize, displaySize);
    }

    this.ctx.restore();

    // Position canvas
    this.canvas.style.left = `${this.petX}px`;
    this.canvas.style.top = `${this.petY}px`;

    this.renderToy();
  }

  private renderToy(): void {
    if (!this.overlay) return;
    const toyId = 'petFollowerToyBall';
    let toyEl = this.overlay.querySelector(`#${toyId}`) as HTMLDivElement | null;

    if (this.toyState === 'none') {
      toyEl?.remove();
      return;
    }

    if (!toyEl) {
      toyEl = document.createElement('div');
      toyEl.id = toyId;
      toyEl.style.cssText =
        'position:absolute;width:20px;height:20px;border-radius:50%;background:#ef4444;border:2px solid #b91c1c;box-shadow:0 2px 6px rgba(127,29,29,0.45);pointer-events:none;transform:translate(-50%,-50%);';
      this.overlay.appendChild(toyEl);
    }

    toyEl.style.left = `${this.toyX}px`;
    toyEl.style.top = `${this.toyY}px`;
  }

  private getCurrentSpriteKey(): string {
    if (this.animState === 'sleep' && this.sleepSpriteKeys.length > 0) {
      return this.sleepSpriteKeys[this.frame % this.sleepSpriteKeys.length];
    }
    return this.animState;
  }

  private getBehaviorMode(now: number): BehaviorMode {
    const cursorStationaryMs = now - this.lastPointerMoveTime;
    if (this.cursorOnScreen) {
      const sleepDelayMs = this.config?.behavior.cursorSleepDelayMs ?? 2500;
      return cursorStationaryMs >= sleepDelayMs ? 'sleep' : 'follow';
    }

    if (now < this.roamSleepUntil && this.sleepSpriteKeys.length > 0) return 'sleep';
    if (now < this.roamPauseUntil) return 'idle';
    return 'roam';
  }

  private updateOffscreenBehavior(now: number): void {
    if (!this.config) return;

    if (this.specialAction === 'inspect') {
      this.targetX = this.inspectAnchorX;
      this.targetY = this.inspectAnchorY;
      return;
    }

    if (this.specialAction === 'zoomies') {
      const dxZoom = this.roamTargetX - this.petX;
      const dyZoom = this.roamTargetY - this.petY;
      const distZoom = Math.sqrt(dxZoom * dxZoom + dyZoom * dyZoom);
      if (distZoom <= ROAM_REACHED_DISTANCE) {
        this.pickRoamTarget();
      }
      this.targetX = this.roamTargetX;
      this.targetY = this.roamTargetY;
      return;
    }

    if (this.offscreenSleepPending) {
      const dxSleep = this.offscreenSleepAnchorX - this.petX;
      const dySleep = this.offscreenSleepAnchorY - this.petY;
      const distSleep = Math.sqrt(dxSleep * dxSleep + dySleep * dySleep);
      this.targetX = this.offscreenSleepAnchorX;
      this.targetY = this.offscreenSleepAnchorY;
      if (distSleep <= ROAM_REACHED_DISTANCE) {
        this.offscreenSleepPending = false;
        this.roamSleepUntil =
          now +
          this.randomBetween(
            this.config.behavior.roamSleepMinMs,
            this.config.behavior.roamSleepMaxMs
          );
        this.roamPauseUntil = 0;
      }
      return;
    }

    if (this.behaviorMode !== 'roam') {
      this.targetX = this.petX;
      this.targetY = this.petY;
      return;
    }

    if (now >= this.nextInspectAt) {
      this.nextInspectAt =
        now +
        this.randomBetween(
          this.config.behavior.inspectCooldownMinMs,
          this.config.behavior.inspectCooldownMaxMs
        );
      if (Math.random() < this.config.behavior.inspectVectorChance) {
        const vector = this.getVectorSleepAnchor();
        if (vector) {
          this.specialAction = 'inspect';
          this.inspectAnchorX = vector.x;
          this.inspectAnchorY = vector.y;
          this.specialUntil =
            now +
            this.randomBetween(
              this.config.behavior.inspectPauseMinMs,
              this.config.behavior.inspectPauseMaxMs
            );
          this.targetX = this.inspectAnchorX;
          this.targetY = this.inspectAnchorY;
          return;
        }
      }
    }

    if (now >= this.nextZoomiesAt) {
      this.nextZoomiesAt =
        now +
        this.randomBetween(
          this.config.behavior.zoomiesCooldownMinMs,
          this.config.behavior.zoomiesCooldownMaxMs
        );
      if (Math.random() < this.config.behavior.zoomiesChance) {
        this.specialAction = 'zoomies';
        this.specialUntil = now + this.config.behavior.zoomiesDurationMs;
        this.pickRoamTarget();
        this.targetX = this.roamTargetX;
        this.targetY = this.roamTargetY;
        return;
      }
    }

    if (now >= this.nextRoamSleepAt && this.sleepSpriteKeys.length > 0) {
      const anchor = this.pickPreferredSleepAnchor();
      this.offscreenSleepPending = true;
      this.offscreenSleepAnchorX = anchor.x;
      this.offscreenSleepAnchorY = anchor.y;
      this.nextRoamSleepAt =
        now +
        this.randomBetween(
          this.config.behavior.roamSleepGapMinMs,
          this.config.behavior.roamSleepGapMaxMs
        );
      this.targetX = this.offscreenSleepAnchorX;
      this.targetY = this.offscreenSleepAnchorY;
      return;
    }

    const dx = this.roamTargetX - this.petX;
    const dy = this.roamTargetY - this.petY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (
      !Number.isFinite(this.roamTargetX) ||
      !Number.isFinite(this.roamTargetY) ||
      dist <= ROAM_REACHED_DISTANCE
    ) {
      this.pickRoamTarget();
      this.roamPauseUntil =
        now +
        this.randomBetween(
          this.config.behavior.roamPauseMinMs,
          this.config.behavior.roamPauseMaxMs
        );
      this.roamSleepUntil = 0;
    }

    this.targetX = this.roamTargetX;
    this.targetY = this.roamTargetY;
  }

  private updateToyBehavior(): void {
    if (!this.config || this.toyState === 'none') return;

    const petCenterX = this.petX + this.config.displaySize * 0.5;
    const petCenterY = this.petY + this.config.displaySize * 0.6;
    const toToyX = this.toyX - petCenterX;
    const toToyY = this.toyY - petCenterY;
    const toyDistance = Math.sqrt(toToyX * toToyX + toToyY * toToyY);

    if (this.toyState === 'dragging') {
      this.targetX = this.toyX - this.config.displaySize * 0.35;
      this.targetY = this.toyY - this.config.displaySize * 0.35;
      return;
    }

    if (this.toyState === 'dropped') {
      this.targetX = this.toyX - this.config.displaySize * 0.35;
      this.targetY = this.toyY - this.config.displaySize * 0.35;
      if (toyDistance <= this.toyRadius + 14) {
        this.toyState = 'carrying';
      }
      return;
    }

    if (this.toyState === 'carrying') {
      const carryX =
        this.petX +
        (this.facingLeft ? this.config.displaySize * 0.28 : this.config.displaySize * 0.72);
      const carryY = this.petY + this.config.displaySize * 0.62;
      this.toyX = carryX;
      this.toyY = carryY;
      this.targetX = this.toyHomeX - this.config.displaySize * 0.35;
      this.targetY = this.toyHomeY - this.config.displaySize * 0.35;

      const homeDx = this.toyHomeX - petCenterX;
      const homeDy = this.toyHomeY - petCenterY;
      const homeDist = Math.sqrt(homeDx * homeDx + homeDy * homeDy);
      if (homeDist <= this.toyRadius + 18) {
        this.toyX = this.toyHomeX;
        this.toyY = this.toyHomeY;
        this.toyState = 'none';
        const callback = this.toyReturnCallback;
        this.toyReturnCallback = null;
        callback?.();
      }
    }
  }

  private pickRoamTarget(): void {
    if (!this.config) return;
    const marginX = Math.max(ROAM_MIN_MARGIN, this.config.displaySize * 0.2);
    const marginY = Math.max(ROAM_MIN_MARGIN, this.config.displaySize * 0.2);
    const minX = marginX;
    const maxX = Math.max(minX, window.innerWidth - this.config.displaySize - marginX);
    const minY = marginY;
    const maxY = Math.max(minY, window.innerHeight - this.config.displaySize - marginY);
    this.roamTargetX = this.randomBetween(minX, maxX);
    this.roamTargetY = this.randomBetween(minY, maxY);
  }

  private pickPreferredSleepAnchor(): { x: number; y: number } {
    if (!this.config) {
      return { x: this.petX, y: this.petY };
    }

    const roll = Math.random();
    const vectorChance = this.config.behavior.sleepOnVectorChance;
    const centerChance = this.config.behavior.sleepAtFrameCenterChance;

    if (roll < vectorChance) {
      const vector = this.getVectorSleepAnchor();
      if (vector) return this.clampToViewport(vector.x, vector.y);
    }

    if (roll < vectorChance + centerChance) {
      const frameCenter = this.getCaptureFrameCenterAnchor();
      if (frameCenter) return this.clampToViewport(frameCenter.x, frameCenter.y);
    }

    return this.clampToViewport(this.roamTargetX, this.roamTargetY);
  }

  private getCaptureFrameCenterAnchor(): { x: number; y: number } | null {
    const cfg = this.config;
    if (!cfg) return null;
    const frame = document.getElementById('captureFrame');
    if (!frame) return null;
    const rect = frame.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: rect.left + rect.width / 2 - cfg.displaySize / 2,
      y: rect.top + rect.height / 2 - cfg.displaySize / 2,
    };
  }

  private getVectorSleepAnchor(): { x: number; y: number } | null {
    const cfg = this.config;
    if (!cfg) return null;
    const app = (window as any).app;
    const fabricCanvas = app?.canvasManager?.fabricCanvas;
    const lowerCanvasEl: HTMLCanvasElement | undefined = fabricCanvas?.lowerCanvasEl;
    if (!fabricCanvas || !lowerCanvasEl) return null;

    const canvasRect = lowerCanvasEl.getBoundingClientRect();
    if (canvasRect.width <= 0 || canvasRect.height <= 0) return null;
    const canvasWidth =
      typeof fabricCanvas.getWidth === 'function' ? fabricCanvas.getWidth() : null;
    const canvasHeight =
      typeof fabricCanvas.getHeight === 'function' ? fabricCanvas.getHeight() : null;
    if (!canvasWidth || !canvasHeight) return null;

    const scaleX = canvasRect.width / canvasWidth;
    const scaleY = canvasRect.height / canvasHeight;
    const vpt: number[] = Array.isArray(fabricCanvas.viewportTransform)
      ? fabricCanvas.viewportTransform
      : [1, 0, 0, 1, 0, 0];

    const objects = typeof fabricCanvas.getObjects === 'function' ? fabricCanvas.getObjects() : [];
    const vectors = (objects || []).filter((obj: any) => {
      const type = String(obj?.type || '').toLowerCase();
      if (!type) return false;
      const isVector =
        type === 'line' ||
        type === 'path' ||
        type === 'polyline' ||
        type === 'polygon' ||
        obj?.strokeMetadata?.isVector === true ||
        obj?.customData?.isVectorStroke === true;
      return isVector && obj?.visible !== false;
    });

    if (!vectors.length) return null;
    const pick = vectors[Math.floor(Math.random() * vectors.length)];
    if (!pick) return null;
    const center =
      typeof pick.getCenterPoint === 'function'
        ? pick.getCenterPoint()
        : { x: pick.left || 0, y: pick.top || 0 };

    const canvasX = center.x * vpt[0] + center.y * vpt[2] + vpt[4];
    const canvasY = center.x * vpt[1] + center.y * vpt[3] + vpt[5];
    return {
      x: canvasRect.left + canvasX * scaleX - cfg.displaySize / 2,
      y: canvasRect.top + canvasY * scaleY - cfg.displaySize / 2,
    };
  }

  private clampToViewport(x: number, y: number): { x: number; y: number } {
    if (!this.config) return { x, y };
    const marginX = Math.max(ROAM_MIN_MARGIN, this.config.displaySize * 0.2);
    const marginY = Math.max(ROAM_MIN_MARGIN, this.config.displaySize * 0.2);
    const minX = marginX;
    const maxX = Math.max(minX, window.innerWidth - this.config.displaySize - marginX);
    const minY = marginY;
    const maxY = Math.max(minY, window.innerHeight - this.config.displaySize - marginY);
    return {
      x: Math.min(maxX, Math.max(minX, x)),
      y: Math.min(maxY, Math.max(minY, y)),
    };
  }

  private randomBetween(min: number, max: number): number {
    if (max <= min) return min;
    return min + Math.random() * (max - min);
  }

  private beginWakeStretch(now: number): void {
    if (!this.config) return;
    this.specialAction = 'wake-stretch';
    this.specialUntil = now + this.config.behavior.wakeStretchMs;
    this.targetX = this.petX;
    this.targetY = this.petY;
  }

  private clearSpecialAction(): void {
    this.specialAction = 'none';
    this.specialUntil = 0;
  }
}

export const petFollowerRenderer = new PetFollowerRenderer();
