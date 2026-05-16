import { describe, it, expect } from "vitest";
import { parseWorkflow } from "./parse";

describe("parseWorkflow", () => {
  it("extracts every uses: line with line numbers", () => {
    const yaml = `name: CI
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v3
        with:
          node-version: 20
      - uses: pnpm/action-setup@v2
        with:
          version: 8
`;
    const got = parseWorkflow(yaml);
    expect(got.map((u) => u.raw)).toEqual([
      "actions/checkout@v4",
      "actions/setup-node@v3",
      "pnpm/action-setup@v2",
    ]);
    expect(got[0]?.name).toBe("actions/checkout");
    expect(got[0]?.ref).toBe("v4");
    expect(got[0]?.line).toBe(7);
  });

  it("captures reusable workflow uses", () => {
    const yaml = `jobs:
  call:
    uses: octo/wf/.github/workflows/build.yml@v1
`;
    const got = parseWorkflow(yaml);
    expect(got).toHaveLength(1);
    expect(got[0]?.name).toBe("octo/wf/.github/workflows/build.yml");
    expect(got[0]?.ref).toBe("v1");
  });

  it("treats refless uses as ref=null", () => {
    const yaml = `jobs:
  build:
    steps:
      - uses: actions/checkout
`;
    const got = parseWorkflow(yaml);
    expect(got[0]?.name).toBe("actions/checkout");
    expect(got[0]?.ref).toBeNull();
  });

  it("skips local actions and docker:// refs", () => {
    const yaml = `jobs:
  build:
    steps:
      - uses: ./.github/actions/local
      - uses: docker://alpine:3.19
      - uses: actions/checkout@v4
`;
    const got = parseWorkflow(yaml);
    const names = got.map((u) => u.name);
    expect(names.filter((n) => n !== null)).toEqual(["actions/checkout"]);
  });

  it("returns [] on malformed YAML", () => {
    expect(parseWorkflow("not: valid: yaml: : :")).toEqual([]);
  });
});
