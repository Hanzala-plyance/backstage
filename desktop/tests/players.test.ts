import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addPlayer,
  cycleSetting,
  joinPlayer,
  leavePlayer,
  rematch,
  toggleStrum,
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

test("a controller pressing Start joins once, up to four players", () => {
  let lineup = [
    { device: "keyboard", part: "Guitar", level: "Expert" },
  ] as PlayerSetup[];
  lineup = joinPlayer(lineup, "pad:16:Riff");
  assert.deepEqual(lineup[1], {
    device: "pad:16:Riff",
    part: "Guitar",
    level: "Easy",
  });
  assert.equal(joinPlayer(lineup, "pad:16:Riff").length, 2, "no double join");
  assert.equal(joinPlayer(lineup, "midi")[2].part, "Drums");
  for (const d of ["pad:1:a", "pad:2:b", "pad:3:c"])
    lineup = joinPlayer(lineup, d);
  assert.equal(lineup.length, 4);
});
test("setup cycles any instrument or difficulty; Player 1 can't leave", () => {
  const lineup = [
    { device: "keyboard", part: "Guitar", level: "Expert" },
    { device: "pad:16:Riff", part: "Drums", level: "Easy" },
  ] as PlayerSetup[];
  assert.equal(cycleSetting(lineup, 1, "part")[1].part, "Guitar", "wraps");
  assert.equal(cycleSetting(lineup, 0, "level")[0].level, "Easy", "wraps");
  assert.equal(cycleSetting(lineup, 1, "level", -1)[1].level, "Expert");
  assert.equal(leavePlayer(lineup, 0).length, 2);
  assert.deepEqual(leavePlayer(lineup, 1), [lineup[0]]);
});
test("each player can turn strumming on or off", () => {
  const lineup = [
    { device: "keyboard", part: "Guitar", level: "Easy" },
    { device: "pad:16:Riff", part: "Guitar", level: "Easy" },
  ] as PlayerSetup[];
  const off = toggleStrum(lineup, 1, true);
  assert.equal(off[1].strum, false);
  assert.equal(off[0].strum, undefined, "others keep following Settings");
  assert.equal(toggleStrum(off, 1, false)[1].strum, true);
});
test("a pad back at a new index keeps its player", () => {
  const players = [
    { device: "keyboard", part: "Guitar", level: "Easy" },
    { device: "pad:0:Xbox Pad", part: "Guitar", level: "Hard" },
  ] as const;
  // Same id at index 2: Player 2 follows it, keeping their settings.
  const moved = rematch([...players], [{ index: 2, id: "Xbox Pad" }]);
  assert.equal(moved[1].device, "pad:2:Xbox Pad");
  assert.equal(moved[1].level, "Hard");
  assert.equal(moved[0].device, "keyboard");
  // Still there: nothing changes.
  assert.deepEqual(rematch([...players], [{ index: 0, id: "Xbox Pad" }]), [
    ...players,
  ]);
  // Two identical pads: ambiguous, so the player waits for their own.
  const twins = rematch(
    [...players],
    [
      { index: 2, id: "Xbox Pad" },
      { index: 3, id: "Xbox Pad" },
    ],
  );
  assert.equal(twins[1].device, "pad:0:Xbox Pad");
  // A pad another player holds is never taken.
  const held = rematch(
    [
      { device: "pad:2:Xbox Pad", part: "Guitar", level: "Easy" },
      { device: "pad:0:Xbox Pad", part: "Bass", level: "Easy" },
    ],
    [{ index: 2, id: "Xbox Pad" }],
  );
  assert.equal(held[1].device, "pad:0:Xbox Pad");
});
