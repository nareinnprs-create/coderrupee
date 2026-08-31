import { AgentV2 } from "@coderrupee/core/agent"
import { AISDK } from "@coderrupee/core/aisdk"
import { Catalog } from "@coderrupee/core/catalog"
import { CommandV2 } from "@coderrupee/core/command"
import { Credential } from "@coderrupee/core/credential"
import { AppNodeBuilder } from "@coderrupee/core/effect/app-node-builder"
import { LayerNodePlatform } from "@coderrupee/core/effect/app-node-platform"
import { LayerNode } from "@coderrupee/core/effect/layer-node"
import { EventV2 } from "@coderrupee/core/event"
import { FileSystem } from "@coderrupee/core/filesystem"
import { FSUtil } from "@coderrupee/core/fs-util"
import { Integration } from "@coderrupee/core/integration"
import { Location } from "@coderrupee/core/location"
import { Npm } from "@coderrupee/core/npm"
import { PluginV2 } from "@coderrupee/core/plugin"
import { Reference } from "@coderrupee/core/reference"
import { SkillV2 } from "@coderrupee/core/skill"
import { Effect, Layer } from "effect"
import { tempLocationLayer } from "../fixture/location"

const npmLayer = Layer.succeed(
  Npm.Service,
  Npm.Service.of({
    add: () => Effect.succeed({ directory: "", entrypoint: undefined }),
    install: () => Effect.void,
    which: () => Effect.succeed(undefined),
  }),
)

export const PluginTestLayer = AppNodeBuilder.build(
  LayerNode.group([
    FileSystem.node,
    FSUtil.node,
    Location.node,
    Npm.node,
    Credential.node,
    EventV2.node,
    LayerNodePlatform.httpClient,
    PluginV2.node,
    AgentV2.node,
    AISDK.node,
    Catalog.node,
    CommandV2.node,
    Integration.node,
    Reference.node,
    SkillV2.node,
  ]),
  [
    [Location.node, tempLocationLayer],
    [Npm.node, npmLayer],
  ],
)
