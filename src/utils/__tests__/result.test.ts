import { describe, it, expect } from 'vitest';
import { Result, AsyncResult } from '../result';

describe('Result', () => {
  describe('ok', () => {
    it('creates a success result', () => {
      const result = Result.ok(42);
      expect(result.success).toBe(true);
      expect(Result.isOk(result)).toBe(true);
      if (result.success) {
        expect(result.data).toBe(42);
      }
    });
  });

  describe('err', () => {
    it('creates an error result', () => {
      const error = new Error('test error');
      const result = Result.err(error);
      expect(result.success).toBe(false);
      expect(Result.isErr(result)).toBe(true);
      if (!result.success) {
        expect(result.error).toBe(error);
      }
    });
  });

  describe('map', () => {
    it('transforms success value', () => {
      const result = Result.ok(5);
      const mapped = Result.map(result, x => x * 2);
      expect(Result.unwrap(mapped)).toBe(10);
    });

    it('passes through error', () => {
      const result = Result.err<Error>(new Error('test'));
      const mapped = Result.map(result, (x: number) => x * 2);
      expect(Result.isErr(mapped)).toBe(true);
    });
  });

  describe('flatMap', () => {
    it('chains success results', () => {
      const result = Result.ok(5);
      const chained = Result.flatMap(result, x => Result.ok(x * 2));
      expect(Result.unwrap(chained)).toBe(10);
    });

    it('short-circuits on error', () => {
      const result = Result.err<Error>(new Error('test'));
      const chained = Result.flatMap(result, (x: number) => Result.ok(x * 2));
      expect(Result.isErr(chained)).toBe(true);
    });
  });

  describe('unwrapOr', () => {
    it('returns value on success', () => {
      const result = Result.ok(42);
      expect(Result.unwrapOr(result, 0)).toBe(42);
    });

    it('returns default on error', () => {
      const result = Result.err(new Error('test'));
      expect(Result.unwrapOr(result, 0)).toBe(0);
    });
  });

  describe('combine', () => {
    it('combines multiple success results', () => {
      const results = [Result.ok(1), Result.ok(2), Result.ok(3)] as const;
      const combined = Result.combine(results);
      expect(Result.isOk(combined)).toBe(true);
      if (combined.success) {
        expect(combined.data).toEqual([1, 2, 3]);
      }
    });

    it('returns first error', () => {
      const error = new Error('test');
      const results = [Result.ok(1), Result.err(error), Result.ok(3)] as const;
      const combined = Result.combine(results);
      expect(Result.isErr(combined)).toBe(true);
    });
  });

  describe('fromPromise', () => {
    it('handles resolved promise', async () => {
      const result = await Result.fromPromise(Promise.resolve(42));
      expect(Result.isOk(result)).toBe(true);
      expect(Result.unwrap(result)).toBe(42);
    });

    it('handles rejected promise', async () => {
      const result = await Result.fromPromise(Promise.reject(new Error('test')));
      expect(Result.isErr(result)).toBe(true);
    });
  });
});

describe('AsyncResult', () => {
  it('chains async operations', async () => {
    const result = await AsyncResult.ok(5)
      .map(x => x * 2)
      .map(x => x + 1)
      .run();

    expect(Result.unwrap(result)).toBe(11);
  });
});