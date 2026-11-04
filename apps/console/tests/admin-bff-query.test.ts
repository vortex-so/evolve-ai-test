import { describe, expect, it } from "vitest";

import { withSearch } from "../src/lib/admin-bff";

describe("withSearch", () => {
  it("preserves query values containing plus, ampersand, and percent characters", () => {
    const path = withSearch(
      "/admin/audit",
      new URLSearchParams({ actor: "a+b&c%d" }),
    );

    expect(path).toBe("/admin/audit?actor=a%2Bb%26c%25d");
    expect(new URL(path, "https://api.auth-dev.vortex.so").searchParams.get("actor")).toBe(
      "a+b&c%d",
    );
  });
});
