import { Show } from "solid-js"
import { useI18n } from "@coderrupee/ui/context/i18n"
import { Icon } from "@coderrupee/ui/v2/icon"
import { ButtonV2 } from "@coderrupee/ui/v2/button-v2"
import "./session-review-v2.css"

export type SessionReviewEmptyChangesV2Props = {
  onRefresh?: () => void
  refreshing?: boolean
  onOpenSession?: () => void
}

export function SessionReviewEmptyChangesV2(props: SessionReviewEmptyChangesV2Props) {
  const i18n = useI18n()

  return (
    <div data-slot="session-review-v2-empty-changes">
      <Icon name="review" size="large" />
      <div data-slot="session-review-v2-empty-changes-title">{i18n.t("ui.sessionReviewV2.empty.changes.title")}</div>
      <div data-slot="session-review-v2-empty-changes-description">
        {i18n.t("ui.sessionReviewV2.empty.changes.description")}
      </div>
      <Show when={props.onRefresh || props.onOpenSession}>
        <div data-slot="session-review-v2-empty-changes-actions">
          <Show when={props.onRefresh}>
            <ButtonV2 variant="neutral" size="small" disabled={props.refreshing} onClick={props.onRefresh}>
              {props.refreshing
                ? i18n.t("ui.sessionReviewV2.empty.changes.refreshing")
                : i18n.t("ui.sessionReviewV2.empty.changes.refresh")}
            </ButtonV2>
          </Show>
          <Show when={props.onOpenSession}>
            <ButtonV2 variant="ghost" size="small" onClick={props.onOpenSession}>
              {i18n.t("ui.sessionReviewV2.empty.changes.openSession")}
            </ButtonV2>
          </Show>
        </div>
      </Show>
    </div>
  )
}
