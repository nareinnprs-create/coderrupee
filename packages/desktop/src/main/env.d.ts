interface ImportMetaEnv {
  readonly CODERRUPEE_CHANNEL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module "virtual:coderrupee-server" {
  export namespace Server {
    export const listen: typeof import("../../../coderrupee/dist/types/src/node").Server.listen
    export type Listener = import("../../../coderrupee/dist/types/src/node").Server.Listener
  }
  export namespace Config {
    export const get: typeof import("../../../coderrupee/dist/types/src/node").Config.get
    export type Info = import("../../../coderrupee/dist/types/src/node").Config.Info
  }
  export const bootstrap: typeof import("../../../coderrupee/dist/types/src/node").bootstrap
}
