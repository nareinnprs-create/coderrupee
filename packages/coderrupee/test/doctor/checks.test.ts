import { describe, expect, test } from "bun:test"
import { Doctor } from "../../src/doctor"
import { command, mockContext, mockPaths } from "./mock"

describe("doctor installation check", () => {
  test("passes when a managed install method is detected", async () => {
    const result = await Doctor.installationCheck.run(mockContext({ detectMethod: async () => "npm" }))
    expect(result.status).toBe("pass")
    expect(result.detail).toContain("1.19.4")
    expect(result.detail).toContain("npm")
    expect(result.detail).toContain("latest")
  })

  test("reports an unknown method as info with a hint", async () => {
    const result = await Doctor.installationCheck.run(mockContext())
    expect(result.status).toBe("info")
    expect(result.hint).toBeDefined()
  })

  test("reports a local development build as info", async () => {
    const result = await Doctor.installationCheck.run(
      mockContext({ channel: "local", detectMethod: async () => "bun" }),
    )
    expect(result.status).toBe("info")
    expect(result.detail).toContain("local build")
  })

  test("survives a failing method probe", async () => {
    const result = await Doctor.installationCheck.run(
      mockContext({
        detectMethod: async () => {
          throw new Error("boom")
        },
      }),
    )
    expect(result.status).toBe("info")
    expect(result.detail).toContain("boom")
  })
})

describe("doctor runtime check", () => {
  test("reports both runtimes when available", async () => {
    const result = await Doctor.runtimeCheck.run(
      mockContext({
        runCommand: async (file) => (file === "bun" ? command("1.3.14") : command("v22.14.0")),
      }),
    )
    expect(result.status).toBe("pass")
    expect(result.detail).toBe("bun 1.3.14, node v22.14.0")
  })

  test("passes with only node present", async () => {
    const result = await Doctor.runtimeCheck.run(
      mockContext({ runCommand: async (file) => (file === "node" ? command("v22.14.0") : command("", 1)) }),
    )
    expect(result.status).toBe("pass")
    expect(result.detail).toBe("node v22.14.0")
  })

  test("is info when neither runtime is on PATH", async () => {
    const result = await Doctor.runtimeCheck.run(mockContext())
    expect(result.status).toBe("info")
  })
})

describe("doctor auth check", () => {
  test("is info when no auth file exists", async () => {
    const result = await Doctor.authCheck.run(mockContext())
    expect(result.status).toBe("info")
    expect(result.detail).toContain(mockPaths.data)
  })

  test("counts valid providers and reports the storage location", async () => {
    const result = await Doctor.authCheck.run(
      mockContext({
        exists: async (file) => file.endsWith("auth.json"),
        readFile: async () =>
          JSON.stringify({ openai: { type: "api", key: "sk" }, anthropic: { type: "api", key: "sk" } }),
      }),
    )
    expect(result.status).toBe("pass")
    expect(result.detail).toContain("2 provider(s)")
    expect(result.detail).toContain(mockPaths.data)
  })

  test("warns on unreadable entries", async () => {
    const result = await Doctor.authCheck.run(
      mockContext({
        exists: async (file) => file.endsWith("auth.json"),
        readFile: async () => JSON.stringify({ openai: { type: "api", key: "sk" }, broken: { nope: true } }),
      }),
    )
    expect(result.status).toBe("warn")
    expect(result.detail).toContain("broken")
  })

  test("warns on malformed auth JSON", async () => {
    const result = await Doctor.authCheck.run(
      mockContext({
        exists: async (file) => file.endsWith("auth.json"),
        readFile: async () => "{not json",
      }),
    )
    expect(result.status).toBe("warn")
  })

  test("reads credentials from CODERRUPEE_AUTH_CONTENT when set", async () => {
    const saved = process.env.CODERRUPEE_AUTH_CONTENT
    process.env.CODERRUPEE_AUTH_CONTENT = JSON.stringify({ openai: { type: "api", key: "sk" } })
    try {
      const result = await Doctor.authCheck.run(mockContext())
      expect(result.status).toBe("pass")
      expect(result.detail).toContain("CODERRUPEE_AUTH_CONTENT")
    } finally {
      if (saved === undefined) delete process.env.CODERRUPEE_AUTH_CONTENT
      else process.env.CODERRUPEE_AUTH_CONTENT = saved
    }
  })
})

describe("doctor config check", () => {
  test("is info when no config file exists", async () => {
    const result = await Doctor.configCheck.run(mockContext())
    expect(result.status).toBe("info")
    expect(result.detail).toContain(mockPaths.config)
  })

  test("passes on a valid config file", async () => {
    const result = await Doctor.configCheck.run(
      mockContext({
        exists: async (file) => file.endsWith("coderrupee.jsonc"),
        readFile: async () => '{}',
      }),
    )
    expect(result.status).toBe("pass")
  }, 30000)

  test("fails on a syntax error without mutating the file", async () => {
    const result = await Doctor.configCheck.run(
      mockContext({
        exists: async (file) => file.endsWith("coderrupee.jsonc"),
        readFile: async () => '{"model": }',
      }),
    )
    expect(result.status).toBe("fail")
    expect(result.detail).toContain("line 1")
    expect(result.hint).toBeDefined()
  })

  test("fails on a schema error and names the offending path", async () => {
    const result = await Doctor.configCheck.run(
      mockContext({
        exists: async (file) => file.endsWith("coderrupee.jsonc"),
        readFile: async () => '{"model": 123}',
      }),
    )
    expect(result.status).toBe("fail")
    expect(result.detail).toContain("model")
  }, 30000)
})

describe("doctor project check", () => {
  test("is info outside a git repository", async () => {
    const result = await Doctor.projectCheck.run(mockContext())
    expect(result.status).toBe("info")
  })

  test("passes on a clean worktree", async () => {
    const result = await Doctor.projectCheck.run(
      mockContext({
        runCommand: async (file, args) => {
          if (file !== "git") return command("", 1)
          if (args[0] === "rev-parse") return command("true\n")
          if (args[0] === "branch") return command("main\n")
          return command("")
        },
      }),
    )
    expect(result.status).toBe("pass")
    expect(result.detail).toContain("main")
    expect(result.detail).toContain("clean")
  })

  test("counts uncommitted changes as info", async () => {
    const result = await Doctor.projectCheck.run(
      mockContext({
        runCommand: async (file, args) => {
          if (file !== "git") return command("", 1)
          if (args[0] === "rev-parse") return command("true\n")
          if (args[0] === "branch") return command("feature\n")
          return command(" M a.txt\n?? b.txt\n")
        },
      }),
    )
    expect(result.status).toBe("info")
    expect(result.detail).toContain("2 uncommitted change(s)")
  })

  test("reports detached HEAD state", async () => {
    const result = await Doctor.projectCheck.run(
      mockContext({
        runCommand: async (file, args) => {
          if (file !== "git") return command("", 1)
          if (args[0] === "rev-parse") return command("true\n")
          return command("")
        },
      }),
    )
    expect(result.detail).toContain("detached HEAD")
  })
})

describe("doctor storage check", () => {
  test("passes when every directory is writable", async () => {
    const result = await Doctor.storageCheck.run(mockContext({ exists: async () => true }))
    expect(result.status).toBe("pass")
    expect(result.detail).toContain("4 directories")
  })

  test("warns when a directory is missing", async () => {
    const result = await Doctor.storageCheck.run(mockContext())
    expect(result.status).toBe("warn")
    expect(result.detail).toContain("missing")
  })

  test("fails when a directory is not writable", async () => {
    const result = await Doctor.storageCheck.run(
      mockContext({
        exists: async () => true,
        accessWritable: async (dir) => dir !== mockPaths.data,
      }),
    )
    expect(result.status).toBe("fail")
    expect(result.detail).toContain("data")
  })
})

describe("doctor disk check", () => {
  const blocks = (bytes: number) => async () => ({ bsize: 4096, bavail: bytes / 4096 })

  test("passes with ample free space", async () => {
    const result = await Doctor.diskCheck.run(mockContext({ statfs: blocks(100 * 1024 * 1024 * 1024) }))
    expect(result.status).toBe("pass")
    expect(result.detail).toContain("100.0 GiB")
  })

  test("warns below 1 GiB", async () => {
    const result = await Doctor.diskCheck.run(mockContext({ statfs: blocks(500 * 1024 * 1024) }))
    expect(result.status).toBe("warn")
  })

  test("fails below 256 MiB", async () => {
    const result = await Doctor.diskCheck.run(mockContext({ statfs: blocks(100 * 1024 * 1024) }))
    expect(result.status).toBe("fail")
    expect(result.hint).toBeDefined()
  })

  test("is info when free space cannot be determined", async () => {
    const result = await Doctor.diskCheck.run(mockContext())
    expect(result.status).toBe("info")
  })
})
