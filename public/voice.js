/* Jobseeker: record a STAR story by voice. The recording is split into ~2-minute
   segments (each a complete audio file), sent to /materials/stories/voice, and
   transcribed by Whisper on Workers AI. Nothing leaves the app otherwise. */
(function () {
  var btn = document.getElementById("voiceBtn");
  if (!btn) return;
  var label = document.getElementById("voiceLabel");
  var timeEl = document.getElementById("voiceTime");
  var statusEl = document.getElementById("voiceStatus");
  var langEl = document.getElementById("voiceLang");
  var SEGMENT_MS = 120000, MAX_MS = 20 * 60000;
  var stream = null, rec = null, segments = [], started = 0, tick = null, segTimer = null, stopping = false;
  try { var saved = localStorage.getItem("jobseeker.voice.lang"); if (saved != null) langEl.value = saved; } catch (e) { /* ignore */ }
  langEl.addEventListener("change", function () { try { localStorage.setItem("jobseeker.voice.lang", langEl.value); } catch (e) { /* ignore */ } });

  if (!navigator.mediaDevices || !window.MediaRecorder) {
    btn.disabled = true;
    statusEl.textContent = "Ovaj browser ne podržava snimanje. Probaj Chrome ili Safari.";
    return;
  }
  function mime() {
    var types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
    for (var i = 0; i < types.length; i++) if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(types[i])) return types[i];
    return "";
  }
  function fmt(ms) { var s = Math.floor(ms / 1000); return Math.floor(s / 60) + ":" + ("0" + (s % 60)).slice(-2); }
  function setState(state) {
    btn.classList.toggle("rec", state === "rec");
    btn.disabled = state === "busy";
    label.textContent = state === "rec" ? "Zaustavi" : state === "busy" ? "Obrađujem…" : "Snimi";
    btn.setAttribute("aria-label", state === "rec" ? "Zaustavi snimanje" : "Počni snimanje");
  }

  // One MediaRecorder per segment, so every piece is a valid file on its own.
  function startSegment() {
    var type = mime();
    rec = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 32000 } : undefined);
    var chunks = [];
    rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = function () {
      if (chunks.length) segments.push(new Blob(chunks, { type: rec.mimeType || type || "audio/webm" }));
      if (stopping) finish(); else startSegment();
    };
    rec.start();
    segTimer = setTimeout(function () { if (rec && rec.state === "recording") rec.stop(); }, SEGMENT_MS);
  }

  function start() {
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).then(function (s) {
      stream = s; segments = []; stopping = false; started = Date.now();
      setState("rec");
      statusEl.textContent = "Snimam… Pričaj slobodno, Claude posle sređuje.";
      tick = setInterval(function () {
        var el = Date.now() - started;
        timeEl.textContent = fmt(el);
        if (el >= MAX_MS) stop();
      }, 250);
      startSegment();
    }).catch(function () {
      statusEl.textContent = "Nemam dozvolu za mikrofon. Dozvoli mikrofon za ovaj sajt u podešavanjima browsera.";
    });
  }

  function stop() {
    stopping = true;
    clearInterval(tick); clearTimeout(segTimer);
    setState("busy");
    statusEl.textContent = "Prepoznajem govor… (oko 10 sekundi po minuti snimka)";
    if (rec && rec.state === "recording") rec.stop(); else finish();
  }

  function finish() {
    if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
    if (!segments.length) { setState("idle"); statusEl.textContent = "Snimak je prazan."; return; }
    var fd = new FormData();
    segments.forEach(function (b, i) { fd.append("audio", b, "seg" + i + (b.type.indexOf("mp4") >= 0 ? ".m4a" : ".webm")); });
    fd.append("lang", langEl.value);
    fetch("/materials/stories/voice", { method: "POST", body: fd, credentials: "same-origin" })
      .then(function (r) { return r.json().catch(function () { return { error: "Greška servera (" + r.status + ")." }; }); })
      .then(function (j) {
        if (j && j.ok) { location.href = "/materials?tab=stories&ok=voice"; return; }
        setState("idle");
        statusEl.textContent = (j && j.error) || "Nešto nije u redu. Pokušaj ponovo.";
      })
      .catch(function () { setState("idle"); statusEl.textContent = "Nema veze sa serverom. Pokušaj ponovo."; });
  }

  btn.addEventListener("click", function () { if (btn.classList.contains("rec")) stop(); else start(); });
})();
