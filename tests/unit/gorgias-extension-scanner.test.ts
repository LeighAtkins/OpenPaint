import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('Gorgias Chrome extension ticket scanner', () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function scanCurrentTicket() {
    vi.spyOn(window, 'postMessage').mockImplementation(((data: any) => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data,
          origin: window.location.origin,
          source: window,
        })
      );
    }) as typeof window.postMessage);
    let messageListener: any = null;
    vi.stubGlobal('chrome', {
      runtime: {
        onMessage: {
          addListener: vi.fn((listener: any) => {
            messageListener = listener;
          }),
        },
      },
    });
    const pageScript = fs.readFileSync(
      path.resolve('extensions/gorgias-sofapaint/page-gorgias.js'),
      'utf8'
    );
    const contentScript = fs.readFileSync(
      path.resolve('extensions/gorgias-sofapaint/content-gorgias.js'),
      'utf8'
    );
    new Function(pageScript)();
    new Function(contentScript)();
    return await new Promise<any>(resolve => {
      messageListener({ type: 'SCAN_TICKET' }, {}, resolve);
    });
  }

  it('finds attachment images once and excludes avatars', async () => {
    document.body.innerHTML = `
      <header><img src="https://comfort-works.gorgias.com/avatar.png" alt="Agent avatar" /></header>
      <main>
        <article class="message-row">
          <a href="/api/attachments/1/front.jpg" download="front.jpg">
            <img src="/api/attachments/1/front-thumb.jpg" alt="front.jpg" />
          </a>
          <a href="/api/attachments/1/front.jpg" download="front.jpg">Download again</a>
        </article>
        <article class="message-row">
          <a href="/api/attachments/2/side.png" download="side.png">
            <img src="/api/attachments/2/side-thumb.png" alt="side.png" />
          </a>
        </article>
      </main>`;
    window.history.replaceState({}, '', '/app/views/1384557/230640920');

    const response = await scanCurrentTicket();

    expect(response.ok).toBe(true);
    expect(response.ticketId).toBe('230640920');
    expect(response.attachments.map((item: any) => item.name)).toEqual(['front.jpg', 'side.png']);
    expect(response.attachments).toHaveLength(2);
  });

  it('finds Gorgias file cards whose signed download URLs have no image extension', async () => {
    document.body.innerHTML = `
      <main>
        <article class="message-row">
          <div data-testid="attachment-card">
            <a
              href="https://uploads.gorgias.io/secure-download?token=front-token"
              aria-label="IMG_2048.JPG"
            >
              <span>IMG_2048.JPG</span>
              <span>4.8 MB</span>
            </a>
          </div>
          <div class="attachment-preview" data-download-url="https://uploads.gorgias.io/secure-download?token=side-token" data-filename="side-view.png"></div>
        </article>
      </main>`;
    window.history.replaceState({}, '', '/app/ticket/230640920');

    const response = await scanCurrentTicket();

    expect(response.attachments.map((item: any) => item.name)).toEqual([
      'IMG_2048.JPG',
      'side-view.png',
    ]);
    expect(response.attachments.map((item: any) => item.url)).toEqual([
      'https://uploads.gorgias.io/secure-download?token=front-token',
      'https://uploads.gorgias.io/secure-download?token=side-token',
    ]);
  });

  it('keeps separately hosted same-name files for resolution analysis', async () => {
    document.body.innerHTML = `
      <div aria-label="Ticket thread">
        <a href="https://uploads.gorgias.io/low/photo.jpg" download="photo.jpg">
          <img src="https://uploads.gorgias.io/low/photo.jpg" alt="photo.jpg" width="320" height="240" />
        </a>
        <a href="https://uploads.gorgias.io/high/photo.jpg" download="photo.jpg">
          <img src="https://uploads.gorgias.io/high/photo.jpg" alt="photo.jpg" width="2400" height="1800" />
        </a>
      </div>`;

    const response = await scanCurrentTicket();

    expect(response.attachments).toHaveLength(2);
    expect(response.attachments.map((item: any) => item.url)).toEqual([
      'https://uploads.gorgias.io/low/photo.jpg',
      'https://uploads.gorgias.io/high/photo.jpg',
    ]);
  });

  it('merges an open lightbox slide resolution into its ticket attachment', async () => {
    const original =
      'https://comfort-works.gorgias.com/api/attachment/download/account/processed-photo.jpeg';
    document.body.innerHTML = `
      <div aria-label="Ticket thread">
        <a href="${original}" aria-label="processed-photo.jpeg">
          <img src="${original}?format=120x80" alt="processed-photo.jpeg" />
        </a>
      </div>
      <div class="yarl__root">
        <img class="yarl__slide_image" src="${original}" alt="processed-photo.jpeg" />
      </div>`;
    const thumbnail = document.querySelector(
      '[aria-label="Ticket thread"] img'
    ) as HTMLImageElement;
    const slide = document.querySelector('.yarl__slide_image') as HTMLImageElement;
    Object.defineProperties(thumbnail, {
      naturalWidth: { configurable: true, value: 120 },
      naturalHeight: { configurable: true, value: 80 },
    });
    Object.defineProperties(slide, {
      naturalWidth: { configurable: true, value: 1816 },
      naturalHeight: { configurable: true, value: 2420 },
    });

    const response = await scanCurrentTicket();

    expect(response.attachments).toHaveLength(1);
    expect(response.attachments[0]).toEqual(
      expect.objectContaining({
        url: original,
        width: 1816,
        height: 2420,
      })
    );
  });

  it('opens direct Gorgias attachment cards during scanning and records full lightbox pixels', async () => {
    const original =
      'https://comfort-works.gorgias.com/api/attachment/download/account/lazy-photo.jpeg';
    document.body.innerHTML = `
      <div aria-label="Ticket thread">
        <a href="${original}?format=120x80" aria-label="lazy-photo.jpeg">
          <div class="Attachment--preview--aVltm">
            <img src="${original}?format=120x80" alt="lazy-photo.jpeg" />
          </div>
        </a>
      </div>`;
    const preview = document.querySelector('.Attachment--preview--aVltm img') as HTMLImageElement;
    Object.defineProperties(preview, {
      naturalWidth: { configurable: true, value: 120 },
      naturalHeight: { configurable: true, value: 80 },
    });
    let revealCount = 0;
    let viewerWasHidden = false;
    preview.addEventListener('click', () => {
      revealCount += 1;
      viewerWasHidden = Boolean(
        document.querySelector('style[data-sofapaint-attachment-scan="true"]')
      );
      const lightbox = document.createElement('div');
      lightbox.className = 'yarl__root';
      lightbox.innerHTML = `
        <button class="yarl__button_close" aria-label="Close">Close</button>
        <img class="yarl__slide_image" src="${original}" alt="lazy-photo.jpeg" />`;
      const slide = lightbox.querySelector('img') as HTMLImageElement;
      Object.defineProperties(slide, {
        naturalWidth: { configurable: true, value: 4284 },
        naturalHeight: { configurable: true, value: 5712 },
      });
      lightbox.querySelector('button')?.addEventListener('click', () => lightbox.remove());
      document.body.appendChild(lightbox);
    });

    const response = await scanCurrentTicket();

    expect(revealCount).toBe(1);
    expect(viewerWasHidden).toBe(true);
    expect(document.querySelector('.yarl__root')).toBeNull();
    expect(document.querySelector('[data-sofapaint-attachment-scan]')).toBeNull();
    expect(response.attachments).toHaveLength(1);
    expect(response.attachments[0]).toEqual(
      expect.objectContaining({
        url: original,
        previewUrl: original,
        width: 4284,
        height: 5712,
      })
    );
  });

  it('rediscovers all four attachment cards when Gorgias rerenders them after every lightbox close', async () => {
    const originals = ['3091', '3092', '3090', '3089'].map(
      name =>
        `https://comfort-works.gorgias.com/api/attachment/download/account/IMG_${name}-photo.jpeg`
    );
    document.body.innerHTML = '<div aria-label="Ticket thread"></div>';
    const thread = document.querySelector('[aria-label="Ticket thread"]') as HTMLElement;
    const revealed: string[] = [];

    const renderCards = () => {
      thread.innerHTML = originals
        .map(
          (url, index) => `
        <button data-testid="attachment-card" aria-label="IMG_${['3091', '3092', '3090', '3089'][index]}.jpeg">
          <img src="data:image/jpeg;base64,AA==" alt="IMG_${['3091', '3092', '3090', '3089'][index]}.jpeg" />
        </button>`
        )
        .join('');
      thread.querySelectorAll('img').forEach((preview, index) => {
        Object.defineProperties(preview, {
          naturalWidth: { configurable: true, value: 120 },
          naturalHeight: { configurable: true, value: 80 },
        });
        preview.addEventListener('click', () => {
          const url = originals[index];
          revealed.push(url);
          const lightbox = document.createElement('div');
          lightbox.className = 'yarl__root';
          lightbox.innerHTML = `
            <button class="yarl__button_close" aria-label="Close" type="button">Close</button>
            <img class="yarl__slide_image" src="${url}" alt="photo" />`;
          const slide = lightbox.querySelector('.yarl__slide_image') as HTMLImageElement;
          Object.defineProperties(slide, {
            naturalWidth: { configurable: true, value: 4032 },
            naturalHeight: { configurable: true, value: 3024 },
          });
          lightbox.querySelector('button')?.addEventListener('click', () => {
            lightbox.remove();
            renderCards();
          });
          document.body.appendChild(lightbox);
        });
      });
    };
    renderCards();

    const response = await scanCurrentTicket();

    expect(revealed).toEqual(originals);
    expect(response.attachments).toHaveLength(4);
    expect(response.attachments.map((attachment: any) => attachment.url)).toEqual(originals);
    expect(
      response.attachments.every(
        (attachment: any) => attachment.width === 4032 && attachment.height === 3024
      )
    ).toBe(true);
  });

  it('keeps the active ticket attachments and excludes stale or decorative page images', async () => {
    document.body.innerHTML = `
      <section id="active-ticket">
        <div class="MessageBubble--messageBubble--active">
          <a href="/api/attachment/download/account/IMG_3091.jpeg" aria-label="IMG_3091.jpeg">
            <div class="Attachment--attachment--active"><img src="/api/attachment/download/account/IMG_3091.jpeg?format=120x80" alt="IMG_3091.jpeg" /></div>
          </a>
          <img src="https://public-uploads.gorgias.io/M2M_Photos_Please.png" alt="M2M Photos Please" />
          <img src="https://public-uploads.gorgias.io/SimpleLine.png" alt="SimpleLine.png" />
          <a href="https://drive.google.com/file/d/customer-photo/edit">Front view</a>
        </div>
      </section>
      <section id="stale-ticket">
        <div class="MessageBubble--messageBubble--stale">
          <img src="https://uploads.gorgias.io/other-ticket-photo.jpg" alt="ticket-226834987-1.jpg" />
        </div>
      </section>`;
    const activeBubble = document.querySelector(
      '.MessageBubble--messageBubble--active'
    ) as HTMLElement;
    vi.spyOn(activeBubble, 'getClientRects').mockReturnValue({ length: 1 } as DOMRectList);
    const attachment = activeBubble.querySelector('[alt="IMG_3091.jpeg"]') as HTMLImageElement;
    const separator = activeBubble.querySelector('[alt="SimpleLine.png"]') as HTMLImageElement;
    Object.defineProperties(attachment, {
      naturalWidth: { configurable: true, value: 120 },
      naturalHeight: { configurable: true, value: 80 },
    });
    Object.defineProperties(separator, {
      naturalWidth: { configurable: true, value: 181 },
      naturalHeight: { configurable: true, value: 6 },
    });

    const response = await scanCurrentTicket();

    expect(response.attachments.map((item: any) => item.name)).toEqual([
      'IMG_3091.jpeg',
      'drive-customer-photo.jpg',
    ]);
    expect(response.attachments[1].partLabel).toBe('front');
    expect(
      response.attachments.some((item: any) => /M2M|SimpleLine|226834987/.test(item.name))
    ).toBe(false);
  });

  it('promotes transformed Gorgias attachment thumbnails to their original download URL', async () => {
    const original =
      'https://comfort-works.gorgias.com/api/attachment/download/account/original-photo.jpeg';
    document.body.innerHTML = `
      <div aria-label="Ticket thread">
        <a href="${original}?format=120x80" aria-label="original-photo.jpeg">
          <img src="${original}?format=120x80" alt="original-photo.jpeg" />
        </a>
      </div>`;
    const preview = document.querySelector('img') as HTMLImageElement;
    Object.defineProperties(preview, {
      naturalWidth: { configurable: true, value: 120 },
      naturalHeight: { configurable: true, value: 80 },
    });

    const response = await scanCurrentTicket();

    expect(response.attachments).toHaveLength(1);
    expect(response.attachments[0]).toEqual(
      expect.objectContaining({
        url: original,
        previewUrl: `${original}?format=120x80`,
      })
    );
  });

  it('recognizes labeled tracked image links and preserves their SofaPaint part labels', async () => {
    document.body.innerHTML = `
      <div aria-label="Ticket thread">
        <p>Images:</p>
        <a href="https://ctrk.klclick.com/l/ticket-front">Front view</a>
        <a href="https://ctrk.klclick.com/l/ticket-side">Side view</a>
        <a href="https://ctrk.klclick.com/l/ticket-back">Back view</a>
        <a href="https://ctrk.klclick.com/l/ticket-cushion">Cushion view</a>
        <hr />
        <a href="https://ctrk.klclick.com/l/ticket-front-2">Front view</a>
        <a href="https://ctrk.klclick.com/l/ticket-side-2">Side view</a>
        <a href="https://ctrk.klclick.com/l/ticket-back-2">Back view</a>
        <a href="https://ctrk.klclick.com/l/ticket-cushion-2">Cushion view</a>
        <a href="https://ctrk.klclick.com/l/facebook">facebook</a>
      </div>`;
    window.history.replaceState({}, '', '/app/views/1384557/230998813');

    const response = await scanCurrentTicket();

    expect(response.attachments).toEqual([
      expect.objectContaining({ name: 'front.jpg', partLabel: 'front' }),
      expect.objectContaining({ name: 'side.jpg', partLabel: 'side' }),
      expect.objectContaining({ name: 'back.jpg', partLabel: 'back' }),
      expect.objectContaining({ name: 'cushion.jpg', partLabel: 'cushion' }),
      expect.objectContaining({ name: 'front.jpg', partLabel: 'front' }),
      expect.objectContaining({ name: 'side.jpg', partLabel: 'side' }),
      expect.objectContaining({ name: 'back.jpg', partLabel: 'back' }),
      expect.objectContaining({ name: 'cushion.jpg', partLabel: 'cushion' }),
    ]);
    expect(response.attachments.map((item: any) => item.url)).toEqual([
      'https://ctrk.klclick.com/l/ticket-front',
      'https://ctrk.klclick.com/l/ticket-side',
      'https://ctrk.klclick.com/l/ticket-back',
      'https://ctrk.klclick.com/l/ticket-cushion',
      'https://ctrk.klclick.com/l/ticket-front-2',
      'https://ctrk.klclick.com/l/ticket-side-2',
      'https://ctrk.klclick.com/l/ticket-back-2',
      'https://ctrk.klclick.com/l/ticket-cushion-2',
    ]);
  });

  it('recognizes localized Spanish tracked photo links from ticket 231097493', async () => {
    document.body.innerHTML = `
      <div aria-label="Ticket thread">
        <p>Imágenes:</p>
        <a href="https://ctrk.klclick.com/l/ticket-front">Vista frontal</a>
        <a href="https://ctrk.klclick.com/l/ticket-side">Vista lateral</a>
        <a href="https://ctrk.klclick.com/l/ticket-back">Vista trasera</a>
        <a href="https://ctrk.klclick.com/l/ticket-cushion">Vista de los cojines</a>
        <a href="https://ctrk.klclick.com/l/ticket-receipts">Recibos/Etiquetas</a>
        <a href="https://ctrk.klclick.com/l/facebook">facebook</a>
      </div>`;
    window.history.replaceState({}, '', '/app/views/1384557/231097493');

    const response = await scanCurrentTicket();

    expect(response.attachments).toEqual([
      expect.objectContaining({ name: 'front.jpg', partLabel: 'front' }),
      expect.objectContaining({ name: 'side.jpg', partLabel: 'side' }),
      expect.objectContaining({ name: 'back.jpg', partLabel: 'back' }),
      expect.objectContaining({ name: 'cushion.jpg', partLabel: 'cushion' }),
    ]);
    expect(response.attachments.some((item: any) => /receipts|facebook/.test(item.url))).toBe(
      false
    );
  });

  it('recognizes common Japanese photo labels', async () => {
    document.body.innerHTML = `
      <div aria-label="Ticket thread">
        <a href="https://ctrk.klclick.com/l/front">正面</a>
        <a href="https://ctrk.klclick.com/l/side">側面</a>
        <a href="https://ctrk.klclick.com/l/back">背面</a>
        <a href="https://ctrk.klclick.com/l/cushion">クッション</a>
      </div>`;

    const response = await scanCurrentTicket();

    expect(response.attachments.map((item: any) => item.partLabel)).toEqual([
      'front',
      'side',
      'back',
      'cushion',
    ]);
  });

  it('recognizes Google Drive file links as ticket photos without opening them', async () => {
    document.body.innerHTML = `
      <div aria-label="Ticket thread">
        <a href="https://drive.google.com/file/d/1Wu35LWMvomBsnTUTDP97RoBI4n_b7hn8/edit">Customer sofa photo</a>
      </div>`;
    window.history.replaceState({}, '', '/app/views/1384557/230057568');

    const response = await scanCurrentTicket();

    expect(response.attachments).toEqual([
      expect.objectContaining({
        name: 'drive-1Wu35LWMvomBsnTUTDP97RoBI4n_b7hn8.jpg',
        url: 'https://drive.google.com/file/d/1Wu35LWMvomBsnTUTDP97RoBI4n_b7hn8/edit',
        previewUrl:
          'https://drive.google.com/thumbnail?id=1Wu35LWMvomBsnTUTDP97RoBI4n_b7hn8&sz=w4096',
      }),
    ]);
  });

  it('downloads a protected attachment through the authenticated Gorgias page session', async () => {
    vi.spyOn(window, 'postMessage').mockImplementation(((data: any) => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data,
          origin: window.location.origin,
          source: window,
        })
      );
    }) as typeof window.postMessage);
    const fetchMock = vi.fn(
      async () =>
        new Response(
          new Blob([Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' }),
          {
            status: 200,
            headers: {
              'content-type': 'image/jpeg',
              'content-disposition': 'attachment; filename="private-view.jpg"',
            },
          }
        )
    );
    vi.stubGlobal('fetch', fetchMock);
    let messageListener: any = null;
    vi.stubGlobal('chrome', {
      runtime: {
        onMessage: {
          addListener: vi.fn((listener: any) => {
            messageListener = listener;
          }),
        },
      },
    });
    new Function(
      fs.readFileSync(path.resolve('extensions/gorgias-sofapaint/page-gorgias.js'), 'utf8')
    )();
    new Function(
      fs.readFileSync(path.resolve('extensions/gorgias-sofapaint/content-gorgias.js'), 'utf8')
    )();

    const response = await new Promise<any>(resolve => {
      messageListener(
        {
          type: 'FETCH_ATTACHMENT',
          attachment: {
            name: 'restricted.jpg',
            url: 'https://comfort-works.gorgias.com/api/attachments/private-view',
          },
        },
        {},
        resolve
      );
    });

    expect(response.ok).toBe(true);
    expect(response.image).toEqual(
      expect.objectContaining({
        name: 'private-view.jpg',
        mime: 'image/jpeg',
        size: 4,
      })
    );
    expect(response.image.dataUrl).toMatch(/^data:image\/jpeg;base64,/);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://comfort-works.gorgias.com/api/attachments/private-view',
      { credentials: 'same-origin', cache: 'no-store' }
    );
  });

  it('silently opens a specific attachment and returns the full lightbox image', async () => {
    const original =
      'https://comfort-works.gorgias.com/api/attachment/download/account/full-photo.jpeg';
    document.body.innerHTML = `
      <div aria-label="Ticket thread">
        <a href="${original}" aria-label="full-photo.jpeg">
          <div class="Attachment--preview--card">
            <img src="${original}?format=120x80" alt="full-photo.jpeg" />
          </div>
        </a>
      </div>`;
    vi.spyOn(window, 'postMessage').mockImplementation(((data: any) => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data,
          origin: window.location.origin,
          source: window,
        })
      );
    }) as typeof window.postMessage);
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            new Blob([Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' }),
            { status: 200, headers: { 'content-type': 'image/jpeg' } }
          )
      )
    );
    let viewerWasHidden = false;
    document.querySelector('img')?.addEventListener('click', () => {
      viewerWasHidden = Boolean(
        document.querySelector('style[data-sofapaint-attachment-reveal="true"]')
      );
      const lightbox = document.createElement('div');
      lightbox.className = 'yarl__root';
      lightbox.innerHTML = `
        <button class="yarl__button_close" aria-label="Close">Close</button>
        <img class="yarl__slide_image" src="${original}" alt="full-photo.jpeg" />`;
      const slide = lightbox.querySelector('img') as HTMLImageElement;
      Object.defineProperties(slide, {
        complete: { configurable: true, value: true },
        naturalWidth: { configurable: true, value: 4000 },
        naturalHeight: { configurable: true, value: 3000 },
      });
      lightbox.querySelector('button')?.addEventListener('click', () => lightbox.remove());
      document.body.appendChild(lightbox);
    });
    let messageListener: any = null;
    vi.stubGlobal('chrome', {
      runtime: {
        onMessage: {
          addListener: vi.fn((listener: any) => {
            messageListener = listener;
          }),
        },
      },
    });
    new Function(
      fs.readFileSync(path.resolve('extensions/gorgias-sofapaint/page-gorgias.js'), 'utf8')
    )();
    new Function(
      fs.readFileSync(path.resolve('extensions/gorgias-sofapaint/content-gorgias.js'), 'utf8')
    )();

    const response = await new Promise<any>(resolve => {
      messageListener(
        {
          type: 'FETCH_ATTACHMENT_ORIGINAL',
          attachment: { name: 'full-photo.jpeg', url: original, width: 120, height: 80 },
        },
        {},
        resolve
      );
    });

    expect(response.ok).toBe(true);
    expect(response.image).toEqual(expect.objectContaining({ width: 4000, height: 3000 }));
    expect(viewerWasHidden).toBe(true);
    expect(document.querySelector('.yarl__root')).toBeNull();
    expect(document.querySelector('[data-sofapaint-attachment-reveal]')).toBeNull();
  });

  it('returns to a remembered virtualized thread position before revealing the original', async () => {
    const original =
      'https://comfort-works.gorgias.com/api/attachment/download/account/historical-photo.jpeg';
    document.body.innerHTML = `
      <div id="thread-scroll" style="overflow-y:auto">
        <div aria-label="Ticket thread"></div>
      </div>`;
    const scroller = document.getElementById('thread-scroll') as HTMLElement;
    const thread = document.querySelector('[aria-label="Ticket thread"]') as HTMLElement;
    Object.defineProperties(scroller, {
      clientHeight: { configurable: true, value: 400 },
      scrollHeight: { configurable: true, value: 2400 },
    });
    const renderHistoricalCard = () => {
      thread.innerHTML = `
        <a href="${original}" aria-label="historical-photo.jpeg">
          <div class="Attachment--preview--card">
            <img src="${original}?format=120x80" alt="historical-photo.jpeg" />
          </div>
        </a>`;
      thread.querySelector('img')?.addEventListener('click', () => {
        const lightbox = document.createElement('div');
        lightbox.className = 'yarl__root';
        lightbox.innerHTML = `
          <button class="yarl__button_close" aria-label="Close">Close</button>
          <img class="yarl__slide_image" src="${original}" alt="historical-photo.jpeg" />`;
        const slide = lightbox.querySelector('img') as HTMLImageElement;
        Object.defineProperties(slide, {
          complete: { configurable: true, value: true },
          naturalWidth: { configurable: true, value: 4032 },
          naturalHeight: { configurable: true, value: 3024 },
        });
        lightbox.querySelector('button')?.addEventListener('click', () => lightbox.remove());
        document.body.appendChild(lightbox);
      });
    };
    scroller.addEventListener('scroll', () => {
      if (scroller.scrollTop === 1200) renderHistoricalCard();
      else thread.replaceChildren();
    });
    scroller.scrollTop = 20;

    vi.spyOn(window, 'postMessage').mockImplementation(((data: any) => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data,
          origin: window.location.origin,
          source: window,
        })
      );
    }) as typeof window.postMessage);
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            new Blob([Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' }),
            { status: 200, headers: { 'content-type': 'image/jpeg' } }
          )
      )
    );
    let messageListener: any = null;
    vi.stubGlobal('chrome', {
      runtime: {
        onMessage: {
          addListener: vi.fn((listener: any) => {
            messageListener = listener;
          }),
        },
      },
    });
    new Function(
      fs.readFileSync(path.resolve('extensions/gorgias-sofapaint/page-gorgias.js'), 'utf8')
    )();
    new Function(
      fs.readFileSync(path.resolve('extensions/gorgias-sofapaint/content-gorgias.js'), 'utf8')
    )();

    const response = await new Promise<any>(resolve => {
      messageListener(
        {
          type: 'FETCH_ATTACHMENT_ORIGINAL',
          attachment: {
            name: 'historical-photo.jpeg',
            url: original,
            width: 120,
            height: 80,
            ticketScrollTop: 1200,
          },
        },
        {},
        resolve
      );
    });

    expect(response.ok).toBe(true);
    expect(response.image).toEqual(expect.objectContaining({ width: 4032, height: 3024 }));
    expect(scroller.scrollTop).toBe(20);
  });

  it('extracts unopened attachment URLs from the Gorgias React attachment component', async () => {
    document.body.innerHTML = `
      <main>
        <button class="ticket-attachment-card" type="button">
          customer-sofa.jpg
          <img src="https://uploads.gorgias.io/opaque-thumbnail?id=customer-sofa" />
        </button>
      </main>`;
    window.history.replaceState({}, '', '/app/ticket/230640920');
    const card = document.querySelector('.ticket-attachment-card') as any;
    card.__reactProps$test = {
      attachment: {
        filename: 'customer-sofa.jpg',
        content_type: 'image/jpeg',
        src: 'https://uploads.gorgias.io/thumbnail/customer-sofa.jpg',
        download_url: 'https://uploads.gorgias.io/secure-download?token=unopened-image',
      },
      unnamedImage: {
        content_type: 'image/jpeg',
        url: 'https://uploads.gorgias.io/opaque-render-object',
      },
      analytics: {
        filename: 'tracking.jpg',
        url: 'https://ps.eyeota.net/match?bid=tracking-pixel',
      },
      adRoll: {
        url: 'https://d.adroll.com/cm/outbrain/out?advertisable=test',
      },
    };

    const response = await scanCurrentTicket();

    expect(response.attachments).toContainEqual(
      expect.objectContaining({
        name: 'customer-sofa.jpg',
        url: 'https://uploads.gorgias.io/secure-download?token=unopened-image',
      })
    );
    expect(
      response.attachments.filter((item: any) => item.name === 'customer-sofa.jpg')
    ).toHaveLength(1);
    expect(response.attachments.some((item: any) => item.url.includes('thumbnail'))).toBe(false);
    expect(response.attachments.some((item: any) => item.name.startsWith('ticket-'))).toBe(false);
    expect(
      response.attachments.some((item: any) => item.url.includes('opaque-render-object'))
    ).toBe(false);
    expect(response.attachments.some((item: any) => /eyeota|adroll/.test(item.url))).toBe(false);
  });

  it('scans lazy ticket renders and restores the original thread position', async () => {
    document.body.innerHTML = `
      <nav aria-label="Breadcrumbs"><a href="/app/customer/42">Hans WIDLUND</a></nav>
      <aside><img alt="Boxed Seat Snug Fit Armless Chair Slipcover" src="/product.jpg" /></aside>
      <div id="ticket-scroll" style="overflow-y:auto">
        <div aria-label="Ticket thread"></div>
      </div>`;
    window.history.replaceState({}, '', '/app/ticket/226834987');
    const scroller = document.getElementById('ticket-scroll') as HTMLElement;
    const thread = document.querySelector('[aria-label="Ticket thread"]') as HTMLElement;
    let scrollTop = 320;
    const renderAt = (position: number) => {
      const filename = position < 500 ? 'front.jpg' : 'back.jpg';
      thread.innerHTML = `
        ${position >= 500 ? '<p>SKU: CS1B-NA-SNUG__PO__VELC__SP__BEN-04</p>' : ''}
        <a href="/api/attachment/download/${filename}" download="${filename}">
          <img src="/api/attachment/preview/${filename}" alt="${filename}" width="1200" height="900" />
        </a>`;
    };
    renderAt(scrollTop);
    Object.defineProperties(scroller, {
      clientHeight: { configurable: true, value: 500 },
      scrollHeight: { configurable: true, value: 1500 },
      scrollTop: {
        configurable: true,
        get: () => scrollTop,
        set: value => {
          scrollTop = Number(value);
          renderAt(scrollTop);
        },
      },
    });

    const response = await scanCurrentTicket();

    expect(response.attachments.map((item: any) => item.name).sort()).toEqual([
      'back.jpg',
      'front.jpg',
    ]);
    expect(response).toEqual(
      expect.objectContaining({
        customerName: 'Hans WIDLUND',
        productSku: 'CS1B-NA-SNUG__PO__VELC__SP__BEN-04',
        guideCode: 'CS1B-NA-SNUG',
      })
    );
    expect(scrollTop).toBe(320);
  });

  it('ignores Shopify fabric thumbnails outside the ticket thread', async () => {
    document.body.innerHTML = `
      <main>
        <div aria-label="Ticket thread">
          <a href="/api/attachment/download/sofa.jpg" download="sofa.jpg">
            <img src="/api/attachment/preview/sofa.jpg" alt="sofa.jpg" width="1600" height="1200" />
          </a>
        </div>
        <aside class="CustomerDetailsPanel-module--customerDetailsPanel--RBQLr">
          <img
            src="https://cdn.shopify.com/files/COS-105_Care_Linen_Natural.avif"
            alt="Care+ Linen Natural"
            width="600"
            height="600"
          />
        </aside>
      </main>`;
    window.history.replaceState({}, '', '/app/ticket/226834987');

    const response = await scanCurrentTicket();

    expect(response.attachments.map((item: any) => item.name)).toEqual(['sofa.jpg']);
    expect(response.attachments.some((item: any) => /linen|COS-105/i.test(item.url))).toBe(false);
  });

  it('extracts customer, product, SKU, and guide code for project naming', async () => {
    document.body.innerHTML = `
      <nav aria-label="Breadcrumbs">
        <a href="/app/customer/42">Jamie Customer</a>
      </nav>
      <div class="CopyableField--fieldInline--title">
        <span data-name="text">Boxed Seat Snug Fit Armless Chair Slipcover - Crypton Chenille Burnt Orange - <span class="OrderSidePanelPreview--label">Estimated delivery in 6-7 weeks / Snug Fit</span></span>
        <button aria-label="Copy product title"></button>
      </div>
      <div class="CopyableField--fieldInline--sku">
        <span data-name="text" class="OrderSidePanelPreview--label">SKU: CS1B-NA-SNUG__PO__VELC__SP__BEN-04</span>
        <button aria-label="Copy SKU"></button>
      </div>
      <div aria-label="Ticket thread">
        <a href="/api/attachment/customer.jpg" download="customer.jpg">
          <img src="/api/attachment/customer.jpg" alt="customer.jpg" width="1200" height="900" />
        </a>
      </div>`;
    window.history.replaceState({}, '', '/app/ticket/221130761');

    const response = await scanCurrentTicket();

    expect(response).toEqual(
      expect.objectContaining({
        ticketId: '221130761',
        customerName: 'Jamie Customer',
        productName: 'Boxed Seat Snug Fit Armless Chair Slipcover - Crypton Chenille Burnt Orange',
        productSku: 'CS1B-NA-SNUG__PO__VELC__SP__BEN-04',
        guideCode: 'CS1B-NA-SNUG',
      })
    );
  });

  it('uses collapsed Shopify product and ticket SKU fallbacks', async () => {
    document.body.innerHTML = `
      <ol aria-label="Breadcrumbs"><li><a href="/app/customer/519708183">Hans WIDLUND</a></li></ol>
      <div aria-label="Ticket thread">
        <p>CS1B-NA-SNUG Boxed Seat Snug Fit Armless Chair Slipcover USD 909 x 1</p>
        <a href="/api/attachment/chair.jpg" download="chair.jpg">
          <img src="/api/attachment/chair.jpg" alt="chair.jpg" width="1200" height="900" />
        </a>
      </div>
      <aside>
        <img alt="Boxed Seat Snug Fit Armless Chair Slipcover - Crypton Chenille Burnt Orange" src="/shopify/product.png" />
      </aside>`;
    window.history.replaceState({}, '', '/app/views/1384560/221130761');

    const response = await scanCurrentTicket();

    expect(response).toEqual(
      expect.objectContaining({
        customerName: 'Hans WIDLUND',
        productName: 'Boxed Seat Snug Fit Armless Chair Slipcover - Crypton Chenille Burnt Orange',
        productSku: 'CS1B-NA-SNUG',
        guideCode: 'CS1B-NA-SNUG',
      })
    );
  });
});
