/**
 * Result type for explicit error handling - no more thrown exceptions!
 * Inspired by Rust's Result<T, E>
 */

export type Result<T, E = Error> = 
  | { success: true; data: T }
  | { success: false; error: E };

export const Result = {
  ok<T>(data: T): Result<T, never> {
    return { success: true, data };
  },

  err<E>(error: E): Result<never, E> {
    return { success: false, error };
  },

  isOk<T, E>(result: Result<T, E>): result is { success: true; data: T } {
    return result.success;
  },

  isErr<T, E>(result: Result<T, E>): result is { success: false; error: E } {
    return !result.success;
  },

  map<T, U, E>(result: Result<T, E>, fn: (data: T) => U): Result<U, E> {
    if (result.success) {
      return Result.ok(fn(result.data));
    }
    return result;
  },

  mapErr<T, E, F>(result: Result<T, E>, fn: (error: E) => F): Result<T, F> {
    if (!result.success) {
      return Result.err(fn(result.error));
    }
    return result;
  },

  flatMap<T, U, E>(
    result: Result<T, E>,
    fn: (data: T) => Result<U, E>
  ): Result<U, E> {
    if (result.success) {
      return fn(result.data);
    }
    return result;
  },

  unwrap<T, E>(result: Result<T, E>): T {
    if (result.success) {
      return result.data;
    }
    throw result.error;
  },

  unwrapOr<T, E>(result: Result<T, E>, defaultValue: T): T {
    if (result.success) {
      return result.data;
    }
    return defaultValue;
  },

  unwrapOrElse<T, E>(result: Result<T, E>, fn: (error: E) => T): T {
    if (result.success) {
      return result.data;
    }
    return fn(result.error);
  },

  async fromPromise<T>(promise: Promise<T>): Promise<Result<T, Error>> {
    try {
      const data = await promise;
      return Result.ok(data);
    } catch (error) {
      return Result.err(error instanceof Error ? error : new Error(String(error)));
    }
  },

  async fromAsync<T, E = Error>(
    fn: () => Promise<T>,
    errorMapper?: (e: unknown) => E
  ): Promise<Result<T, E>> {
    try {
      const data = await fn();
      return Result.ok(data);
    } catch (error) {
      const mappedError = errorMapper
        ? errorMapper(error)
        : (error instanceof Error ? error : new Error(String(error))) as E;
      return Result.err(mappedError);
    }
  },

  combine<T extends readonly Result<unknown, unknown>[]>(
    results: T
  ): Result<
    { [K in keyof T]: T[K] extends Result<infer U, unknown> ? U : never },
    T[number] extends Result<unknown, infer E> ? E : never
  > {
    const values: unknown[] = [];
    for (const result of results) {
      if (!result.success) {
        return result as Result<never, T[number] extends Result<unknown, infer E> ? E : never>;
      }
      values.push(result.data);
    }
    return Result.ok(values as { [K in keyof T]: T[K] extends Result<infer U, unknown> ? U : never });
  },
} as const;

// AsyncResult helper for chaining
export class AsyncResult<T, E = Error> {
  constructor(private readonly promise: Promise<Result<T, E>>) {}

  static from<T>(promise: Promise<T>): AsyncResult<T, Error> {
    return new AsyncResult(Result.fromPromise(promise));
  }

  static ok<T>(data: T): AsyncResult<T, never> {
    return new AsyncResult(Promise.resolve(Result.ok(data)));
  }

  static err<E>(error: E): AsyncResult<never, E> {
    return new AsyncResult(Promise.resolve(Result.err(error)));
  }

  map<U>(fn: (data: T) => U): AsyncResult<U, E> {
    return new AsyncResult(
      this.promise.then(result => Result.map(result, fn))
    );
  }

  flatMap<U>(fn: (data: T) => AsyncResult<U, E>): AsyncResult<U, E> {
    return new AsyncResult(
      this.promise.then(async result => {
        if (!result.success) return result;
        return fn(result.data).run();
      })
    );
  }

  run(): Promise<Result<T, E>> {
    return this.promise;
  }
}