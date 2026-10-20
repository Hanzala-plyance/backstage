<!-- BACKSTAGE-CONSTITUTION:START -->
Generated from https://github.com/Hanzala-plyance/backstage-specs/tree/meta/governance.
Source SHA-256: `adaaefbc16e2205d60e39d1092ef0db5b4796e4e46149af5c15186748f342d62`.
Edit the canonical sources in backstage-specs; regenerate this managed block.

# desktop: Backstage Electron and browser game runtime

Read the root AGENTS.md and the relevant shared specs first.

- Keep the renderer sandboxed and expose only validated, narrow IPC methods.
- Keep audio-clock gameplay and controller normalization separate from React UI rendering.
- Local playback must work without the optional Python preparation service.
- Keep controller compatibility claims tied to actual device evidence; unknown devices use explicit mapping.
- Measure app payload and runtime behavior. Do not bundle Unity assets, model weights, conversion output or Python environments.
<!-- BACKSTAGE-CONSTITUTION:END -->
