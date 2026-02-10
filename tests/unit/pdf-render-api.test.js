import { beforeEach, describe, expect, test, vi } from 'vitest';

const renderPdfFromRequestMock = vi.fn();

vi.mock('../../server/pdf/service.js', () => ({
  resolvePdfRendererMode: vi.fn(() => 'hybrid'),
  renderPdfFromRequest: (...args) => renderPdfFromRequestMock(...args),
}));

function createMockRes() {
  const headers = {};
  return {
    statusCode: 200,
    headers,
    body: null,
    setHeader(name, value) {
      headers[name] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    },
  };
}

describe('/api/pdf/render handler', () => {
  beforeEach(() => {
    renderPdfFromRequestMock.mockReset();
  });

  test('returns 200 and PDF payload for valid report request', async () => {
    const { default: handler } = await import('../../api/pdf/render.js');
    renderPdfFromRequestMock.mockResolvedValue(Buffer.from('%PDF-1.4 test', 'utf8'));

    const req = {
      method: 'POST',
      body: {
        source: 'report',
        report: {
          projectName: 'Test',
          namingLine: 'A | B | C',
          groups: [
            {
              title: 'Group 1',
              subtitle: '',
              mainImage: { title: 'Main', src: 'data:image/png;base64,AAAA' },
              mainMeasurements: [{ label: 'A1', value: '12"' }],
              relatedFrames: [],
              relatedMeasurementCards: [],
            },
          ],
        },
        options: {
          renderer: 'hybrid',
          pageSize: 'letter',
          filename: 'sample.pdf',
        },
      },
    };
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toBe('application/pdf');
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect(renderPdfFromRequestMock).toHaveBeenCalledTimes(1);
  });
});
