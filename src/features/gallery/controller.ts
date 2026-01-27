/**
 * Gallery Controller
 * Manages gallery DOM bindings and navigation (pure TS, no legacy)
 */

import { useGalleryStore, selectNavigationState } from './store';
import type { ImageItem } from '../store/types';
import type { NavigationActions } from './types';

// ═══════════════════════════════════════════════════════════════════════════
// GALLERY CONTROLLER
// ═══════════════════════════════════════════════════════════════════════════

export class GalleryController implements NavigationActions {
  private domElements: {
    gallery: HTMLElement | null;
    dots: HTMLElement | null;
    prevButton: HTMLElement | null;
    nextButton: HTMLElement | null;
    imagePosition: HTMLElement | null;
    imageCounter: HTMLElement | null;
    nameInput: HTMLInputElement | null;
    typeSelect: HTMLSelectElement | null;
  } = {
    gallery: null,
    dots: null,
    prevButton: null,
    nextButton: null,
    imagePosition: null,
    imageCounter: null,
    nameInput: null,
    typeSelect: null,
  };

  private unsubscribers: (() => void)[] = [];
  private intersectionObserver: IntersectionObserver | null = null;

  /**
   * Initialize the gallery controller
   */
  initialize(): void {
    if (typeof window === 'undefined') return;

    // Cache DOM elements
    this.domElements = {
      gallery: document.getElementById('imageGallery'),
      dots: document.getElementById('imageDots'),
      prevButton: document.getElementById('prevImage'),
      nextButton: document.getElementById('nextImage'),
      imagePosition: document.getElementById('imagePosition'),
      imageCounter: document.getElementById('imageCounter'),
      nameInput: document.getElementById('imageNameInput') as HTMLInputElement,
      typeSelect: document.getElementById('imageTypeSelect') as HTMLSelectElement,
    };

    // Setup event listeners
    this.setupEventListeners();

    // Setup intersection observer
    this.setupIntersectionObserver();

    // Subscribe to store changes
    this.subscribeToStore();

    // Initial UI update
    this.updateUI();

    console.log('[GalleryController] Initialized');
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.unsubscribers.forEach(unsub => unsub());
    this.unsubscribers = [];

    if (this.intersectionObserver) {
      this.intersectionObserver.disconnect();
      this.intersectionObserver = null;
    }

    console.log('[GalleryController] Destroyed');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // NAVIGATION ACTIONS
  // ═══════════════════════════════════════════════════════════════════════

  goToPrevious(): void {
    const store = useGalleryStore.getState();
    const nav = selectNavigationState(store);
    if (nav.canGoPrevious) {
      this.goToIndex(nav.currentIndex - 1);
    }
  }

  goToNext(): void {
    const store = useGalleryStore.getState();
    const nav = selectNavigationState(store);
    if (nav.canGoNext) {
      this.goToIndex(nav.currentIndex + 1);
    }
  }

  goToIndex(index: number): void {
    const store = useGalleryStore.getState();
    const images = store.getOrderedImages();

    if (index >= 0 && index < images.length) {
      const image = images[index];
      if (!image) return;
      store.setActiveImage(image.label);

      // Scroll thumbnail into view
      this.scrollThumbnailIntoView(index);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PRIVATE METHODS
  // ═══════════════════════════════════════════════════════════════════════

  private setupEventListeners(): void {
    const { prevButton, nextButton, nameInput, typeSelect } = this.domElements;

    prevButton?.addEventListener('click', () => this.goToPrevious());
    nextButton?.addEventListener('click', () => this.goToNext());

    nameInput?.addEventListener('change', e => {
      const target = e.target as HTMLInputElement;
      const store = useGalleryStore.getState();
      const currentImage = store.getCurrentImage();
      if (currentImage) {
        store.updateImage(currentImage.label, { name: target.value });
      }
    });

    typeSelect?.addEventListener('change', e => {
      const target = e.target as HTMLSelectElement;
      const store = useGalleryStore.getState();
      const currentImage = store.getCurrentImage();
      if (currentImage) {
        store.updateImage(currentImage.label, { type: target.value });
      }
    });

    // Keyboard navigation
    document.addEventListener('keydown', e => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target as HTMLElement).isContentEditable
      ) {
        return;
      }

      const imagePanel = document.getElementById('imagePanel');
      if (imagePanel?.classList.contains('hidden')) return;

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        this.goToPrevious();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        this.goToNext();
      }
    });
  }

  private setupIntersectionObserver(): void {
    const { gallery } = this.domElements;
    if (!gallery) return;

    this.intersectionObserver = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const index = parseInt((entry.target as HTMLElement).dataset['imageIndex'] || '-1');
            if (index >= 0) {
              const store = useGalleryStore.getState();
              const images = store.getOrderedImages();
              if (images[index]) {
                store.setActiveImage(images[index].label);
              }
            }
          }
        });
      },
      {
        root: gallery,
        threshold: 0.6,
        rootMargin: '0px',
      }
    );
  }

  private subscribeToStore(): void {
    // Subscribe to active image changes
    const unsubActive = useGalleryStore.subscribe(
      state => state.activeImageLabel,
      () => {
        this.updateUI();
        this.updateInputsFromImage();
      }
    );
    this.unsubscribers.push(unsubActive);

    // Subscribe to image order changes
    const unsubOrder = useGalleryStore.subscribe(
      state => state.imageOrder,
      () => {
        this.rebuildGalleryDOM();
      }
    );
    this.unsubscribers.push(unsubOrder);

    // Subscribe to image updates
    const unsubImages = useGalleryStore.subscribe(
      state => state.images,
      () => {
        this.updateThumbnails();
      }
    );
    this.unsubscribers.push(unsubImages);
  }

  private updateUI(): void {
    const store = useGalleryStore.getState();
    const nav = selectNavigationState(store);

    const { prevButton, nextButton, imagePosition, imageCounter } = this.domElements;

    if (prevButton) {
      (prevButton as HTMLButtonElement).disabled = !nav.canGoPrevious;
    }
    if (nextButton) {
      (nextButton as HTMLButtonElement).disabled = !nav.canGoNext;
    }
    if (imagePosition) {
      imagePosition.textContent = `${nav.currentIndex + 1} / ${nav.totalCount}`;
    }
    if (imageCounter) {
      imageCounter.textContent = nav.totalCount > 0 ? `${nav.totalCount} images` : '';
    }

    // Update active thumbnail highlighting
    this.updateActiveThumbnail(nav.currentIndex);
    this.updateActiveDot(nav.currentIndex);
  }

  private updateInputsFromImage(): void {
    const { nameInput, typeSelect } = this.domElements;
    const currentImage = useGalleryStore.getState().getCurrentImage();

    if (nameInput) {
      nameInput.value = currentImage?.name || '';
    }
    if (typeSelect) {
      typeSelect.value = currentImage?.type || '';
    }
  }

  private updateActiveThumbnail(activeIndex: number): void {
    const thumbnails = document.querySelectorAll('.image-thumbnail');
    thumbnails.forEach((thumb, idx) => {
      thumb.classList.toggle('active', idx === activeIndex);
    });
  }

  private updateActiveDot(activeIndex: number): void {
    const dots = document.querySelectorAll('.nav-dot');
    dots.forEach((dot, idx) => {
      dot.classList.toggle('active', idx === activeIndex);
    });
  }

  private scrollThumbnailIntoView(index: number): void {
    const { gallery } = this.domElements;
    if (!gallery) return;

    const thumbnail = gallery.querySelector(`[data-image-index="${index}"]`);
    if (thumbnail) {
      thumbnail.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'center',
      });
    }
  }

  private rebuildGalleryDOM(): void {
    const { gallery, dots } = this.domElements;
    if (!gallery || !dots) return;

    const store = useGalleryStore.getState();
    const images = store.getOrderedImages();

    // Clear existing
    gallery.innerHTML = '';
    dots.innerHTML = '';

    // Rebuild
    images.forEach((image, index) => {
      // Create thumbnail
      const card = this.createThumbnailCard(image, index);
      gallery.appendChild(card);

      // Create dot
      const dot = document.createElement('div');
      dot.className = 'nav-dot';
      dot.dataset['imageIndex'] = String(index);
      dot.addEventListener('click', () => this.goToIndex(index));
      dots.appendChild(dot);

      // Observe for intersection
      const thumbnail = card.querySelector('.image-thumbnail');
      if (thumbnail && this.intersectionObserver) {
        this.intersectionObserver.observe(thumbnail);
      }
    });

    this.updateUI();
  }

  private createThumbnailCard(image: ImageItem, index: number): HTMLElement {
    const card = document.createElement('div');
    card.className = 'flex flex-col items-center gap-1';

    const thumbnail = document.createElement('div');
    thumbnail.className = 'image-thumbnail';
    thumbnail.dataset['imageIndex'] = String(index);
    thumbnail.style.backgroundImage = `url(${image.thumbnail || image.src})`;
    thumbnail.title = image.name;
    thumbnail.draggable = true;

    // Apply rotation transform to thumbnail
    if (image.rotation !== 0) {
      thumbnail.style.transform = `rotate(${image.rotation}deg)`;
    }

    // Click handler
    thumbnail.addEventListener('click', () => {
      useGalleryStore.getState().setActiveImage(image.label);
    });

    // Drag handlers
    this.setupDragHandlers(thumbnail, index);

    // Delete control
    const deleteControl = this.createDeleteControl(image.label);
    thumbnail.appendChild(deleteControl);

    card.appendChild(thumbnail);

    // Caption
    if (!image.isBlankCanvas) {
      const caption = document.createElement('div');
      caption.className =
        'thumb-caption text-[11px] text-slate-500 font-medium truncate max-w-[120px]';
      caption.textContent = image.name;
      card.appendChild(caption);
    }

    return card;
  }

  private createDeleteControl(label: string): HTMLElement {
    const control = document.createElement('div');
    control.className = 'delete-control';

    const btn = document.createElement('button');
    btn.className = 'control-btn delete-btn';
    btn.innerHTML = '&times;';
    btn.title = 'Delete image';
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const image = useGalleryStore.getState().getImage(label);
      if (image && confirm(`Delete "${image.name}"?`)) {
        useGalleryStore.getState().removeImage(label);
      }
    });

    control.appendChild(btn);
    return control;
  }

  private setupDragHandlers(thumbnail: HTMLElement, index: number): void {
    thumbnail.addEventListener('dragstart', e => {
      e.dataTransfer!.setData('text/plain', String(index));
      thumbnail.classList.add('dragging');
      e.dataTransfer!.effectAllowed = 'move';
    });

    thumbnail.addEventListener('dragend', () => {
      thumbnail.classList.remove('dragging');
    });

    thumbnail.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'move';
      thumbnail.classList.add('drag-over');
    });

    thumbnail.addEventListener('dragleave', () => {
      thumbnail.classList.remove('drag-over');
    });

    thumbnail.addEventListener('drop', e => {
      e.preventDefault();
      thumbnail.classList.remove('drag-over');

      const fromIndex = parseInt(e.dataTransfer!.getData('text/plain'));
      const toIndex = index;

      if (fromIndex !== toIndex) {
        useGalleryStore.getState().reorderImages(fromIndex, toIndex);
      }
    });
  }

  private updateThumbnails(): void {
    const store = useGalleryStore.getState();
    const images = store.getOrderedImages();
    const thumbnails = document.querySelectorAll('.image-thumbnail');

    thumbnails.forEach((thumb, index) => {
      const image = images[index];
      if (image) {
        (thumb as HTMLElement).style.backgroundImage = `url(${image.thumbnail || image.src})`;

        // Update rotation
        if (image.rotation !== 0) {
          (thumb as HTMLElement).style.transform = `rotate(${image.rotation}deg)`;
        } else {
          (thumb as HTMLElement).style.transform = '';
        }
      }
    });
  }
}

// Export singleton instance
export const galleryController = new GalleryController();
