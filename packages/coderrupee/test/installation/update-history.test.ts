import { describe, expect, test } from "bun:test"
import path from "path"
import { UpdateHistory } from "../../src/installation/update-history"
import { tmpdir } from "../fixture/fixture"

describe("update history", () => {
  test("round-trips entries through the history file", async () => {
    await using tmp = await tmpdir()
    expect(UpdateHistory.read(tmp.path)).toEqual([])
    UpdateHistory.record({ fromVersion: "1.4.1", toVersion: "1.4.2", channel: "stable" }, tmp.path)
    UpdateHistory.record({ fromVersion: "1.4.2", toVersion: "1.4.3-beta.1", channel: "beta" }, tmp.path)
    const entries = UpdateHistory.read(tmp.path)
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({ fromVersion: "1.4.1", toVersion: "1.4.2", channel: "stable" })
    expect(entries[1]).toMatchObject({ fromVersion: "1.4.2", toVersion: "1.4.3-beta.1", channel: "beta" })
    expect(entries[0].date).toBeTruthy()
  })

  test("caps the file at the last five entries", async () => {
    await using tmp = await tmpdir()
    for (let index = 1; index <= UpdateHistory.MAX_ENTRIES + 2; index++) {
      UpdateHistory.record({ fromVersion: `1.4.${index}`, toVersion: `1.4.${index + 1}`, channel: "stable" }, tmp.path)
    }
    const entries = UpdateHistory.read(tmp.path)
    expect(entries).toHaveLength(UpdateHistory.MAX_ENTRIES)
    expect(entries[0]).toMatchObject({ fromVersion: "1.4.3" })
    expect(UpdateHistory.last(entries)).toMatchObject({ toVersion: "1.4.8" })
  })

  test("rolling back appends an entry, so rolling back again swaps direction", async () => {
    await using tmp = await tmpdir()
    UpdateHistory.record({ fromVersion: "1.4.1", toVersion: "1.4.2", channel: "stable" }, tmp.path)
    expect(UpdateHistory.last(UpdateHistory.read(tmp.path))?.fromVersion).toBe("1.4.1")
    // The rollback itself is recorded like any other upgrade.
    UpdateHistory.record({ fromVersion: "1.4.2", toVersion: "1.4.1", channel: "stable" }, tmp.path)
    expect(UpdateHistory.last(UpdateHistory.read(tmp.path))?.fromVersion).toBe("1.4.2")
  })

  test("ignores corrupt and non-list history files", async () => {
    await using tmp = await tmpdir()
    await Bun.write(UpdateHistory.file(tmp.path), "not json")
    expect(UpdateHistory.read(tmp.path)).toEqual([])
    await Bun.write(UpdateHistory.file(tmp.path), JSON.stringify({ fromVersion: "1.4.1" }))
    expect(UpdateHistory.read(tmp.path)).toEqual([])
  })

  test("defaults to the stable channel when no config sets one", async () => {
    await using tmp = await tmpdir()
    expect(UpdateHistory.currentChannel(tmp.path)).toBe("stable")
  })

  test("reads the channel from json and jsonc global config", async () => {
    await using json = await tmpdir()
    await Bun.write(path.join(json.path, "coderrupee.json"), JSON.stringify({ channel: "beta" }))
    expect(UpdateHistory.currentChannel(json.path)).toBe("beta")

    await using jsonc = await tmpdir()
    await Bun.write(path.join(jsonc.path, "coderrupee.jsonc"), '{\n  // try pre-releases\n  "channel": "beta"\n}')
    expect(UpdateHistory.currentChannel(jsonc.path)).toBe("beta")

    await using stable = await tmpdir()
    await Bun.write(path.join(stable.path, "coderrupee.json"), JSON.stringify({ channel: "stable" }))
    expect(UpdateHistory.currentChannel(stable.path)).toBe("stable")
  })

  test("ignores unknown channel values in config", async () => {
    await using tmp = await tmpdir()
    await Bun.write(path.join(tmp.path, "coderrupee.json"), JSON.stringify({ channel: "nightly" }))
    expect(UpdateHistory.currentChannel(tmp.path)).toBe("stable")
  })
})
