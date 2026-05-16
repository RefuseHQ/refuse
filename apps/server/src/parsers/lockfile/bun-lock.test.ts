import { describe, it, expect } from "vitest";
import { parseBunLock } from "./bun-lock";

const SAMPLE = `{
  "lockfileVersion": 1,
  "workspaces": {
    "": {
      "name": "demo-app",
      "dependencies": {
        "react": "^18.2.0",
      },
    },
  },
  "packages": {
    "@alloc/quick-lru": ["@alloc/quick-lru@5.2.0", "", {}, "sha512-..."],
    "react":            ["react@18.2.0", "", { "deps": {} }, "sha512-..."],
    "@scope/inner":     ["@scope/inner@1.2.3-rc.1", "", {}, "sha512-..."],
    "git-only":         ["git-only", "git+https://example/repo.git", {}, ""],
  }
}`;

describe("parseBunLock", () => {
  it("extracts (name, version) for scoped + unscoped packages", () => {
    const got = parseBunLock(SAMPLE);
    expect(got).toEqual([
      { ecosystem: "npm", name: "@alloc/quick-lru", version: "5.2.0" },
      { ecosystem: "npm", name: "react", version: "18.2.0" },
      { ecosystem: "npm", name: "@scope/inner", version: "1.2.3-rc.1" },
    ]);
  });

  it("returns [] on garbage", () => {
    expect(parseBunLock("not json")).toEqual([]);
    expect(parseBunLock("{")).toEqual([]);
  });

  it("returns [] when packages key is missing", () => {
    expect(parseBunLock(`{ "lockfileVersion": 1 }`)).toEqual([]);
  });

  it("tolerates trailing commas (Bun's writer emits them)", () => {
    const withTrailing = `{
      "packages": {
        "react": ["react@19.0.0", "", {}, ""],
      },
    }`;
    expect(parseBunLock(withTrailing)).toEqual([
      { ecosystem: "npm", name: "react", version: "19.0.0" },
    ]);
  });
});
