import path from "path"
import type { DoctorContext } from "../../src/doctor"

export const mockPaths = {
  data: path.join("mock", "data"),
  cache: path.join("mock", "cache"),
  config: path.join("mock", "config"),
  state: path.join("mock", "state"),
}

export function mockContext(overrides: Partial<DoctorContext> = {}): DoctorContext {
  return {
    cwd: path.join("mock", "project"),
    execPath: path.join("mock", "bin", "coderrupee"),
    version: "1.19.4",
    channel: "latest",
    paths: mockPaths,
    runCommand: async () => ({ code: -1, stdout: "", stderr: "not mocked" }),
    exists: async () => false,
    readFile: async () => {
      throw new Error("not mocked")
    },
    accessWritable: async () => true,
    statfs: async () => undefined,
    detectMethod: async () => "unknown",
    ...overrides,
  }
}

export function command(stdout: string, code = 0) {
  return { code, stdout, stderr: "" }
}
