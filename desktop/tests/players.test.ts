import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addPlayer,
  cycleDevice,
  cycleLevel,
  cyclePart,
  fitToSong,
  lineupProblem,
  type PlayerSetup,
} from "../src/core/players";
import type { Song } from "../src/types";
const song: Song = {
  id: "s",
  title: "Song",
  artist: "Artist",
  duration: 60,
  charts: [
    { part: "Guitar", level: "Easy", count: 10 },
    { part: "Guitar", level: "Expert", count: 40 },
    { part: "Drums", level: "Medium", count: 20 },
  ],
};
const pads = ["keyboard", "pad:0:Guitar A", "pad:1:Guitar B", "midi"];
const one: PlayerSetup[] = [
  { device: "keyboard", part: "Guitar", level: "Easy" },
];
test("added players take the next free device, up to four", () => {
  let players = addPlayer(one, pads, song);
  assert.equal(players[1].device, "pad:0:Guitar A");
  players = addPlayer(addPlayer(players, pads, song), pads, song);
  assert.deepEqual(
    players.map((p) => p.device),
    pads,
  );
  assert.equal(players[3].part, "Drums", "MIDI joins on drums");
  assert.equal(addPlayer(players, [...pads, "pad:2:Extra"], song).length, 4);
});
test("no player is added when every device is taken", () => {
  assert.equal(addPlayer(one, ["keyboard"], song).length, 1);
});
test("cycling a device skips devices other players hold", () => {
  const players = addPlayer(one, pads, song); // keyboard, pad 0
  const next = cycleDevice(players, 1, pads);
  assert.equal(next[1].device, "pad:1:Guitar B");
  assert.equal(cycleDevice(next, 1, pads)[1].device, "midi");
  assert.equal(
    cycleDevice(cycleDevice(next, 1, pads), 1, pads)[1].device,
    "pad:0:Guitar A",
    "wraps without landing on the keyboard player's device",
  );
});
test("instrument and difficulty stay on charts the song has", () => {
  const drums = cyclePart(one, 0, song);
  assert.deepEqual(drums[0], {
    device: "keyboard",
    part: "Drums",
    level: "Medium",
  });
  assert.equal(cycleLevel(one, 0, song)[0].level, "Expert");
  assert.equal(
    fitToSong([{ device: "keyboard", part: "Bass", level: "Hard" }], song)[0]
      .part,
    "Guitar",
  );
});
test("a lineup needs distinct, connected devices", () => {
  const players = addPlayer(one, pads, song);
  assert.equal(lineupProblem(players, pads), null);
  assert.match(
    lineupProblem(players, ["keyboard"]) ?? "",
    /Player 2’s controller is not connected/,
  );
  assert.match(
    lineupProblem([one[0], one[0]], pads) ?? "",
    /Player 2 shares a controller/,
  );
});
