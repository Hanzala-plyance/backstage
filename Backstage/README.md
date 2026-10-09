# Backstage game

Backstage is the product-facing fork of YARG. The canonical business logic,
requirements, constitution, and feature history are on
[backstage-specs/meta](https://github.com/Hanzala-plyance/backstage-specs/tree/meta).

Open this folder in Unity **6000.3.5f2** after running `git submodule update --init --recursive`
from the repository root. Follow [development setup](../docs/development.md).
Public branding, product name, app identity, and library integration are Backstage.
Engine namespaces and serialized identifiers are retained for compatibility.

The shared song root is `~/Music/Backstage/Songs` or `BACKSTAGE_SONGS_DIR`.
In the music-library menu, **Add New Song (staff)** opens the local preparation
service and **Scan Songs** discovers completed installs. Start the service from
[Add New Song](../Add%20New%20Song/) first.

This develop candidate has not yet passed Unity build and physical gameplay
acceptance. Promotion follows develop -> stage -> main; see the root README.

## Attribution

Derived from [YARG](https://github.com/YARC-Official/YARG), including its contributor
work and third-party assets. Original notices and [LICENSE](LICENSE) remain.
The preserved [upstream README](UPSTREAM-README.md) documents upstream dependencies,
licenses, contributors, and assets. Backstage branding does not claim ownership of
those works or remove their terms. Review upstream runtime/audio dependencies and
catalog authorization before any commercial release.

Pinned core: YARG.Core `3beb94e526558134145bcd3e409428f759001a40`, from upstream
YARG master `f5bfbe6996b4af35722d4204a93c6cc5c8f52a45` on 2026-10-09.
Discord presence stays inactive unless `BACKSTAGE_DISCORD_APPLICATION_ID` is set;
the fork does not use upstream's application identity.
