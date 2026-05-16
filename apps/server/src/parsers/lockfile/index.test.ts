import { describe, it, expect } from "vitest";
import { parserForFilename } from "./index";
import { parseRequirementsTxt } from "./requirements-txt";
import { parsePackageLockJson } from "./package-lock-json";
import { parseYarnLock } from "./yarn-lock";
import { parsePnpmLockYaml } from "./pnpm-lock-yaml";
import { parseCargoLock } from "./cargo-lock";
import { parseGemfileLock } from "./gemfile-lock";
import { parseGoSum } from "./go-sum";
import { parseComposerLock } from "./composer-lock";
import { parseMixLock } from "./mix-lock";
import { parsePubspecLock } from "./pubspec-lock";
import { parsePomXml } from "./pom-xml";
import { parseCsproj } from "./csproj";
import { parseBunLock } from "./bun-lock";

describe("parserForFilename", () => {
  it("dispatches by filename", () => {
    expect(parserForFilename("requirements.txt")).toBe(parseRequirementsTxt);
    expect(parserForFilename("/path/to/package-lock.json")).toBe(parsePackageLockJson);
    expect(parserForFilename("yarn.lock")).toBe(parseYarnLock);
    expect(parserForFilename("pnpm-lock.yaml")).toBe(parsePnpmLockYaml);
    expect(parserForFilename("Cargo.lock")).toBe(parseCargoLock);
    expect(parserForFilename("Gemfile.lock")).toBe(parseGemfileLock);
    expect(parserForFilename("go.sum")).toBe(parseGoSum);
    expect(parserForFilename("composer.lock")).toBe(parseComposerLock);
    expect(parserForFilename("mix.lock")).toBe(parseMixLock);
    expect(parserForFilename("pubspec.lock")).toBe(parsePubspecLock);
    expect(parserForFilename("pom.xml")).toBe(parsePomXml);
    expect(parserForFilename("MyApp.csproj")).toBe(parseCsproj);
    expect(parserForFilename("bun.lock")).toBe(parseBunLock);
    expect(parserForFilename("/repo/web/bun.lock")).toBe(parseBunLock);
  });

  it("returns null for unrecognized filenames", () => {
    expect(parserForFilename("foo.txt")).toBeNull();
    expect(parserForFilename("Dockerfile")).toBeNull();
  });
});

describe("parseRequirementsTxt", () => {
  it("extracts == pinned packages", () => {
    const got = parseRequirementsTxt(`
# A comment
django==4.0.7
requests==2.32.5
flask>=2.0  # range — skip
-r other.txt
git+https://github.com/foo/bar
django[bcrypt]==4.0.0
PyJWT==2.8.0; python_version >= "3.7"
    `);
    expect(got).toEqual([
      { ecosystem: "PyPI", name: "django", version: "4.0.7" },
      { ecosystem: "PyPI", name: "requests", version: "2.32.5" },
      { ecosystem: "PyPI", name: "django", version: "4.0.0" },
      { ecosystem: "PyPI", name: "PyJWT", version: "2.8.0" },
    ]);
  });
});

describe("parsePackageLockJson", () => {
  it("walks the v3 packages map and skips the root", () => {
    const got = parsePackageLockJson(JSON.stringify({
      name: "myapp",
      lockfileVersion: 3,
      packages: {
        "": { name: "myapp", version: "1.0.0" },
        "node_modules/lodash": { version: "4.17.20" },
        "node_modules/foo": { version: "1.0.0" },
        "node_modules/foo/node_modules/lodash": { version: "4.17.21" },
        "node_modules/@scope/pkg": { version: "0.5.0" },
      },
    }));
    expect(got).toEqual([
      { ecosystem: "npm", name: "lodash", version: "4.17.20" },
      { ecosystem: "npm", name: "foo", version: "1.0.0" },
      { ecosystem: "npm", name: "lodash", version: "4.17.21" },
      { ecosystem: "npm", name: "@scope/pkg", version: "0.5.0" },
    ]);
  });

  it("falls back to v1/v2 dependencies tree", () => {
    const got = parsePackageLockJson(JSON.stringify({
      name: "myapp",
      lockfileVersion: 1,
      dependencies: {
        lodash: { version: "4.17.20" },
        foo: {
          version: "1.0.0",
          dependencies: {
            lodash: { version: "4.17.21" },
          },
        },
      },
    }));
    expect(got).toContainEqual({ ecosystem: "npm", name: "lodash", version: "4.17.20" });
    expect(got).toContainEqual({ ecosystem: "npm", name: "lodash", version: "4.17.21" });
    expect(got).toContainEqual({ ecosystem: "npm", name: "foo", version: "1.0.0" });
  });

  it("returns [] on malformed JSON", () => {
    expect(parsePackageLockJson("{not json")).toEqual([]);
  });
});

describe("parseYarnLock (v1)", () => {
  it("extracts packages from a real yarn v1 lockfile shape", () => {
    const fixture = `# yarn lockfile v1


lodash@^4.17.0:
  version "4.17.21"
  resolved "https://registry.yarnpkg.com/lodash/-/lodash-4.17.21.tgz#xyz"
  integrity sha512-xyz

"@scope/pkg@^1.0.0":
  version "1.2.3"
  resolved "https://registry.yarnpkg.com/@scope/pkg/-/pkg-1.2.3.tgz#abc"
  integrity sha512-abc
`;
    const got = parseYarnLock(fixture);
    expect(got).toContainEqual({ ecosystem: "npm", name: "lodash", version: "4.17.21" });
    expect(got).toContainEqual({ ecosystem: "npm", name: "@scope/pkg", version: "1.2.3" });
  });
});

describe("parsePnpmLockYaml", () => {
  it("parses v9 'name@version' keys", () => {
    const fixture = `
lockfileVersion: '9.0'
packages:
  lodash@4.17.21:
    resolution: {integrity: sha512-xyz}
  '@scope/pkg@1.2.3':
    resolution: {integrity: sha512-abc}
  'foo@1.0.0(react@18.0.0)':
    resolution: {integrity: sha512-fff}
`;
    const got = parsePnpmLockYaml(fixture);
    expect(got).toContainEqual({ ecosystem: "npm", name: "lodash", version: "4.17.21" });
    expect(got).toContainEqual({ ecosystem: "npm", name: "@scope/pkg", version: "1.2.3" });
    expect(got).toContainEqual({ ecosystem: "npm", name: "foo", version: "1.0.0" });
  });

  it("parses old '/name/version' keys", () => {
    const fixture = `
lockfileVersion: '6.0'
packages:
  /lodash/4.17.21:
    resolution: {integrity: sha512-xyz}
  /@scope/pkg/1.2.3:
    resolution: {integrity: sha512-abc}
`;
    const got = parsePnpmLockYaml(fixture);
    expect(got).toContainEqual({ ecosystem: "npm", name: "lodash", version: "4.17.21" });
    expect(got).toContainEqual({ ecosystem: "npm", name: "@scope/pkg", version: "1.2.3" });
  });
});

describe("parseCargoLock", () => {
  it("extracts registry packages, skips non-registry sources", () => {
    const fixture = `
[[package]]
name = "tokio"
version = "1.32.0"
source = "registry+https://github.com/rust-lang/crates.io-index"

[[package]]
name = "myapp"
version = "0.1.0"

[[package]]
name = "git-dep"
version = "0.0.0"
source = "git+https://github.com/foo/bar?branch=main#abc"
`;
    const got = parseCargoLock(fixture);
    expect(got).toEqual([
      { ecosystem: "crates.io", name: "tokio", version: "1.32.0" },
      { ecosystem: "crates.io", name: "myapp", version: "0.1.0" },
    ]);
  });
});

describe("parseGemfileLock", () => {
  it("extracts top-level GEM specs only", () => {
    const fixture = `GEM
  remote: https://rubygems.org/
  specs:
    activerecord (6.0.3)
      activesupport (= 6.0.3)
    activesupport (6.0.3)
      i18n
    nokogiri (1.13.8)

PLATFORMS
  ruby

DEPENDENCIES
  activerecord
`;
    const got = parseGemfileLock(fixture);
    expect(got).toEqual([
      { ecosystem: "RubyGems", name: "activerecord", version: "6.0.3" },
      { ecosystem: "RubyGems", name: "activesupport", version: "6.0.3" },
      { ecosystem: "RubyGems", name: "nokogiri", version: "1.13.8" },
    ]);
  });
});

describe("parseGoSum", () => {
  it("extracts module-version pairs and dedupes /go.mod entries", () => {
    const fixture = `github.com/foo/bar v1.2.3 h1:abc
github.com/foo/bar v1.2.3/go.mod h1:def
github.com/baz/qux v0.0.0-20220101000000-abc123 h1:ghi
`;
    const got = parseGoSum(fixture);
    expect(got).toEqual([
      { ecosystem: "Go", name: "github.com/foo/bar", version: "v1.2.3" },
      { ecosystem: "Go", name: "github.com/baz/qux", version: "v0.0.0-20220101000000-abc123" },
    ]);
  });
});

describe("parseComposerLock", () => {
  it("extracts both packages and packages-dev, skips dev-* refs, strips leading v", () => {
    const fixture = JSON.stringify({
      packages: [
        { name: "symfony/console", version: "v6.4.0" },
        { name: "psr/log", version: "3.0.0" },
        { name: "foo/bar", version: "dev-master" },
      ],
      "packages-dev": [
        { name: "phpunit/phpunit", version: "10.5.0" },
      ],
    });
    const got = parseComposerLock(fixture);
    expect(got).toEqual([
      { ecosystem: "Packagist", name: "symfony/console", version: "6.4.0" },
      { ecosystem: "Packagist", name: "psr/log", version: "3.0.0" },
      { ecosystem: "Packagist", name: "phpunit/phpunit", version: "10.5.0" },
    ]);
  });
});

describe("parseMixLock", () => {
  it("extracts :hex source entries only", () => {
    const fixture = `%{
  "phoenix": {:hex, :phoenix, "1.7.0", "abc", [:mix], [...], "hexpm", "def"},
  "ecto": {:hex, :ecto, "3.10.0", "ghi", [:mix], [], "hexpm", "jkl"},
  "my_local": {:path, "../my_local", []}
}
`;
    const got = parseMixLock(fixture);
    expect(got).toEqual([
      { ecosystem: "Hex", name: "phoenix", version: "1.7.0" },
      { ecosystem: "Hex", name: "ecto", version: "3.10.0" },
    ]);
  });
});

describe("parsePubspecLock", () => {
  it("extracts hosted source entries only", () => {
    const fixture = `packages:
  http:
    dependency: "direct main"
    description:
      name: http
      url: "https://pub.dev"
    source: hosted
    version: "1.1.0"
  my_local:
    dependency: "direct main"
    description:
      path: "../my_local"
    source: path
    version: "0.0.1"
`;
    const got = parsePubspecLock(fixture);
    expect(got).toEqual([
      { ecosystem: "Pub", name: "http", version: "1.1.0" },
    ]);
  });
});

describe("parsePomXml", () => {
  it("extracts dependencies with explicit versions, skips ${...} property refs", () => {
    const fixture = `<?xml version="1.0"?>
<project>
  <dependencies>
    <dependency>
      <groupId>org.apache.logging.log4j</groupId>
      <artifactId>log4j-core</artifactId>
      <version>2.14.0</version>
    </dependency>
    <dependency>
      <groupId>com.example</groupId>
      <artifactId>unresolved</artifactId>
      <version>\${some.version}</version>
    </dependency>
  </dependencies>
  <dependencyManagement>
    <dependencies>
      <dependency>
        <groupId>org.junit</groupId>
        <artifactId>junit</artifactId>
        <version>5.10.0</version>
      </dependency>
    </dependencies>
  </dependencyManagement>
</project>`;
    const got = parsePomXml(fixture);
    expect(got).toContainEqual({
      ecosystem: "Maven",
      name: "org.apache.logging.log4j:log4j-core",
      version: "2.14.0",
    });
    expect(got).toContainEqual({
      ecosystem: "Maven",
      name: "org.junit:junit",
      version: "5.10.0",
    });
    expect(got.find((d) => d.name === "com.example:unresolved")).toBeUndefined();
  });
});

describe("parseCsproj", () => {
  it("extracts PackageReference entries", () => {
    const fixture = `<?xml version="1.0" encoding="utf-8"?>
<Project Sdk="Microsoft.NET.Sdk">
  <ItemGroup>
    <PackageReference Include="Newtonsoft.Json" Version="13.0.3" />
    <PackageReference Include="Serilog" Version="3.1.1" />
  </ItemGroup>
</Project>`;
    const got = parseCsproj(fixture);
    expect(got).toContainEqual({ ecosystem: "NuGet", name: "Newtonsoft.Json", version: "13.0.3" });
    expect(got).toContainEqual({ ecosystem: "NuGet", name: "Serilog", version: "3.1.1" });
  });
});
