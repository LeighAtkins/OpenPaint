// Pet Follower Renderer — animated pixel pet that follows the cursor
// Single canvas element, rAF-driven, auto-pauses when tab hidden

import { buildPetConfig, type PetConfig } from './petConfig';

type AnimState = 'idle' | 'walk' | 'run';

class PetFollowerRenderer {
  private config: PetConfig | null = null;
  private sprites: Record<string, HTMLImageElement> = {};
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

  // Animation state
  private animState: AnimState = 'idle';
  private frame = 0;
  private frameTick = 0;
  private idleTimer = 0;
  private lastMoveTime = 0;

  private handleMouseMove = (e: MouseEvent) => {
    this.targetX = e.clientX - 30;
    this.targetY = e.clientY + 10;
  };

  async mount(petId: string): Promise<void> {
    if (this.mounted) this.unmount();

    const config = buildPetConfig(petId);
    if (!config) return;
    this.config = config;

    // Preload sprite sheets
    const animKeys: AnimState[] = ['idle', 'walk', 'run'];
    await Promise.all(animKeys.map(key => this.loadSprite(key, config.animations[key].path)));

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

    // Listen for mouse
    document.addEventListener('mousemove', this.handleMouseMove);

    this.mounted = true;
    this.lastMoveTime = performance.now();
    this.tick(performance.now());
  }

  unmount(): void {
    this.mounted = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    document.removeEventListener('mousemove', this.handleMouseMove);
    this.overlay?.remove();
    this.overlay = null;
    this.canvas = null;
    this.ctx = null;
    this.sprites = {};
    this.config = null;
    this.frame = 0;
    this.frameTick = 0;
  }

  isMounted(): boolean {
    return this.mounted;
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

    // Lerp toward target
    const dx = this.targetX - this.petX;
    const dy = this.targetY - this.petY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > 2) {
      this.petX += dx * 0.08;
      this.petY += dy * 0.08;
      this.lastMoveTime = now;

      // Determine facing direction
      if (Math.abs(dx) > 1) {
        this.facingLeft = dx < 0;
      }
    }

    // Determine animation state
    const timeSinceMove = now - this.lastMoveTime;
    let newState: AnimState;
    if (timeSinceMove > 300) {
      newState = 'idle';
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

    // Advance frame (~10 FPS for animation)
    this.frameTick++;
    const animSpeed = this.animState === 'run' ? 4 : 6;
    if (this.frameTick >= animSpeed) {
      this.frameTick = 0;
      const anim = this.config.animations[this.animState];
      this.frame = (this.frame + 1) % anim.frameCount;
    }

    // Render
    this.render();
  };

  private render(): void {
    if (!this.ctx || !this.canvas || !this.config) return;

    const sprite = this.sprites[this.animState];
    if (!sprite) return;

    const { frameSize, displaySize } = this.config;
    const sx = this.frame * frameSize;

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
  }
}

export const petFollowerRenderer = new PetFollowerRenderer();
