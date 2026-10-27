import { For, Show, createSignal } from "solid-js"
import { useDialog } from "@coderrupee/ui/context/dialog"
import { Dialog } from "@coderrupee/ui/dialog"
import { DialogBody, DialogFooter, DialogHeader, DialogTitleGroup, DialogV2 } from "@coderrupee/ui/v2/dialog-v2"
import { Button } from "@coderrupee/ui/button"
import { ButtonV2 } from "@coderrupee/ui/v2/button-v2"
import { RadioGroupV2, RadioItemV2 } from "@coderrupee/ui/v2/radio-v2"
import { RadioGroup } from "@coderrupee/ui/radio-group"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useSettings } from "@/context/settings"
import { showToast } from "@/utils/toast"
import {
  downloadSessionExportFile,
  fetchSessionExport,
  sessionExportDocument,
  sessionExportFilename,
  type SessionExportFormat,
} from "@/utils/session-export"

const FORMATS: SessionExportFormat[] = ["json", "markdown", "html"]

export function DialogExportSession(props: { sessionID: string }) {
  const dialog = useDialog()
  const language = useLanguage()
  const sdk = useSDK()
  const settings = useSettings()
  const [format, setFormat] = createSignal<SessionExportFormat>("json")
  const [pending, setPending] = createSignal(false)

  const exportSession = async () => {
    if (pending()) return
    setPending(true)
    try {
      const data = await fetchSessionExport({
        sessionID: props.sessionID,
        client: sdk().client,
      })
      const selected = format()
      const document = sessionExportDocument(data, selected)
      const filename = sessionExportFilename(data.info, selected)
      downloadSessionExportFile(filename, document)
      dialog.close()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("toast.session.export.success.title"),
        description: language.t("toast.session.export.success.description", { filename }),
      })
    } catch (err) {
      setPending(false)
      showToast({
        variant: "error",
        title: language.t("toast.session.export.failed.title"),
        description: err instanceof Error ? err.message : language.t("toast.session.export.failed.description"),
      })
    }
  }

  if (settings.general.newLayoutDesigns())
    return (
      <DialogV2 fit>
        <DialogHeader>
          <DialogTitleGroup
            title={language.t("dialog.export.title")}
            description={language.t("dialog.export.description")}
          />
        </DialogHeader>
        <DialogBody>
          <RadioGroupV2
            hideLabel
            class="dialog-export-format-group"
            label={language.t("dialog.export.format.label")}
            value={format()}
            onChange={(value) => {
              if (typeof value === "string" && FORMATS.includes(value as SessionExportFormat)) {
                setFormat(value as SessionExportFormat)
              }
            }}
            disabled={pending()}
          >
            <For each={FORMATS}>
              {(item) => (
                <RadioItemV2
                  value={item}
                  label={language.t(`dialog.export.format.${item}`)}
                  description={language.t(`dialog.export.format.${item}.description`)}
                />
              )}
            </For>
          </RadioGroupV2>
        </DialogBody>
        <DialogFooter>
          <ButtonV2 variant="ghost" disabled={pending()} onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </ButtonV2>
          <ButtonV2 variant="contrast" disabled={pending()} onClick={exportSession}>
            {pending() ? language.t("dialog.export.action.pending") : language.t("dialog.export.action")}
          </ButtonV2>
        </DialogFooter>
      </DialogV2>
    )

  return (
    <Dialog title={language.t("dialog.export.title")} fit>
      <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
        <div class="flex flex-col gap-1">
          <span class="text-14-regular text-text-strong">{language.t("dialog.export.description")}</span>
        </div>
        <RadioGroup
          options={FORMATS}
          current={format()}
          onSelect={(value) => value && setFormat(value)}
          label={(item) => language.t(`dialog.export.format.${item}`)}
          size="small"
          fill
        />
        <div class="flex justify-end gap-2">
          <Button variant="ghost" size="large" disabled={pending()} onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button variant="primary" size="large" disabled={pending()} onClick={exportSession}>
            {pending() ? language.t("dialog.export.action.pending") : language.t("dialog.export.action")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
