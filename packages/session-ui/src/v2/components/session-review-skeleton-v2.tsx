import { For } from "solid-js"
import { useI18n } from "@coderrupee/ui/context/i18n"
import "./session-review-v2.css"

// Deterministic width pattern so the placeholder does not jitter between renders.
const ROWS = [
  [72, 58, 84],
  [64, 90, 46],
  [78, 52, 68],
  [60, 82, 40],
]

export function SessionReviewSkeletonV2() {
  const i18n = useI18n()

  return (
    <div
      data-component="session-review-skeleton-v2"
      role="status"
      aria-busy="true"
      aria-label={i18n.t("ui.sessionReviewV2.loading")}
    >
      <For each={ROWS}>
        {(row) => (
          <div data-slot="session-review-skeleton-v2-file">
            <div
              data-slot="session-review-skeleton-v2-bar"
              data-kind="file"
              style={{ width: `${row[0]}%` }}
            />
            <For each={row.slice(1)}>
              {(width) => (
                <div data-slot="session-review-skeleton-v2-bar" data-kind="line" style={{ width: `${width}%` }} />
              )}
            </For>
          </div>
        )}
      </For>
    </div>
  )
}
