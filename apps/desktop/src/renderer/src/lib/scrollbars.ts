// Scrollbars stay out of sight until you scroll (main.css): the scrolled element gets
// .is-scrolling while it moves and for a moment after, which shows its thumb.
const timers = new WeakMap<Element, ReturnType<typeof setTimeout>>()

export function startScrollbars(): void {
  document.addEventListener(
    'scroll',
    (e) => {
      const el = e.target instanceof Element ? e.target : document.documentElement
      el.classList.add('is-scrolling')
      clearTimeout(timers.get(el))
      timers.set(
        el,
        setTimeout(() => el.classList.remove('is-scrolling'), 900)
      )
    },
    { capture: true, passive: true }
  )
}
