type ReviewObserverCallback = (element: HTMLElement) => void

const callbacks = new Map<HTMLElement, ReviewObserverCallback>()
const intersectionObserver =
  typeof IntersectionObserver === "function"
    ? new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) callbacks.get(entry.target as HTMLElement)?.(entry.target as HTMLElement)
        }
      })
    : undefined
const resizeObserver =
  typeof ResizeObserver === "function"
    ? new ResizeObserver((entries) => {
        for (const entry of entries) callbacks.get(entry.target as HTMLElement)?.(entry.target as HTMLElement)
      })
    : undefined

export function observeReviewElement(element: HTMLElement, callback: ReviewObserverCallback) {
  callbacks.set(element, callback)
  intersectionObserver?.observe(element)
  resizeObserver?.observe(element)
  callback(element)

  return () => {
    callbacks.delete(element)
    intersectionObserver?.unobserve(element)
    resizeObserver?.unobserve(element)
  }
}
