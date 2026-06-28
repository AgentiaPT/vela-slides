# Reproducible Neutralino desktop build — mirrors .github/workflows/_build-desktop.yml.
#
# Produces the same single-file per-OS binaries CI ships, but locally via Docker
# so a workstation needs neither Node/pnpm nor the `neu` CLI on PATH.
#
# Run from the REPO ROOT (build context must include skills/ for concat + sync):
#
#   docker build -f vela-neutralino/Dockerfile -o type=local,dest=vela-neutralino/dist .
#
# Output lands in vela-neutralino/dist/:
#   vela/vela-{linux_x64,linux_arm64,mac_x64,mac_arm64,mac_universal,win_x64.exe}
#   vela-desktop-local-*.zip
#
# Versions pinned to match CI: Node 22, pnpm 9, Python 3, neu exact-pinned in package.json.

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
RUN python3 skills/vela-slides/scripts/concat.py \
    && python3 vela-neutralino/scripts/sync-vela.py

# Fetch the pinned Neutralino runtime, verify it against committed SHA256 pins,
# then build single-file binaries (--embed-resources injects resources.neu via
# postject so each platform binary is self-contained).
RUN cd vela-neutralino \
    && ./node_modules/.bin/neu update \
    && python3 scripts/verify-runtime.py \
    && ./node_modules/.bin/neu build --release --embed-resources

# Package per-OS ZIPs the same way CI does.
RUN cd vela-neutralino/dist/vela \
    && for entry in \
        "linux_x64 vela-linux_x64" \
        "linux_arm64 vela-linux_arm64" \
        "mac_x64 vela-mac_x64" \
        "mac_arm64 vela-mac_arm64" \
        "mac_universal vela-mac_universal" \
        "win_x64 vela-win_x64.exe"; do \
        set -- $entry; \
        zip -j "../vela-desktop-local-$1.zip" "$2"; \
    done

# ── Export stage ───────────────────────────────────────────────────────────
# `docker build -o` copies just these artifacts to the host — no container runs,
# nothing is mounted, host node_modules stays clean.
FROM scratch AS export
COPY --from=build /repo/vela-neutralino/dist/vela/ /vela/
COPY --from=build /repo/vela-neutralino/dist/vela-desktop-local-*.zip /
