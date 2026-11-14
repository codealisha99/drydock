/* Generated from showcase/seed.json, run e65d6c98e21a (the multi-file fix). Every line is a recorded event. */
window.DRYDOCK_RUN_LOG = {
  runId: "e65d6c98e21a",
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
      "t": "0.86",
      "k": "sys",
      "label": "status",
      "text": "workspace ready"
    },
    {
      "t": "0.86",
      "k": "agent",
      "label": "agent",
      "text": "Running the suite before I touch anything."
    },
    {
      "t": "0.86",
      "k": "tool",
      "label": "bash",
      "text": "node --test"
    },
    {
      "t": "1.18",
      "k": "err",
      "label": "result",
      "text": "3 failing · 2 pass"
    },
    {
      "t": "1.18",
      "k": "agent",
      "label": "agent",
      "text": "Three failures across cart, format and split. Starting with the cart total, since the others depend on it."
    },
    {
      "t": "1.18",
      "k": "tool",
      "label": "read_file",
      "text": "src/cart.js"
    },
    {
      "t": "1.33",
      "k": "agent",
      "label": "agent",
      "text": "The discount is applied after tax. Moving it ahead of the tax calculation."
    },
    {
      "t": "1.33",
      "k": "tool",
      "label": "edit_file",
      "text": "src/cart.js"
    },
    {
      "t": "1.53",
      "k": "agent",
      "label": "agent",
      "text": "Re-running. The cart test should pass now; two failures remain."
    },
    {
      "t": "1.53",
      "k": "tool",
      "label": "bash",
      "text": "node --test"
    },
    {
      "t": "1.85",
      "k": "err",
      "label": "result",
      "text": "2 failing · 3 pass"
    },
    {
      "t": "1.86",
      "k": "agent",
      "label": "agent",
      "text": "formatMoney drops the pence. Reading it before I change it."
    },
    {
      "t": "1.86",
      "k": "tool",
      "label": "read_file",
      "text": "src/format.js"
    },
    {
      "t": "1.94",
      "k": "agent",
      "label": "agent",
      "text": "toFixed(0) rounds to whole dollars. Showing two decimals."
    },
    {
      "t": "1.94",
      "k": "tool",
      "label": "edit_file",
      "text": "src/format.js"
    },
    {
      "t": "2.20",
      "k": "agent",
      "label": "agent",
      "text": "One failure left, in splitEvenly. Reading it."
    },
    {
      "t": "2.20",
      "k": "tool",
      "label": "read_file",
      "text": "src/split.js"
    },
    {
      "t": "2.34",
      "k": "agent",
      "label": "agent",
      "text": "The remainder is dropped, so splitEvenly(10, 3) returns [3, 3, 3]. The first shares should take the extra pence."
    },
    {
      "t": "2.34",
      "k": "tool",
      "label": "edit_file",
      "text": "src/split.js"
    },
    {
      "t": "2.60",
      "k": "agent",
      "label": "agent",
      "text": "Running the full suite."
    },
    {
      "t": "2.60",
      "k": "tool",
      "label": "bash",
      "text": "node --test"
    },
    {
      "t": "2.97",
      "k": "ok",
      "label": "result",
      "text": "all passing · 5 pass"
    },
    {
      "t": "3.28",
      "k": "sys",
      "label": "diff",
      "text": "3 files, +5 −4"
    },
    {
      "t": "4.12",
      "k": "sys",
      "label": "deliver",
      "text": "branch drydock/run-e65d6c98e21a to the local remote"
    },
    {
      "t": "4.12",
      "k": "out",
      "label": "outcome",
      "text": "succeeded"
    }
  ]
};
