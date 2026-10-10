const { contextBridge, ipcRenderer } = require("electron");
const invoke =
  (name) =>
  (...args) =>
    ipcRenderer.invoke("backstage:" + name, ...args);
contextBridge.exposeInMainWorld(
  "backstage",
  Object.fromEntries(
    [
      "library",
      "loadSong",
      "search",
      "enqueue",
      "queue",
      "importAudio",
      "install",
      "chooseLibrary",
      "settings",
      "configurePython",
      "openPreparation",
      "openChart",
      "showSongs",
      "removeSong",
      "tidyLibrary",
      "findCover",
      "scores",
      "saveScore",
      "band",
      "saveSlot",
      "cameraAccess",
    ].map((name) => [name, invoke(name)]),
  ),
);
