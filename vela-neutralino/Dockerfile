# Reproducible Neutralino desktop build — mirrors .github/workflows/_build-desktop.yml.
#
# Produces the same single-file per-OS binaries CI ships, but locally via Docker
# so a workstation needs neither Node/pnpm nor the `neu` CLI on PATH.
#
# Run from the REPO ROOT (build context must include tools/ + skills/ for concat + sync):
#
#   docker build -f vela-neutralino/Dockerfile -o type=local,dest=vela-neutralino/dist .
#
# Output lands in vela-neutralino/dist/:
#   vela/vela-{linux_x64,linux_arm64,mac_x64,mac_arm64,mac_universal,win_x64.exe}
#   vela-desktop-local-*.zip
#
# Versions pinned to match CI: Node 22, pnpm 9, Python 3, neu exact-pinned in package.json.

# ── Gatekeeper stage ───────────────────────────────────────────────────────
# Cross-compile the Node-free agent gatekeeper (static, stdlib-only Go binary)
# for every target OS/arch. Unit tests run first so a broken gatekeeper fails
# the build. The webview never spawns — this binary is the sole process allowed
# to launch the whitelisted agent CLIs (see SECURITY.md).
FROM golang:1.22-bookworm AS gobuild
WORKDIR /gk
COPY vela-neutralino/extensions/agent/ ./
RUN go test ./...
RUN set -eux; \
    for t in "linux amd64 linux_x64 vela-agent" \
             "linux arm64 linux_arm64 vela-agent" \
             "darwin amd64 mac_x64 vela-agent" \
             "darwin arm64 mac_arm64 vela-agent" \
             "windows amd64 win_x64 vela-agent.exe"; do \
      set -- $t; mkdir -p "/out/$3"; \
      CGO_ENABLED=0 GOOS="$1" GOARCH="$2" go build -trimpath -ldflags="-s -w" -o "/out/$3/$4" . ; \
    done; \
    # mac_universal: Apple-Silicon binary (Intel-mac users use the mac_x64 build).
    mkdir -p /out/mac_universal && cp /out/mac_arm64/vela-agent /out/mac_universal/vela-agent

# ── Build stage ────────────────────────────────────────────────────────────
FROM node:22-bookworm AS build

# python3 (concat/sync/verify scripts) + zip (packaging) + ca-certs (neu update).
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 zip ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# pnpm 9 via corepack (must run as root before dropping privileges).
RUN corepack enable && corepack prepare pnpm@9 --activate

# Run the build as the unprivileged `node` user the base image ships (policy:
# never build as root). Own the workdir so pnpm/neu/python can write into it.
WORKDIR /repo
COPY --chown=node:node . .
USER node

# Install the exact-pinned neu CLI. Flags mirror CI:
#   --ignore-workspace   repo root has pnpm-workspace.yaml we must not pull in
#   --ignore-scripts     no lifecycle scripts (CLAUDE.md policy)
#   --no-frozen-lockfile vela-neutralino has no checked-in lockfile
RUN cd vela-neutralino && pnpm install --ignore-workspace --ignore-scripts --no-frozen-lockfile

# Regenerate the monolith from parts, then preprocess it for the Neutralino shell.
RUN python3 tools/vela-dev/scripts/concat.py src/parts skills/vela-slides/app/vela.jsx \
    && python3 vela-neutralino/scripts/sync-vela.py

# Fetch the pinned Neutralino runtime, verify it against committed SHA256 pins,
# then build single-file binaries (--embed-resources injects resources.neu via
# postject so each platform binary is self-contained).
RUN cd vela-neutralino \
    && ./node_modules/.bin/neu update \
    && python3 scripts/verify-runtime.py \
    && ./node_modules/.bin/neu build --release --embed-resources

# Bring in the cross-compiled gatekeepers.
COPY --from=gobuild /out /gatekeepers

# `neu build` copies the extension SOURCE dir into dist/vela/extensions/agent/.
# Replace it with the compiled binaries so the raw dist/vela output is directly
# runnable (win + linux) and ships no Go source. The per-OS ZIPs below stage the
# correct single binary independently.
RUN set -eux; d=vela-neutralino/dist/vela/extensions/agent; \
    rm -f "$d"/*.go "$d"/go.mod; \
    cp /gatekeepers/win_x64/vela-agent.exe "$d/"; \
    cp /gatekeepers/linux_x64/vela-agent "$d/"

# Package per-OS ZIPs the same way CI does. Each ZIP carries the platform binary
# at the root plus the arch-matched gatekeeper at extensions/agent/ (resolved at
# runtime via ${NL_PATH}/extensions/agent/vela-agent[.exe]).
RUN cd vela-neutralino/dist/vela \
    && for entry in \
        "linux_x64 vela-linux_x64 vela-agent" \
        "linux_arm64 vela-linux_arm64 vela-agent" \
        "mac_x64 vela-mac_x64 vela-agent" \
        "mac_arm64 vela-mac_arm64 vela-agent" \
        "mac_universal vela-mac_universal vela-agent" \
        "win_x64 vela-win_x64.exe vela-agent.exe"; do \
        set -- $entry; os="$1"; bin="$2"; gk="$3"; \
        stage="/tmp/stage/$os"; \
        mkdir -p "$stage/extensions/agent"; \
        cp "$bin" "$stage/$bin"; \
        cp "/gatekeepers/$os/$gk" "$stage/extensions/agent/$gk"; \
        ( cd "$stage" && zip -r "/repo/vela-neutralino/dist/vela-desktop-local-$os.zip" . ); \
    done

# ── Export stage ───────────────────────────────────────────────────────────
# `docker build -o` copies just these artifacts to the host — no container runs,
# nothing is mounted, host node_modules stays clean.
FROM scratch AS export
COPY --from=build /repo/vela-neutralino/dist/vela/ /vela/
COPY --from=build /repo/vela-neutralino/dist/vela-desktop-local-*.zip /
