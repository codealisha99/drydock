// Replays the recorded run in the hero. Gaps come from the recording, clamped so the pace is watchable.
(function () {
  var list = document.getElementById("log-lines");
  var toggle = document.getElementById("log-toggle");
  var run = window.DRYDOCK_RUN_LOG;
  if (!list || !toggle || !run) return;
  var events = run.events;
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var MIN_MS = 220;
  var MAX_MS = 850;
  var HOLD_MS = 3200;
  var timer = null;
  var index = 0;
  var playing = !reduced;

  function row(e) {
    var li = document.createElement("li");
    li.className = "ln ln-" + e.k;
    var time = document.createElement("time");
    time.textContent = e.t;
    var label = document.createElement("span");
    label.className = "lbl";
    label.textContent = e.label;
    var text = document.createElement("span");
    text.className = "txt";
    text.textContent = e.text;
    li.append(time, label, text);
    return li;
  }

  function delayFor(i) {
    var gap = i === 0 ? 0 : (Number(events[i].t) - Number(events[i - 1].t)) * 1000;
    return Math.min(MAX_MS, Math.max(MIN_MS, gap));
  }

  function step() {
    if (!playing) return;
    if (index >= events.length) {
      timer = setTimeout(restart, HOLD_MS);
      return;
    }
    list.appendChild(row(events[index]));
    index += 1;
    timer = setTimeout(step, index < events.length ? delayFor(index) : 0);
  }

  function restart() {
    list.textContent = "";
    index = 0;
    step();
  }

  function showAll() {
    list.textContent = "";
    events.forEach(function (e) { list.appendChild(row(e)); });
  }

  toggle.addEventListener("click", function () {
    playing = !playing;
    toggle.setAttribute("aria-pressed", String(!playing));
    toggle.textContent = playing ? "Pause" : "Play";
    if (playing) step();
    else clearTimeout(timer);
  });

  if (reduced) {
    toggle.hidden = true;
    showAll();
  } else {
    step();
  }
})();
