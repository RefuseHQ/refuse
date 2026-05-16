import { describe, expect, it } from "vitest";
import { classifyLicense } from "./license";

describe("classifyLicense", () => {
  it("returns unknown for null/empty input", () => {
    expect(classifyLicense(null)).toEqual({ spdx: null, category: "unknown" });
    expect(classifyLicense(undefined)).toEqual({ spdx: null, category: "unknown" });
    expect(classifyLicense([])).toEqual({ spdx: null, category: "unknown" });
    expect(classifyLicense([""])).toEqual({ spdx: null, category: "unknown" });
  });

  it("classifies common permissive licenses", () => {
    for (const id of ["MIT", "Apache-2.0", "BSD-3-Clause", "ISC", "0BSD"]) {
      expect(classifyLicense([id]).category).toBe("permissive");
    }
  });

  it("classifies copyleft licenses", () => {
    expect(classifyLicense(["LGPL-2.1"]).category).toBe("weak_copyleft");
    expect(classifyLicense(["MPL-2.0"]).category).toBe("weak_copyleft");
    expect(classifyLicense(["GPL-3.0"]).category).toBe("strong_copyleft");
    expect(classifyLicense(["AGPL-3.0"]).category).toBe("strong_copyleft");
    expect(classifyLicense(["GPL-3.0-or-later"]).category).toBe("strong_copyleft");
  });

  it("classifies source-available-restricted licenses", () => {
    for (const id of ["SSPL-1.0", "BUSL-1.1", "Elastic-2.0", "FSL-1.1"]) {
      expect(classifyLicense([id]).category).toBe("source_available_restricted");
    }
  });

  it("classifies public-domain dedications", () => {
    expect(classifyLicense(["CC0-1.0"]).category).toBe("public_domain");
    expect(classifyLicense(["Unlicense"]).category).toBe("public_domain");
  });

  it("treats UNLICENSED, NOASSERTION, and SEE LICENSE IN FILE as unknown", () => {
    expect(classifyLicense(["UNLICENSED"]).category).toBe("unknown");
    expect(classifyLicense(["NOASSERTION"]).category).toBe("unknown");
    expect(classifyLicense(["SEE LICENSE IN file"]).category).toBe("unknown");
    expect(classifyLicense(["LicenseRef-MyCustomThing"]).category).toBe("unknown");
  });

  it("evaluates 'A OR B' as least-restrictive (consumer can pick)", () => {
    // MIT OR GPL-3.0 → consumer picks MIT → permissive
    expect(classifyLicense(["MIT OR GPL-3.0"]).category).toBe("permissive");
    expect(classifyLicense(["GPL-3.0 OR MIT"]).category).toBe("permissive");
    expect(classifyLicense(["AGPL-3.0 OR Apache-2.0"]).category).toBe("permissive");
  });

  it("evaluates 'A AND B' as most-restrictive (consumer bound by both)", () => {
    expect(classifyLicense(["MIT AND GPL-3.0"]).category).toBe("strong_copyleft");
    expect(classifyLicense(["MIT AND BSD-3-Clause"]).category).toBe("permissive");
    expect(classifyLicense(["Apache-2.0 AND SSPL-1.0"]).category).toBe(
      "source_available_restricted",
    );
  });

  it("handles parenthesized expressions", () => {
    // (MIT OR Apache-2.0) AND BSD-3-Clause → permissive
    expect(classifyLicense(["(MIT OR Apache-2.0) AND BSD-3-Clause"]).category).toBe(
      "permissive",
    );
    // (GPL-3.0 OR MIT) AND AGPL-3.0 → strong_copyleft (AGPL dominates the AND)
    expect(classifyLicense(["(GPL-3.0 OR MIT) AND AGPL-3.0"]).category).toBe(
      "strong_copyleft",
    );
  });

  it("treats multi-element arrays as AND", () => {
    expect(classifyLicense(["MIT", "Apache-2.0"]).category).toBe("permissive");
    expect(classifyLicense(["MIT", "GPL-3.0"]).category).toBe("strong_copyleft");
  });

  it("preserves the SPDX expression for storage", () => {
    expect(classifyLicense(["MIT"]).spdx).toBe("MIT");
    expect(classifyLicense(["MIT OR Apache-2.0"]).spdx).toBe("MIT OR Apache-2.0");
    expect(classifyLicense(["MIT", "Apache-2.0"]).spdx).toBe("MIT AND Apache-2.0");
  });

  it("handles 'or-later' suffix forms (LGPL-2.1+)", () => {
    expect(classifyLicense(["LGPL-2.1+"]).category).toBe("weak_copyleft");
    expect(classifyLicense(["GPL-2.0+"]).category).toBe("strong_copyleft");
  });

  it("falls back to unknown for unrecognized SPDX ids", () => {
    expect(classifyLicense(["WeirdMadeUpLicense-1.2"]).category).toBe("unknown");
    expect(classifyLicense(["proprietary"]).category).toBe("unknown");
  });
});
