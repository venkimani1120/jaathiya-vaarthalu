// News bulletin player (bulletinPage() in src/render.js). Plays the day's stories one after another: each slide shows
// the story's photo and headline, and the caption under the player is what the reader says. A slide with data-audio
// plays that file and moves on when it ends; a slide without audio moves on after the caption's reading time.
// Without this script the slides are a swipeable strip and the playlist links to the stories.
document.querySelectorAll('.bulletin').forEach((root) => {
  const track = root.querySelector('.bl-track');
  const slides = [...track.children];
  const n = slides.length;
  const ctl = root.querySelector('.bl-ctl');
  if (!n || !ctl) return;
  const big = root.querySelector('.bl-big');
  const playBtn = ctl.querySelector('.bl-play');
  const bar = ctl.querySelector('.bl-bar');
  const fill = bar.firstElementChild;
  const count = ctl.querySelector('.bl-count');
  const speedBtn = ctl.querySelector('.bl-speed');
  const ccBtn = ctl.querySelector('.bl-cc');
  const say = root.querySelector('.bl-say');
  const nextUp = root.querySelector('.bl-next-up');
  const links = [...root.querySelectorAll('.playlist a[data-i]')];
  const bug = root.querySelector('.bl-bug').textContent;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const SPEEDS = [1, 1.25, 1.5];
  const PLAY = playBtn.innerHTML;
  const PAUSE = '<svg class="ic" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>';
  const audio = new Audio();
  audio.preload = 'none';
  const anchor = presenter(root.querySelector('.bl-anchor'), still);
  let loading = false; // the current story's audio is being fetched for the presenter
  // Phones only start audio from a tap. When the file arrives after the tap, playing a moment of silence during the tap
  // unlocks the player for it.
  const SILENCE = (() => {
    const b = new Uint8Array(44 + 1600), v = new DataView(b.buffer), w = (o, t) => [...t].forEach((c, k) => (b[o + k] = c.charCodeAt(0)));
    w(0, 'RIFF'); v.setUint32(4, 36 + 1600, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, 8000, true); v.setUint32(28, 16000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, 1600, true);
    return `data:audio/wav;base64,${btoa(String.fromCharCode(...b))}`;
  })();
  let unlocked = false;
  const unlock = () => {
    if (unlocked) return;
    unlocked = true;
    audio.src = SILENCE;
    audio.play().then(() => { if (audio.src === SILENCE) audio.pause(); }, () => {});
  };
  let i = 0, playing = false, ended = false, speed = 1, captions = true, elapsed = 0, last = 0, raf = 0, settle = 0;

  ctl.hidden = false;
  big.hidden = false;
  say.hidden = false;

  const hasAudio = (s) => !!s.dataset.audio;
  // Reading time of a slide without audio: about 15 characters a second, 6 to 20 seconds
  const readMs = (s) => Math.min(20000, Math.max(6000, (s.dataset.say.length / 15) * 1000));
  const setProgress = (f) => {
    const pct = Math.round(Math.min(1, Math.max(0, f)) * 100);
    fill.style.width = `${pct}%`;
    bar.setAttribute('aria-valuenow', pct);
  };

  function show(k) {
    i = Math.max(0, Math.min(n - 1, k));
    elapsed = 0;
    ended = false;
    const s = slides[i];
    track.scrollTo({ left: i * track.clientWidth, behavior: still ? 'auto' : 'smooth' });
    say.textContent = s.dataset.say;
    count.textContent = count.dataset.of.replace('%i', i + 1).replace('%n', n);
    links.forEach((a, k2) => a.setAttribute('aria-current', String(k2 === i)));
    const nx = slides[i + 1];
    nextUp.hidden = !nx;
    if (nx) nextUp.querySelector('span').textContent = nx.querySelector('h2').textContent;
    setProgress(0);
    audio.pause();
    anchor.talking(false);
    if (hasAudio(s) && !anchor.on) {
      audio.src = s.dataset.audio;
      audio.playbackRate = speed;
      if (playing) audio.play().catch(() => setPlaying(false));
    } else if (hasAudio(s)) {
      // With a presenter the file is fetched first (to read its loudness), then played from that copy
      loading = true;
      anchor.load(s.dataset.audio).then((src) => {
        if (slides[i] !== s) return;
        loading = false;
        audio.src = src;
        audio.playbackRate = speed;
        if (playing) audio.play().catch(() => setPlaying(false));
      });
      if (slides[i + 1] && hasAudio(slides[i + 1])) anchor.load(slides[i + 1].dataset.audio); // ready before it's needed
    }
    if ('mediaSession' in navigator && window.MediaMetadata) {
      const img = s.querySelector('img');
      navigator.mediaSession.metadata = new MediaMetadata({ title: s.querySelector('h2').textContent, artist: bug, artwork: img ? [{ src: img.currentSrc || img.src }] : [] });
    }
  }

  function advance() {
    if (i < n - 1) { show(i + 1); tick(); return; }
    setPlaying(false);
    ended = true;
    setProgress(1);
    big.setAttribute('aria-label', root.dataset.replay);
  }

  // Progress (and, for slides without audio, the reading clock). Runs only while playing.
  function frame(t) {
    raf = 0;
    if (!playing) return;
    const s = slides[i];
    if (hasAudio(s)) {
      if (audio.duration) setProgress(audio.currentTime / audio.duration);
      anchor.tick(t, slides[i].dataset.audio, audio.currentTime);
    } else {
      elapsed += (t - last) * speed;
      setProgress(elapsed / readMs(s));
      if (elapsed >= readMs(s)) return advance();
    }
    last = t;
    raf = requestAnimationFrame(frame);
  }
  const tick = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } };
  audio.addEventListener('ended', () => playing && advance());
  audio.addEventListener('playing', () => anchor.talking(true));
  audio.addEventListener('pause', () => anchor.talking(false));

  function setPlaying(v) {
    if (v && ended) show(0);
    playing = v;
    playBtn.innerHTML = v ? PAUSE : PLAY;
    playBtn.setAttribute('aria-label', v ? playBtn.dataset.pause : playBtn.dataset.play);
    big.hidden = v;
    if (v) {
      if (hasAudio(slides[i]) && loading) unlock();
      else if (hasAudio(slides[i])) audio.play().catch(() => setPlaying(false));
      tick();
    } else audio.pause();
  }

  big.onclick = () => setPlaying(true);
  playBtn.onclick = () => setPlaying(!playing);
  ctl.querySelector('.bl-prev').onclick = () => { show(i - 1); if (playing) tick(); };
  ctl.querySelector('.bl-next').onclick = () => { show(i + 1); if (playing) tick(); };
  speedBtn.onclick = () => {
    speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    speedBtn.textContent = `${speed}×`;
    audio.playbackRate = speed;
  };
  ccBtn.onclick = () => {
    captions = !captions;
    ccBtn.setAttribute('aria-pressed', String(captions));
    say.hidden = !captions;
  };
  // The playlist jumps to a story in the player; each slide has its own "Read the full story" link
  links.forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    show(Number(a.dataset.i));
    setPlaying(true);
    root.querySelector('.player').scrollIntoView({ block: 'nearest', behavior: still ? 'auto' : 'smooth' });
  }));
  // A swipe on the strip picks that story once the scrolling stops
  track.addEventListener('scroll', () => {
    clearTimeout(settle);
    settle = setTimeout(() => { const k = Math.round(track.scrollLeft / track.clientWidth); if (k !== i) { show(k); if (playing) tick(); } }, 150);
  }, { passive: true });
  root.querySelector('.player').addEventListener('keydown', (e) => {
    if (e.target.closest('a, button')) return;
    if (e.key === ' ' || e.key === 'k') { e.preventDefault(); setPlaying(!playing); }
    if (e.key === 'ArrowRight') { e.preventDefault(); show(i + 1); if (playing) tick(); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); show(i - 1); if (playing) tick(); }
  });
  addEventListener('resize', () => { track.scrollLeft = i * track.clientWidth; });
  if ('mediaSession' in navigator) {
    const on = (a, f) => { try { navigator.mediaSession.setActionHandler(a, f); } catch {} };
    on('play', () => setPlaying(true));
    on('pause', () => setPlaying(false));
    on('nexttrack', () => { show(i + 1); if (playing) tick(); });
    on('previoustrack', () => { show(i - 1); if (playing) tick(); });
  }

  show(0);
});

// The bulletin's presenter: photos of one person (mouth closed / half / open, eyes shut) shown one at a time. The mouth
// follows the voice: each story's audio is fetched once, its loudness measured every 40 ms (Web Audio decode), and the
// player plays that same downloaded copy, so the sound never goes through Web Audio (which could silence it on phones)
// and nothing is downloaded twice. If the file can't be fetched or decoded, it plays from its address and the mouth
// follows a speaking rhythm instead. Blinks every few seconds; a slight sway unless reduced motion is asked for.
// Without a presenter, load() just returns the address and the rest does nothing.
function presenter(el, still) {
  if (!el) return { on: false, load: (url) => Promise.resolve(url), talking() {}, tick() {} };
  const STEP = 0.04; // seconds per loudness value
  const frames = new Set(el.dataset.frames.split(' '));
  const face = el.querySelector('.an-face');
  const loaded = new Map(); // url → Promise<{ src, env }>
  const AC = window.AudioContext || window.webkitAudioContext;
  let decoder = null, talking = false, shown = 'closed', since = 0, level = 0, fake = 0;
  const show = (f, t) => { if (f !== shown) { shown = f; since = t; el.dataset.f = f; } };
  const decode = (buf) => new Promise((ok, fail) => { decoder = decoder || new AC(); decoder.decodeAudioData(buf, ok, fail); });

  // Loudness every STEP seconds, scaled so that loud speech is about 1
  function envelope(audioBuf) {
    const data = audioBuf.getChannelData(0), per = Math.max(1, Math.round(audioBuf.sampleRate * STEP));
    const env = new Float32Array(Math.ceil(data.length / per));
    for (let k = 0; k < env.length; k++) {
      let sum = 0;
      const end = Math.min(data.length, (k + 1) * per);
      for (let j = k * per; j < end; j++) sum += data[j] * data[j];
      env[k] = Math.sqrt(sum / (end - k * per));
    }
    const peak = [...env].sort((a, b) => a - b)[Math.floor(env.length * 0.95)] || 1;
    return env.map((v) => Math.min(1.5, v / peak));
  }

  function load(url) {
    if (!loaded.has(url)) {
      loaded.set(url, fetch(url, { mode: 'cors' }).then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
        .then((buf) => {
          const src = URL.createObjectURL(new Blob([buf], { type: 'audio/mpeg' }));
          return (AC ? decode(buf.slice(0)).then(envelope, () => null) : Promise.resolve(null)).then((env) => ({ src, env }));
        })
        .catch(() => ({ src: url, env: null })));
    }
    return Promise.race([loaded.get(url), new Promise((ok) => setTimeout(() => ok({ src: url, env: null }), 15000))]).then((x) => x.src);
  }

  function tick(t, url, time) {
    if (!talking) return;
    let v;
    const env = loaded.has(url) && loaded.get(url).done;
    if (env) v = env[Math.floor(time / STEP)] || 0;
    else { // no measured loudness: syllables of about a tenth of a second with short gaps
      if (t > fake) { fake = t + 80 + Math.random() * 90; level = Math.random() < 0.22 ? 0 : 0.3 + Math.random() * 0.7; }
      v = level;
    }
    // Hold each mouth shape at least 70 ms, so it doesn't flicker
    if (t - since >= 70) show(v > 0.55 ? 'open' : v > 0.22 ? (frames.has('half') ? 'half' : 'open') : 'closed', t);
    if (!still) face.style.transform = `translateY(${(Math.sin(t / 900) * 1.5).toFixed(2)}px) rotate(${(Math.sin(t / 1300) * 0.6 + v * 0.8).toFixed(2)}deg)`;
  }

  function setTalking(v) {
    talking = v;
    el.classList.toggle('talking', v);
    if (!v) { show('closed', performance.now()); face.style.transform = ''; }
  }

  // Blink every 2.5 to 6 seconds, only while the mouth is closed (the eyes-shut photo has a closed mouth)
  if (frames.has('blink')) {
    const blink = () => {
      if (shown === 'closed') { el.dataset.f = 'blink'; setTimeout(() => { if (el.dataset.f === 'blink') el.dataset.f = shown; }, 130); }
      setTimeout(blink, 2500 + Math.random() * 3500);
    };
    setTimeout(blink, 3000);
  }
  return {
    on: true,
    // Keeps the measured loudness next to the promise, so tick() can read it without waiting
    load: (url) => { const p = load(url); loaded.get(url).then((x) => { loaded.get(url).done = x.env; }); return p; },
    talking: setTalking, tick,
  };
}
