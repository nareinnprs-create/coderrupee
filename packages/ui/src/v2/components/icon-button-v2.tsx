import { Button as Kobalte } from "@kobalte/core/button"
import { type ComponentProps, splitProps } from "solid-js"
import { JSX } from "solid-js"
import "./icon-button-v2.css"

export interface IconButtonV2Props
  extends ComponentProps<typeof Kobalte>,
    Pick<ComponentProps<"button">, "class" | "classList"> {
  // Constraint: takes a rendered element, not an icon name — callers compose
  // <Icon> themselves and no icon size is derived from `size`. The commented
  // name/size form below is the intended end-state.
  icon?: JSX.Element
  // icon: IconProps["name"]
  size?: "small" | "normal" | "large"
  // iconSize?: IconProps["size"]
  variant?: "neutral" | "contrast" | "ghost" | "ghost-muted"
  state?: "rest" | "hover" | "pressed"
}

export function IconButtonV2(props: ComponentProps<"button"> & IconButtonV2Props) {
  const [split, rest] = splitProps(props, ["variant", "size", "iconSize", "class", "classList", "state"])
  return (
    <Kobalte
      {...rest}
      data-component="icon-button-v2"
      // data-icon={props.icon}
      data-size={split.size || "normal"}
      data-variant={split.variant || "neutral"}
      data-state={split.state}
      classList={{
        ...split.classList,
        [split.class ?? ""]: !!split.class,
      }}
    >
      {props.icon}
      {/*<Icon name={props.icon} size={split.iconSize ?? (split.size === "large" ? "normal" : "small")} />*/}
    </Kobalte>
  )
}
