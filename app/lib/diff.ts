export interface DiffLine {
  index: number;
  text: string;
  kind: "add" | "delete" | "context" | "meta";
  old: number | null;
  next: number | null;
}
export interface Hunk {
  header: string;
  start: number;
  lines: DiffLine[];
}

export interface SplitRow {
  left?: DiffLine;
  right?: DiffLine;
}

export function splitDiffLines(lines: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let left: DiffLine[] = [], right: DiffLine[] = [];
  let leftMeta: DiffLine[] = [], rightMeta: DiffLine[] = [];
  let previous: DiffLine["kind"] = "context";
  const flush = () => {
    for (let i = 0; i < Math.max(left.length, right.length); i++)
      rows.push({ left: left[i], right: right[i] });
    for (let i = 0; i < Math.max(leftMeta.length, rightMeta.length); i++)
      rows.push({ left: leftMeta[i], right: rightMeta[i] });
    left = []; right = []; leftMeta = []; rightMeta = [];
  };
  for (const line of lines) {
    if (line.kind === "delete") left.push(line);
    else if (line.kind === "add") right.push(line);
    else if (line.kind === "meta" && previous === "delete") leftMeta.push(line);
    else if (line.kind === "meta" && previous === "add") rightMeta.push(line);
    else {
      flush();
      rows.push({ left: line, right: line });
    }
    if (line.kind !== "meta") previous = line.kind;
  }
  flush();
  return rows;
}

export function parseDiffFiles(text: string) {
  let offset = 0;
  return text.split(/(?=^diff --git )/m).map((part) => {
    const file = parseDiff(part);
    for (const hunk of file.hunks) {
      hunk.start += offset;
      for (const line of hunk.lines) line.index += offset;
    }
    offset += part.split("\n").length - 1;
    return file;
  });
}
export function parseDiff(text: string): { header: string; hunks: Hunk[] } {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const header: string[] = [];
  const hunks: Hunk[] = [];
  let hunk: Hunk | undefined;
  let old = 0;
  let next = 0;
  lines.forEach((text, index) => {
    const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if (match) {
      old = Number(match[1]);
      next = Number(match[2]);
      hunk = { header: text, start: index, lines: [] };
      hunks.push(hunk);
      return;
    }
    if (!hunk) {
      header.push(text);
      return;
    }
    const kind = text.startsWith("+")
      ? "add"
      : text.startsWith("-")
        ? "delete"
        : text.startsWith(" ")
          ? "context"
          : "meta";
    hunk.lines.push({
      index,
      text,
      kind,
      old: kind === "add" || kind === "meta" ? null : old++,
      next: kind === "delete" || kind === "meta" ? null : next++,
    });
  });
  return { header: header.join("\n"), hunks };
}

// A partial staged diff is built in reverse: unselected additions remain in the index.
export function selectedPatch(
  text: string,
  selected: Set<number>,
  reverse = false,
): string {
  const parsed = parseDiff(text);
  if (/^(rename |copy |Binary files|GIT binary patch)/m.test(text))
    throw new Error("Stage this file as a whole.");
  const partial = !parsed.hunks.every((h) =>
    h.lines
      .filter((l) => l.kind === "add" || l.kind === "delete")
      .every((l) => selected.has(l.index)),
  );
  let header = parsed.header;
  if (partial && !reverse && /^deleted file mode/m.test(header)) {
    const source = header.split("\n").find((line) => line.startsWith("--- "))!;
    const destination = source.replace(/^--- ("?)a\//, "+++ $1b/");
    header = header
      .replace(/^deleted file mode.*\n/m, "")
      .replace("+++ /dev/null", destination);
  }
  if (partial && reverse && /^new file mode/m.test(header)) {
    const destination = header
      .split("\n")
      .find((line) => line.startsWith("+++ "))!;
    const source = destination.replace(/^\+\+\+ ("?)b\//, "--- $1a/");
    header = header
      .replace(/^new file mode.*\n/m, "")
      .replace("--- /dev/null", source);
  }
  const result = [header];
  let offset = 0;
  for (const hunk of parsed.hunks) {
    const parts = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(
      hunk.header,
    )!;
    const included = hunk.lines.some(
      (l) => selected.has(l.index) && (l.kind === "add" || l.kind === "delete"),
    );
    if (!included) continue;
    const lines: string[] = [];
    let oldCount = 0;
    let newCount = 0;
    let previousIncluded = false;
    for (const line of hunk.lines) {
      let output: string | null = line.text;
      if (line.kind === "add" && !selected.has(line.index))
        output = reverse ? " " + line.text.slice(1) : null;
      if (line.kind === "delete" && !selected.has(line.index))
        output = reverse ? null : " " + line.text.slice(1);
      if (line.kind === "meta") {
        if (previousIncluded) lines.push(line.text);
        continue;
      }
      previousIncluded = output !== null;
      if (output === null) continue;
      lines.push(output);
      if (!output.startsWith("+")) oldCount++;
      if (!output.startsWith("-")) newCount++;
    }
    const anchor = Number(parts[reverse ? 3 : 1]);
    let oldStart = reverse ? anchor - offset : anchor;
    let newStart = reverse ? anchor : anchor + offset;
    if (oldCount > 0 && oldStart === 0) oldStart = 1;
    if (newCount > 0 && newStart === 0) newStart = 1;
    if (oldCount === 0 && newCount > 0) newStart = oldStart + 1;
    if (newCount === 0 && oldCount > 0) newStart = Math.max(0, oldStart - 1);
    result.push(
      `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`,
      ...lines,
    );
    offset += newCount - oldCount;
  }
  if (result.length === 1) throw new Error("Select at least one changed line.");
  return result.join("\n") + "\n";
}
