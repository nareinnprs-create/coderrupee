import { SessionReviewEmptyChangesV2 } from "./session-review-empty-changes-v2"
import { SessionReviewSkeletonV2 } from "./session-review-skeleton-v2"

const docs = `### Overview
Loading and empty states for the v2 session review pane.

### API
- \`SessionReviewSkeletonV2\` renders pulsing file/line placeholder rows while the diff loads.
  Announced via \`role="status"\`; animation is disabled under \`prefers-reduced-motion: reduce\`.
- \`SessionReviewEmptyChangesV2\` accepts optional \`onRefresh\`, \`refreshing\`, and \`onOpenSession\`
  props to render an action row under the explanatory copy.

### Theming
- Uses \`data-component="session-review-skeleton-v2"\` and the \`session-review-v2-empty-changes\`
  slots from \`session-review-v2.css\`; colors via v2 background/text tokens.
`

export default {
  title: "UI V2/SessionReviewStates",
  id: "components-session-review-states-v2",
  tags: ["autodocs"],
  parameters: {
    frameBackground: "#fff",
    layout: "padded",
    docs: {
      description: {
        component: docs,
      },
    },
  },
}

export const Loading = {
  render: () => (
    <div style={{ width: "480px", height: "320px", display: "flex" }}>
      <SessionReviewSkeletonV2 />
    </div>
  ),
}

export const EmptyChanges = {
  render: () => (
    <div style={{ width: "480px", height: "320px", display: "flex" }}>
      <SessionReviewEmptyChangesV2 />
    </div>
  ),
}

export const EmptyChangesWithActions = {
  render: () => (
    <div style={{ width: "480px", height: "320px", display: "flex" }}>
      <SessionReviewEmptyChangesV2 onRefresh={() => {}} onOpenSession={() => {}} />
    </div>
  ),
}
