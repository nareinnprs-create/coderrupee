import type { DatabaseSync, SQLInputValue } from "node:sqlite"
import { drizzle } from "drizzle-orm/node-sqlite"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import { identity } from "effect/Function"
import * as Layer from "effect/Layer"
import * as Semaphore from "effect/Semaphore"
import * as Stream from "effect/Stream"
import * as Reactivity from "effect/unstable/reactivity/Reactivity"
import * as Client from "effect/unstable/sql/SqlClient"
import type { Connection } from "effect/unstable/sql/SqlConnection"
import { classifySqliteError, SqlError } from "effect/unstable/sql/SqlError"
import * as Statement from "effect/unstable/sql/Statement"
import { Sqlite } from "./sqlite"

const ATTR_DB_SYSTEM_NAME = "db.system.name"

const TypeId = "~@coderrupee/core/database/SqliteNode" as const
type TypeId = typeof TypeId

interface SqliteClient extends Client.SqlClient {
  readonly [TypeId]: TypeId
  readonly config: Config
  readonly loadExtension: (path: string) => Effect.Effect<void, SqlError>
  readonly updateValues: never
}

interface Config {
  readonly filename: string
  readonly readonly?: boolean
  readonly create?: boolean
  readonly readwrite?: boolean
  readonly disableWAL?: boolean
  readonly timeout?: number
  readonly allowExtension?: boolean
  readonly spanAttributes?: Record<string, unknown>
  readonly transformResultNames?: (str: string) => string
  readonly transformQueryNames?: (str: string) => string
}

interface SqliteConnection extends Connection {
  readonly loadExtension: (path: string) => Effect.Effect<void, SqlError>
}

const make = (options: Config) =>
  Effect.gen(function* () {
    const native = (yield* Sqlite.Native) as DatabaseSync

    const compiler = Statement.makeCompilerSqlite(options.transformQueryNames)
    const transformRows = options.transformResultNames
      ? Statement.defaultTransforms(options.transformResultNames).array
      : undefined

    const run = (query: string, params: ReadonlyArray<unknown> = []) =>
      Effect.withFiber<Array<Record<string, unknown>>, SqlError>((fiber) => {
        const statement = native.prepare(query)
        statement.setReadBigInts(Context.get(fiber.context, Client.SafeIntegers))
        try {
          return Effect.succeed(statement.all(...(params as SQLInputValue[])) as Array<Record<string, unknown>>)
        } catch (cause) {
          return Effect.fail(
            new SqlError({
              reason: classifySqliteError(cause, { message: "Failed to execute statement", operation: "execute" }),
            }),
          )
        }
      })

    const runValues = (query: string, params: ReadonlyArray<unknown> = []) =>
      Effect.withFiber<ReadonlyArray<ReadonlyArray<unknown>>, SqlError>((fiber) => {
        const statement = native.prepare(query)
        statement.setReadBigInts(Context.get(fiber.context, Client.SafeIntegers))
        // node:sqlite gained setReturnArrays in Node 24; Electron's bundled Node
        // (22.x) lacks it, so reshape object rows via column order there.
        if (typeof statement.setReturnArrays === "function") {
          statement.setReturnArrays(true)
          try {
            return Effect.succeed(
              statement.all(...(params as SQLInputValue[])) as unknown as ReadonlyArray<ReadonlyArray<unknown>>,
            )
          } catch (cause) {
            return Effect.fail(
              new SqlError({
                reason: classifySqliteError(cause, { message: "Failed to execute statement", operation: "execute" }),
              }),
            )
          }
        }
        try {
          // Object keys arrive in SELECT column order, so Object.values is
          // already positional; no metadata API needed on older Node.
          const rows = statement.all(...(params as SQLInputValue[])) as Array<Record<string, unknown>>
          return Effect.succeed(rows.map((row) => Object.values(row)))
        } catch (cause) {
          return Effect.fail(
            new SqlError({
              reason: classifySqliteError(cause, { message: "Failed to execute statement", operation: "execute" }),
            }),
          )
        }
      })

    const connection = identity<SqliteConnection>({
      execute(query, params, transformRows) {
        return transformRows ? Effect.map(run(query, params), transformRows) : run(query, params)
      },
      executeRaw(query, params) {
        return run(query, params)
      },
      executeValues(query, params) {
        return runValues(query, params)
      },
      executeUnprepared(query, params, transformRows) {
        return this.execute(query, params, transformRows)
      },
      executeStream(query, params, transformRows) {
        // node:sqlite has no cursor API, so the stream is the full result set from the
        // shared `run` helper drained row by row.
        return Stream.unwrap(
          Effect.map(run(query, params), (rows) => Stream.fromIterable(transformRows ? transformRows(rows) : rows)),
        )
      },
      loadExtension: (path) =>
        Effect.try({
          try: () => native.loadExtension(path),
          catch: (cause) =>
            new SqlError({
              reason: classifySqliteError(cause, { message: "Failed to load extension", operation: "loadExtension" }),
            }),
        }),
    })

    const semaphore = yield* Semaphore.make(1)
    const acquirer = semaphore.withPermits(1)(Effect.succeed(connection))
    // Fully uninterruptible acquisition: the scheduler can park the fiber between
    // the semaphore grant and the finalizer registration, and an interrupt landing
    // in that window would leak the permit and lock up every later query. A parked
    // uninterruptible fiber always resumes to completion; the recorded interrupt
    // fires afterwards, when the scope already owns the release.
    const transactionAcquirer = Effect.uninterruptible(
      Effect.as(
        Effect.tap(semaphore.take(1), () => Effect.addFinalizer(() => semaphore.release(1))),
        connection,
      ),
    )

    const client = Object.assign(
      (yield* Client.make({
        acquirer,
        compiler,
        transactionAcquirer,
        spanAttributes: [
          ...(options.spanAttributes ? Object.entries(options.spanAttributes) : []),
          [ATTR_DB_SYSTEM_NAME, "sqlite"],
        ],
        transformRows,
      })) as SqliteClient,
      {
        [TypeId]: TypeId,
        config: options,
        loadExtension: (path: string) => Effect.flatMap(acquirer, (_) => _.loadExtension(path)),
      },
    )

    return client
  })

const nativeLayer = (config: Config) =>
  Layer.effect(
    Sqlite.Native,
    Effect.gen(function* () {
      // Lazy: older Bun releases ship no `node:sqlite` builtin; the computed specifier
      // keeps the transpiler from resolving the builtin while collecting this module.
      const { DatabaseSync: DatabaseSyncCtor } = yield* Effect.promise(
        () => import("node" + ":sqlite") as Promise<{ DatabaseSync: DatabaseSyncCtor }>,
      )
      Sqlite.restrictToOwner(config.filename, (config.create ?? true) && config.readonly !== true)
      const native = new DatabaseSyncCtor(config.filename, {
        readOnly: config.readonly,
        timeout: config.timeout,
        allowExtension: config.allowExtension,
        enableForeignKeyConstraints: true,
        open: true,
      })
      yield* Effect.addFinalizer(() => Effect.sync(() => native.close()))
      if (config.disableWAL !== true && config.readonly !== true) native.exec("PRAGMA journal_mode = WAL;")
      return native
    }),
  )

const sqliteLayer = (config: Config) => Layer.effect(Client.SqlClient, make(config))

const drizzleLayer = Layer.effect(
  Sqlite.Drizzle,
  Effect.gen(function* () {
    // Same lazy/computed treatment: drizzle's node-sqlite driver statically imports
    // node:sqlite, which older Bun releases do not ship.
    const { drizzle } = yield* Effect.promise(() => import("drizzle-orm/node-sqlite"))
    return drizzle({ client: (yield* Sqlite.Native) as DatabaseSync }) as unknown as Sqlite.DrizzleClient
  }),
)

// bun-types declares node:sqlite's DatabaseSync without a construct signature.
interface DatabaseSyncCtor {
  new (
    filename: string,
    options?: {
      readonly readOnly?: boolean
      readonly timeout?: number
      readonly allowExtension?: boolean
      readonly enableForeignKeyConstraints?: boolean
      readonly open?: boolean
    },
  ): DatabaseSync
}

export const layer = (config: Config) => {
  const native = nativeLayer(config)
  return Layer.merge(native, Layer.merge(sqliteLayer(config), drizzleLayer).pipe(Layer.provide(native))).pipe(
    Layer.provide(Reactivity.layer),
  )
}

export * as SqliteNode from "./sqlite.node"
