export type TokenKind = "plain" | "keyword" | "string" | "number" | "comment";
export interface Token {
  text: string;
  kind: TokenKind;
}

const KEYWORDS = new Set([
  "async", "await", "break", "case", "catch", "class", "const", "continue", "default", "else", "export", "extends",
  "false", "finally", "for", "from", "function", "if", "import", "let", "new", "null", "return", "switch", "this",
  "throw", "true", "try", "typeof", "undefined", "var", "while", "interface", "type", "as", "readonly",
]);

// One ordered scan: comment, string, number, identifier, then any single character.
const TOKEN = /(\/\/.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)|([\s\S])/g;

/** Splits one line of JS/TS-like source into coloured tokens. Pure; the tokens' text joins back to the line. */
export function tokenizeCode(line: string): Token[] {
  const tokens: Token[] = [];
  for (const m of line.matchAll(TOKEN)) {
    const [text, comment, string, number, word] = m;
    const kind: TokenKind = comment ? "comment" : string ? "string" : number ? "number" : word && KEYWORDS.has(word) ? "keyword" : "plain";
    const last = tokens.at(-1);
    // Merge runs of plain characters so the DOM stays small.
    if (kind === "plain" && last?.kind === "plain") last.text += text;
    else tokens.push({ text, kind });
  }
  return tokens;
}
