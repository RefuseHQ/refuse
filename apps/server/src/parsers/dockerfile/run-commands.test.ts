import { describe, it, expect } from "vitest";
import { parseRun } from "./run-commands";

describe("parseRun (apt-get install)", () => {
  it("extracts pinned packages, warns on unpinned", () => {
    const got = parseRun(
      "apt-get update && apt-get install -y curl=7.81.0-1 git=1:2.34.1-1ubuntu1.10 vim",
      "Debian:12",
      "debian",
    );
    expect(got.packages).toEqual([
      { ecosystem: "Debian:12", name: "curl", version: "7.81.0-1" },
      { ecosystem: "Debian:12", name: "git", version: "1:2.34.1-1ubuntu1.10" },
    ]);
    expect(got.warnings.find((w) => w.message.includes("vim"))).toBeDefined();
  });

  it("strips long flags like --no-install-recommends", () => {
    const got = parseRun(
      "apt-get install -y --no-install-recommends openssl=3.0.13-1~deb12u1",
      "Debian:12",
      "debian",
    );
    expect(got.packages).toEqual([
      { ecosystem: "Debian:12", name: "openssl", version: "3.0.13-1~deb12u1" },
    ]);
  });
});

describe("parseRun (apk add)", () => {
  it("extracts pinned Alpine packages", () => {
    const got = parseRun(
      "apk add --no-cache openssl=3.1.4-r1 curl=8.4.0-r0",
      "Alpine:v3.19",
      "alpine",
    );
    expect(got.packages).toEqual([
      { ecosystem: "Alpine:v3.19", name: "openssl", version: "3.1.4-r1" },
      { ecosystem: "Alpine:v3.19", name: "curl", version: "8.4.0-r0" },
    ]);
  });
});

describe("parseRun (pip install)", () => {
  it("extracts == pinned PyPI packages, warns on unpinned", () => {
    const got = parseRun(
      "pip install requests==2.32.5 django==4.2.7 numpy",
      null,
      null,
    );
    expect(got.packages).toEqual([
      { ecosystem: "PyPI", name: "requests", version: "2.32.5" },
      { ecosystem: "PyPI", name: "django", version: "4.2.7" },
    ]);
    expect(got.warnings.find((w) => w.message.includes("numpy"))).toBeDefined();
  });
});

describe("parseRun (npm install)", () => {
  it("extracts pinned npm packages including scoped", () => {
    const got = parseRun(
      "npm install -g lodash@4.17.21 @scope/pkg@1.2.3",
      null,
      null,
    );
    expect(got.packages).toEqual([
      { ecosystem: "npm", name: "lodash", version: "4.17.21" },
      { ecosystem: "npm", name: "@scope/pkg", version: "1.2.3" },
    ]);
  });

  it("warns on unpinned npm packages", () => {
    const got = parseRun("npm install -g typescript", null, null);
    expect(got.packages).toEqual([]);
    expect(got.warnings).toHaveLength(1);
    expect(got.warnings[0]?.message).toContain("typescript");
  });
});

describe("parseRun (gem install)", () => {
  it("extracts gem with -v flag and colon syntax", () => {
    const got1 = parseRun("gem install rails -v 7.1.0", null, null);
    expect(got1.packages).toEqual([
      { ecosystem: "RubyGems", name: "rails", version: "7.1.0" },
    ]);
    const got2 = parseRun("gem install rails:7.1.0", null, null);
    expect(got2.packages).toEqual([
      { ecosystem: "RubyGems", name: "rails", version: "7.1.0" },
    ]);
  });
});

describe("parseRun warnings", () => {
  it("flags `curl ... | sh` patterns", () => {
    const got = parseRun("curl -fsSL https://get.example.com | sh", null, null);
    expect(got.warnings.find((w) => w.type === "curl_pipe_sh")).toBeDefined();
  });

  it("flags `wget ... | bash` patterns", () => {
    const got = parseRun("wget -O - https://example.com/install.sh | bash", null, null);
    expect(got.warnings.find((w) => w.type === "curl_pipe_sh")).toBeDefined();
  });
});
