import { useMemo } from "react";
import { tokenizeCode, type Token } from "./code-highlight";

export type DiffRowKind = "hunk" | "context" | "add" | "del";

export interface DiffRow {
  kind: DiffRowKind;
  /** The line without its +, - or space marker. Hunk rows keep the whole @@ header. */
  text: string;
  oldNo: number | null;
  newNo: number | null;
}

export interface FileDiff {
  path: string;
  added: number;
  removed: number;
  rows: DiffRow[];
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
const FILE_HEADER = /^(diff --git a\/(.+) b\/(.+)|index |new file|deleted file|similarity|rename |old mode|new mode|--- |\+\+\+ )/;

/**
 * Splits a unified diff into per-file sections with line numbers for each row. File headers are
 * skipped and only treated as headers before a file's first hunk, so a changed line that starts
 * with "--" or "++" is still a change. Pure.
 */
export function parseDiff(diff: string): FileDiff[] {
  const files: FileDiff[] = [];
  let current: FileDiff | null = null;
  let inHunk = false;
  let oldNo = 0;
  let newNo = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
      current = { path: match?.[2] ?? line, added: 0, removed: 0, rows: [] };
      files.push(current);
      inHunk = false;
      continue;
    }
    if (!current) continue;
    const hunk = HUNK.exec(line);
    if (hunk) {
      inHunk = true;
      oldNo = Number(hunk[1]);
      newNo = Number(hunk[2]);
      current.rows.push({ kind: "hunk", text: line, oldNo: null, newNo: null });
      continue;
    }
    if (!inHunk) {
      if (!FILE_HEADER.test(line) && line !== "") current.rows.push({ kind: "context", text: line, oldNo: null, newNo: null });
      continue;
    }
    if (line.startsWith("+")) {
      current.added += 1;
      current.rows.push({ kind: "add", text: line.slice(1), oldNo: null, newNo: newNo++ });
    } else if (line.startsWith("-")) {
      current.removed += 1;
      current.rows.push({ kind: "del", text: line.slice(1), oldNo: oldNo++, newNo: null });
    } else if (line.startsWith(" ")) {
      current.rows.push({ kind: "context", text: line.slice(1), oldNo: oldNo++, newNo: newNo++ });
    }
  }
  return files;
}

const SIGN: Record<DiffRowKind, string> = { hunk: "", context: " ", add: "+", del: "−" };

function Code({ tokens }: { tokens: Token[] }) {
  return (
    <>
      {tokens.map((t, i) => (t.kind === "plain" ? <span key={i}>{t.text}</span> : <span key={i} className={`tok tok-${t.kind}`}>{t.text}</span>))}
    </>
  );
}

function FileSection({ file }: { file: FileDiff }) {
  return (
    <details className="diff-file" open>
      <summary>
        <span className="diff-path">{file.path}</span>
        <span className="diff-counts">
          <span className="add">+{file.added}</span>
          <span className="del">−{file.removed}</span>
        </span>
      </summary>
      <div className="diff-scroll" tabIndex={0} aria-label={`Changes in ${file.path}`}>
        <table className="diff-table">
          <tbody>
            {file.rows.map((row, i) =>
              row.kind === "hunk" ? (
                <tr key={i} className="diff-row hunk">
                  <td className="gutter" colSpan={2} />
                  <td className="sign" />
                  <td className="code">{row.text}</td>
                </tr>
              ) : (
                <tr key={i} className={`diff-row ${row.kind}`}>
                  <td className="gutter">{row.oldNo ?? ""}</td>
                  <td className="gutter">{row.newNo ?? ""}</td>
                  <td className="sign" aria-label={row.kind === "add" ? "added" : row.kind === "del" ? "removed" : undefined}>{SIGN[row.kind]}</td>
                  <td className="code"><Code tokens={tokenizeCode(row.text)} /></td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </details>
  );
}

export function DiffView({ diff }: { diff: string | null }) {
  const files = useMemo(() => (diff ? parseDiff(diff) : []), [diff]);
  if (!diff) return <p className="muted">No changes yet. The diff appears once the agent edits a file.</p>;
  const totals = files.reduce((acc, f) => ({ added: acc.added + f.added, removed: acc.removed + f.removed }), { added: 0, removed: 0 });
  return (
    <div className="diff">
      <p className="diff-totals">
        {files.length} {files.length === 1 ? "file" : "files"} changed, <span className="add">+{totals.added}</span>{" "}
        <span className="del">−{totals.removed}</span>
      </p>
      {files.map((file) => (
        <FileSection key={file.path} file={file} />
      ))}
    </div>
  );
}
