/* Generated from showcase/seed.json, run b7c6e4f58254 (the multi-file fix). Every line is a recorded event. */
window.DRYDOCK_RUN_LOG = {
  runId: "b7c6e4f58254",
  events: [
    {
      "t": "0.00",
      "k": "sys",
      "label": "status",
      "text": "queued"
    },
    {
      "t": "0.00",
      "k": "sys",
      "label": "status",
      "text": "running"
    },
    {
      "t": "0.54",
      "k": "sys",
      "label": "status",
      "text": "workspace ready"
    },
    {
      "t": "0.54",
      "k": "agent",
      "label": "agent",
      "text": "Running the suite before I touch anything."
    },
    {
      "t": "0.54",
      "k": "tool",
      "label": "bash",
      "text": "node --test"
    },
    {
      "t": "0.74",
      "k": "err",
      "label": "result",
      "text": "3 failing · 2 pass"
    },
    {
      "t": "0.74",
      "k": "agent",
      "label": "agent",
      "text": "Three failures across cart, format and split. Starting with the cart total, since the others depend on it."
    },
    {
      "t": "0.74",
      "k": "tool",
      "label": "read_file",
      "text": "src/cart.js"
    },
    {
      "t": "0.79",
      "k": "agent",
      "label": "agent",
      "text": "The discount is applied after tax. Moving it ahead of the tax calculation."
    },
    {
      "t": "0.79",
      "k": "tool",
      "label": "edit_file",
      "text": "src/cart.js"
    },
    {
      "t": "0.93",
      "k": "agent",
      "label": "agent",
      "text": "Re-running. The cart test should pass now; two failures remain."
    },
    {
      "t": "0.93",
      "k": "tool",
      "label": "bash",
      "text": "node --test"
    },
    {
      "t": "1.15",
      "k": "err",
      "label": "result",
      "text": "2 failing · 3 pass"
    },
    {
      "t": "1.15",
      "k": "agent",
      "label": "agent",
      "text": "formatMoney drops the pence. Reading it before I change it."
    },
    {
      "t": "1.15",
      "k": "tool",
      "label": "read_file",
      "text": "src/format.js"
    },
    {
      "t": "1.22",
      "k": "agent",
      "label": "agent",
      "text": "toFixed(0) rounds to whole dollars. Showing two decimals."
    },
    {
      "t": "1.22",
      "k": "tool",
      "label": "edit_file",
      "text": "src/format.js"
    },
    {
      "t": "1.35",
      "k": "agent",
      "label": "agent",
      "text": "One failure left, in splitEvenly. Reading it."
    },
    {
      "t": "1.35",
      "k": "tool",
      "label": "read_file",
      "text": "src/split.js"
    },
    {
      "t": "1.43",
      "k": "agent",
      "label": "agent",
      "text": "The remainder is dropped, so splitEvenly(10, 3) returns [3, 3, 3]. The first shares should take the extra pence."
    },
    {
      "t": "1.43",
      "k": "tool",
      "label": "edit_file",
      "text": "src/split.js"
    },
    {
      "t": "1.55",
      "k": "agent",
      "label": "agent",
      "text": "Running the full suite."
    },
    {
      "t": "1.55",
      "k": "tool",
      "label": "bash",
      "text": "node --test"
    },
    {
      "t": "1.72",
      "k": "ok",
      "label": "result",
      "text": "all passing · 5 pass"
    },
    {
      "t": "1.88",
      "k": "sys",
      "label": "diff",
      "text": "3 files, +5 −4"
    },
    {
      "t": "2.32",
      "k": "sys",
      "label": "deliver",
      "text": "branch drydock/run-b7c6e4f58254 to the local remote"
    },
    {
      "t": "2.32",
      "k": "out",
      "label": "outcome",
      "text": "succeeded"
    }
  ]
};
