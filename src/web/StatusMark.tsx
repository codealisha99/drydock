import type { RunStatus } from "./api";
import { STATUS_LABEL } from "./format";

/** Status as text plus a single colored square. Color is never the only signal. */
export function StatusMark({ status }: { status: RunStatus }) {
  return (
    <span className={`status status-${status}`}>
      <span className="status-square" aria-hidden="true" />
      {STATUS_LABEL[status]}
    </span>
  );
}
