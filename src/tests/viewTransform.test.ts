import { describe, it, expect } from "vitest";
import { createViewTransform } from "@/lib/viewTransform";

describe("view transform", () => {
  it("round-trips image→canvas→image", () => {
    const t = createViewTransform(2000, 1000, 1000, 500, 2);
    const p = { x: 123.45, y: 678.9 };
    const c = t.toCanvas(p);
    const p2 = t.toImage(c);
    expect(Math.abs(p2.x - p.x)).toBeLessThan(1e-6);
    expect(Math.abs(p2.y - p.y)).toBeLessThan(1e-6);
  });

  it("keeps pointer location under zoom center stable", () => {
    const t1 = createViewTransform(1600, 1200, 800, 600, 2);
    const p  = { x: 400, y: 300 };
    const c1 = t1.toCanvas(p);
    const t2 = createViewTransform(1600, 1200, 1000, 750, 2);
    const c2 = t2.toCanvas(p);
    // normalized positions should match
    expect((c1.cx - t1.ox) / t1.scale).toBeCloseTo((c2.cx - t2.ox) / t2.scale, 6);
    expect((c1.cy - t1.oy) / t1.scale).toBeCloseTo((c2.cy - t2.oy) / t2.scale, 6);
  });
});
