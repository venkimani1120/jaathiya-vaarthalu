// Hero carousel. Without this script the slides are still a swipeable scroll-snap strip.
// Autoplay stops for reduced-motion users, on hover/focus, and for good once someone uses the controls.
document.querySelectorAll('.hero').forEach((hero) => {
  const track = hero.querySelector('.hero-track');
  const slides = [...track.children];
  const ctl = hero.querySelector('.hero-ctl');
  if (slides.length < 2 || !ctl) return;
  const dots = [...ctl.querySelectorAll('.dots button')];
  const pause = ctl.querySelector('.pause');
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let i = 0, stopped = still, hold = false;
  ctl.hidden = false;

  const show = (n) => {
    i = (n + slides.length) % slides.length;
    track.scrollTo({ left: i * track.clientWidth, behavior: still ? 'auto' : 'smooth' });
  };
  const mark = () => dots.forEach((d, k) => d.setAttribute('aria-current', k === i));
  const tick = () => { if (!hold && !stopped) show(i + 1); };
  const setStopped = (v) => {
    stopped = v;
    pause.textContent = v ? '▶' : '❚❚';
    pause.setAttribute('aria-label', v ? pause.dataset.play : pause.dataset.pause);
  };
  const user = (n) => { setStopped(true); show(n); };

  ctl.querySelector('.prev').onclick = () => user(i - 1);
  ctl.querySelector('.next').onclick = () => user(i + 1);
  dots.forEach((d, k) => (d.onclick = () => user(k)));
  pause.onclick = () => setStopped(!stopped);
  track.addEventListener('scroll', () => {
    i = Math.round(track.scrollLeft / track.clientWidth);
    mark();
  }, { passive: true });
  hero.addEventListener('mouseenter', () => (hold = true));
  hero.addEventListener('mouseleave', () => (hold = false));
  hero.addEventListener('focusin', () => (hold = true));
  hero.addEventListener('focusout', () => (hold = false));
  track.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); user(i + 1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); user(i - 1); }
  });

  setStopped(stopped);
  mark();
  setInterval(tick, 6000);
  document.addEventListener('visibilitychange', () => (hold = document.hidden));
});
