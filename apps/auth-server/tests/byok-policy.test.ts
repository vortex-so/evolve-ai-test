import { describe, expect, it } from "vitest";
import { parseOdooPolicy } from "../src/byok/validation";
import { NATIVE_ODOO_DEFAULT_POLICY } from "./_helpers/byok-native";

describe("Odoo native policy validation", () => {
  it("splits model.method at the last dot and accepts identifier segments", () => {
    expect(parseOdooPolicy({
      policyVersion: 2,
      enableWrites: true,
      allowedSideEffectMethods: [
        " sale.order.action_confirm ",
        "x_custom.model_2.run_job",
        "sale.order.action_confirm",
      ],
    })).toEqual({
      policyVersion: 2,
      enableWrites: true,
      allowedSideEffectMethods: ["sale.order.action_confirm", "x_custom.model_2.run_job"],
    });
  });

  it("returns a fresh native default only when explicitly allowed", () => {
    const first = parseOdooPolicy(undefined, { allowDefault: true });
    const second = parseOdooPolicy(undefined, { allowDefault: true });
    expect(first).toEqual(NATIVE_ODOO_DEFAULT_POLICY);
    expect(second).toEqual(NATIVE_ODOO_DEFAULT_POLICY);
    expect(first).not.toBe(second);
    expect(() => parseOdooPolicy(undefined)).toThrow();
  });

  it.each([
    "project.task",
    "project..task.write",
    ".project.task.write",
    "project.task.9write",
    "project.task.write-now",
    "project.task.*",
    "project.task.write()",
    "project task.write",
  ])("rejects non-exact Odoo model.method value %s", (method) => {
    expect(() => parseOdooPolicy({
      policyVersion: 2,
      enableWrites: true,
      allowedSideEffectMethods: [method],
    })).toThrow();
  });
});
