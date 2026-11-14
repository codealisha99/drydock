import { useMemo } from "react";

interface FileDiff {
  path: string;
  added: number;
  removed: number;
  lines: string[];
}

/** Splits a unified diff into per-file sections with +/- counts. Pure. */
export function parseDiff(diff: string): FileDiff[] {
  const files: FileDiff[] = [];
  let current: FileDiff | null = null;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
      current = { path: match?.[2] ?? line, added: 0, removed: 0, lines: [] };
      files.push(current);
      continue;
    }
    if (!current) continue;
    if (line.startsWith("+") && !line.startsWith("+++")) current.added += 1;
    if (line.startsWith("-") && !line.startsWith("---")) current.removed += 1;
    current.lines.push(line);
  }
  return files;
}

function lineClass(line: string): string {
  if (line.startsWith("@@")) return "diff-line hunk";
  if (line.startsWith("+") && !line.startsWith("+++")) return "diff-line add";
  if (line.startsWith("-") && !line.startsWith("---")) return "diff-line del";
  return "diff-line";
}

export function DiffView({ diff }: { diff: string | null }) {
  const files = useMemo(() => (diff ? parseDiff(diff) : []), [diff]);
  if (!diff) return <p className="muted">No changes yet. The diff appears once the agent edits a file.</p>;
  const totals = files.reduce((acc, f) => ({ added: acc.added + f.added, removed: acc.removed + f.removed }), { added: 0, removed: 0 });
  return (
    <div className="diff">
      <p className="diff-totals">
        {files.length} {files.length === 1 ? "file" : "files"} <span className="add">+{totals.added}</span>{" "}
        <span className="del">−{totals.removed}</span>
      </p>
      {files.map((file) => (
        <details key={file.path} className="diff-file" open>
          <summary>
            <span className="diff-path">{file.path}</span>
            <span className="add">+{file.added}</span> <span className="del">−{file.removed}</span>
          </summary>
          <pre>
            {file.lines.map((line, i) => (
              <div key={i} className={lineClass(line)}>
                {line || " "}
              </div>
            ))}
          </pre>
        </details>
      ))}
    </div>
  );
}
