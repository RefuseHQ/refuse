/**
 * Dockerfile tokenizer. Returns a flat list of instructions with line numbers,
 * argument strings, and (for `RUN`) the joined command body. Handles:
 *
 * - Line continuations with trailing `\`
 * - `#` comments (full-line and trailing — but NOT inside strings/heredocs)
 * - Heredoc bodies in `RUN <<EOF ... EOF` (preserved as-is into args)
 * - Multi-stage builds (every FROM starts a new stage; we tag each instruction
 *   with its stage index)
 *
 * What we do NOT do (and don't need to for vulnerability scanning):
 * - Resolve `ARG`/`ENV` substitutions
 * - Honor BuildKit-specific syntax beyond plain heredocs
 * - Validate instruction grammar
 */

export interface Instruction {
  name: string;        // "FROM" | "RUN" | "COPY" | ...
  args: string;        // joined argument string (line continuations resolved)
  startLine: number;   // 1-based, points at the opening line of the instruction
  stage: number;       // 0 for the first stage
}

const INSTR_RE = /^([A-Za-z][A-Za-z0-9]*)\s+(.*)$/;
const HEREDOC_RE = /<<-?\s*['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?/;

export function parseDockerfile(content: string): Instruction[] {
  const out: Instruction[] = [];
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  let stage = 0;
  let i = 0;

  while (i < lines.length) {
    let line = lines[i] ?? "";
    const startLine = i + 1;

    // Skip blank and comment-only lines (must come before continuation
    // handling so a comment alone doesn't get joined into an instruction).
    const stripped = line.trim();
    if (stripped === "" || stripped.startsWith("#")) {
      i++;
      continue;
    }

    // Walk continuations. A `\` at end-of-line (after stripping inline comment)
    // means "join next line."
    let joined = line;
    let lineCursor = i;
    while (joined.replace(/\s+$/, "").endsWith("\\")) {
      joined = joined.replace(/\\\s*$/, "");
      lineCursor++;
      const next = lines[lineCursor];
      if (next === undefined) break;
      joined += "\n" + next;
    }
    i = lineCursor + 1;

    // Strip a trailing inline comment from each individual line (Dockerfile
    // doesn't allow inline comments mid-instruction in classical syntax —
    // BuildKit is more permissive — but we follow the lenient rule of
    // stripping anything after `#` if it's a full-line comment within a
    // continued instruction).
    joined = joined
      .split("\n")
      .map((l) => (l.trim().startsWith("#") ? "" : l))
      .filter((l) => l !== "")
      .join(" ");

    const m = INSTR_RE.exec(joined.trim());
    if (!m) continue;

    const name = m[1]!.toUpperCase();
    let args = m[2]!.trim();

    // Heredoc bodies — extend through the EOF marker line.
    const heredoc = HEREDOC_RE.exec(args);
    if (heredoc) {
      const marker = heredoc[1]!;
      const bodyLines: string[] = [];
      while (i < lines.length) {
        const bodyLine = lines[i] ?? "";
        i++;
        if (bodyLine.trim() === marker) break;
        bodyLines.push(bodyLine);
      }
      args = `${args}\n${bodyLines.join("\n")}`;
    }

    if (name === "FROM" && out.length > 0) stage++;
    out.push({ name, args, startLine, stage });
  }

  return out;
}
