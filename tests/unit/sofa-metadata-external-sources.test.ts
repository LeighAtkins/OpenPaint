import { describe, expect, it } from 'vitest';
import { mergeSofaMetadata, normalizeSofaMetadata } from '../../src/modules/sofa-metadata.js';

describe('Sofa project external sources', () => {
  it('preserves Gorgias ticket identity and imported image hashes through normalization', () => {
    const normalized = normalizeSofaMetadata({
      externalSources: {
        gorgiasTickets: {
          '221130761': {
            ticketUrl: 'https://comfort-works.gorgias.com/app/ticket/221130761',
            customerName: 'Jamie Customer',
            productName: 'Boxed Seat Snug Fit Armless Chair Slipcover',
            productSku: 'CS1B-NA-SNUG__PO__VELC__SP__BEN-04',
            guideCode: 'CS1B-NA-SNUG',
            importedImageHashes: ['HASH-A', 'hash-a', 'hash-b'],
            lastImportedAt: '2026-07-16T09:00:00.000Z',
          },
        },
      },
    });

    expect(normalized.externalSources.gorgiasTickets['221130761']).toEqual({
      ticketId: '221130761',
      ticketUrl: 'https://comfort-works.gorgias.com/app/ticket/221130761',
      customerName: 'Jamie Customer',
      productName: 'Boxed Seat Snug Fit Armless Chair Slipcover',
      productSku: 'CS1B-NA-SNUG__PO__VELC__SP__BEN-04',
      guideCode: 'CS1B-NA-SNUG',
      importedImageHashes: ['hash-a', 'hash-b'],
      lastImportedAt: '2026-07-16T09:00:00.000Z',
    });
  });

  it('keeps an existing ticket link when unrelated metadata is merged', () => {
    const current = normalizeSofaMetadata({
      externalSources: {
        gorgiasTickets: {
          '221130761': {
            ticketUrl: 'https://comfort-works.gorgias.com/app/ticket/221130761',
            importedImageHashes: ['hash-a'],
          },
        },
      },
    });

    const merged = mergeSofaMetadata(current, { tagSize: 24 });

    expect(merged.externalSources.gorgiasTickets['221130761'].importedImageHashes).toEqual([
      'hash-a',
    ]);
  });
});
