import type { ComponentProps } from "solid-js"
import wordmarkUrl from "../../assets/images/wordmark.svg"

export function WordmarkV2(props: Pick<ComponentProps<"img">, "class">) {
  return (
    <img
      src={wordmarkUrl}
      classList={{ [props.class ?? ""]: !!props.class }}
      alt="CoderRupee"
      style={{ "object-fit": "contain" }}
    />
  )
}
