import { describe, expect, it } from "vitest";

describe("vitest wiring", () => {
  it("runs the test runner end-to-end", () => {
    expect(2 + 2).toBe(4);
  });
});
