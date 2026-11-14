import { useEffect, useState } from "react";

/** A shell command with a copy button. The copy result is announced, not only shown. */
export function CommandLine({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="command">
      <code>{command}</code>
      <button type="button" className="copy" onClick={copy}>
        {copied ? "Copied" : "Copy"}
      </button>
      <span className="sr-only" role="status">{copied ? "Command copied" : ""}</span>
    </div>
  );
}
