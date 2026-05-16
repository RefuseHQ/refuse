import { describe, it, expect } from "vitest";
import { parseDockerfile } from "./parse";

describe("parseDockerfile", () => {
  it("tokenizes plain instructions and assigns line numbers", () => {
    const got = parseDockerfile(`FROM python:3.11-slim
WORKDIR /app
COPY . .
RUN pip install -r requirements.txt
CMD ["python","app.py"]
`);
    expect(got.map((i) => [i.name, i.startLine])).toEqual([
      ["FROM", 1],
      ["WORKDIR", 2],
      ["COPY", 3],
      ["RUN", 4],
      ["CMD", 5],
    ]);
  });

  it("joins line continuations into a single instruction", () => {
    const got = parseDockerfile(`RUN apt-get update && \\
    apt-get install -y \\
    curl=7.81.0 \\
    git=1:2.34.1
`);
    expect(got).toHaveLength(1);
    expect(got[0]?.name).toBe("RUN");
    expect(got[0]?.args).toContain("curl=7.81.0");
    expect(got[0]?.args).toContain("git=1:2.34.1");
  });

  it("skips full-line comments", () => {
    const got = parseDockerfile(`# this is a comment
FROM alpine:3.19
# another comment
RUN apk add openssl=3.1.4-r1
`);
    expect(got.map((i) => i.name)).toEqual(["FROM", "RUN"]);
  });

  it("tracks stage index across multi-stage builds", () => {
    const got = parseDockerfile(`FROM golang:1.21 AS build
RUN go build
FROM alpine:3.19
COPY --from=build /app /app
RUN apk add curl=8.4.0-r0
`);
    const fromStages = got.filter((i) => i.name === "FROM").map((i) => i.stage);
    expect(fromStages).toEqual([0, 1]);
    const runs = got.filter((i) => i.name === "RUN");
    expect(runs).toHaveLength(2);
    expect(runs[0]?.stage).toBe(0);
    expect(runs[1]?.stage).toBe(1);
  });

  it("captures heredoc bodies into args", () => {
    const got = parseDockerfile(`RUN <<EOF
apt-get update
apt-get install -y curl=7.81.0
EOF
`);
    expect(got).toHaveLength(1);
    expect(got[0]?.args).toContain("apt-get install -y curl=7.81.0");
  });

  it("handles platform flags and stage aliases on FROM", () => {
    const got = parseDockerfile(`FROM --platform=linux/amd64 python:3.11-bookworm AS deps
RUN pip install requests==2.32.5
`);
    expect(got[0]?.name).toBe("FROM");
    expect(got[0]?.args).toContain("python:3.11-bookworm");
  });
});
