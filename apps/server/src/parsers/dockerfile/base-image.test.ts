import { describe, it, expect } from "vitest";
import { resolveBaseImage } from "./base-image";

describe("resolveBaseImage", () => {
  it("maps Debian-codename suffixed tags", () => {
    expect(resolveBaseImage("python:3.11-bookworm").ecosystem).toBe("Debian:12");
    expect(resolveBaseImage("python:3.11-bullseye").ecosystem).toBe("Debian:11");
    expect(resolveBaseImage("ruby:3.2-buster-slim").ecosystem).toBe("Debian:10");
  });

  it("maps Ubuntu by tag or codename", () => {
    expect(resolveBaseImage("ubuntu:22.04").ecosystem).toBe("Ubuntu:22.04");
    expect(resolveBaseImage("ubuntu:jammy").ecosystem).toBe("Ubuntu:22.04");
    expect(resolveBaseImage("ubuntu:noble").ecosystem).toBe("Ubuntu:24.04");
  });

  it("normalizes Alpine versions to v3.X", () => {
    expect(resolveBaseImage("alpine:3.19").ecosystem).toBe("Alpine:v3.19");
    expect(resolveBaseImage("alpine:3.19.1").ecosystem).toBe("Alpine:v3.19");
    expect(resolveBaseImage("python:3.11-alpine3.19").ecosystem).toBe("Alpine:v3.19");
  });

  it("falls back to current Debian for derived bases without an explicit codename", () => {
    expect(resolveBaseImage("python:3.11-slim").ecosystem).toBe("Debian:12");
    expect(resolveBaseImage("node:20").ecosystem).toBe("Debian:12");
    expect(resolveBaseImage("golang:1.21").ecosystem).toBe("Debian:12");
  });

  it("maps Rocky / AlmaLinux", () => {
    expect(resolveBaseImage("rockylinux:9").ecosystem).toBe("Rocky Linux:9");
    expect(resolveBaseImage("almalinux:9.2").ecosystem).toBe("AlmaLinux:9");
  });

  it("returns null for unknown bases", () => {
    expect(resolveBaseImage("scratch").ecosystem).toBeNull();
    expect(resolveBaseImage("gcr.io/distroless/base-debian11").ecosystem).toBeNull();
  });

  it("strips --platform flags and AS aliases", () => {
    const r = resolveBaseImage("--platform=linux/amd64 python:3.11-bookworm AS build");
    expect(r.rawImage).toBe("python:3.11-bookworm");
    expect(r.ecosystem).toBe("Debian:12");
  });
});
