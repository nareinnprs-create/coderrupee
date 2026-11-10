// Solid types define `autocomplete` only on form/input-flavored attributes,
// but it is a valid global HTML attribute (e.g. contenteditable).
declare module "solid-js" {
  namespace JSX {
    interface HTMLAttributes<T> {
      autocomplete?: string | undefined
    }
  }
}

export {}
