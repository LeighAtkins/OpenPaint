import { env, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src/index';

// For now, you'll need to do something like this to get a correctly-typed
// `Request` to pass to `worker.fetch()`.
const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

describe('sofapaint-api worker', () => {
	it('returns health payload (unit style)', async () => {
		const request = new IncomingRequest('http://example.com');
		const response = await worker.fetch(request, env as any);
		expect(response.status).toBe(200);
		const payload = await response.json<{
			ok: boolean;
			service: string;
			time: string;
		}>();
		expect(payload.ok).toBe(true);
		expect(payload.service).toBe('sofapaint-api');
		expect(Number.isNaN(Date.parse(payload.time))).toBe(false);
	});

	it('returns health payload (integration style)', async () => {
		const response = await SELF.fetch('https://example.com');
		expect(response.status).toBe(200);
		const payload = await response.json<{
			ok: boolean;
			service: string;
			time: string;
		}>();
		expect(payload.ok).toBe(true);
		expect(payload.service).toBe('sofapaint-api');
		expect(Number.isNaN(Date.parse(payload.time))).toBe(false);
	});
});
