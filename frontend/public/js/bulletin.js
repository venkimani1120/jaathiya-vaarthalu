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
    if (hasAudio(s)) {
      audio.src = s.dataset.audio;
      audio.playbackRate = speed;
      if (playing) audio.play().catch(() => setPlaying(false));
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

  function setPlaying(v) {
    if (v && ended) show(0);
    playing = v;
    playBtn.innerHTML = v ? PAUSE : PLAY;
    playBtn.setAttribute('aria-label', v ? playBtn.dataset.pause : playBtn.dataset.play);
    big.hidden = v;
    if (v) {
      if (hasAudio(slides[i])) audio.play().catch(() => setPlaying(false));
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
