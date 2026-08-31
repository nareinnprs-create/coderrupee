import { type ComponentProps } from "solid-js"
import logoUrl from "../assets/images/logo.png"

export const Mark = (props: { class?: string }) => {
  return (
    <img
      src={logoUrl}
      data-component="logo-mark"
      classList={{ [props.class ?? ""]: !!props.class }}
      alt="CoderRupee Mark"
      style={{ "object-fit": "contain" }}
    />
  )
}

export const Splash = (props: Pick<ComponentProps<"img">, "ref" | "class">) => {
  return (
    <img
      ref={props.ref}
      src={logoUrl}
      data-component="logo-splash"
      classList={{ [props.class ?? ""]: !!props.class }}
      alt="CoderRupee Splash"
      style={{ "object-fit": "contain" }}
    />
  )
}

export const Logo = (props: { class?: string }) => {
  return (
    <img
      src={logoUrl}
      data-component="logo"
      classList={{ [props.class ?? ""]: !!props.class }}
      alt="CoderRupee Logo"
      style={{ "object-fit": "contain" }}
    />
  )
}
