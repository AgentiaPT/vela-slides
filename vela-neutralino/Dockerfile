# Reproducible Neutralino release build for Vela desktop.
#
# A single Linux build emits per-OS binaries: `neu build --release` bundles the
# prebuilt Neutralino runtimes that `neu update` downloaded, so dist/vela/ ends
# up with the win/linux/mac executables regardless of build host.
#
# Build context MUST be the repo root (this stage reads ../skills via the
# checked-in tree), e.g.:
#   docker build -f vela-neutralino/Dockerfile --target export \
#     --output type=local,dest=vela-neutralino/dist-docker .
#
# The `export` target writes only dist/vela to the host — nothing is run as a
# privileged container and no host paths are mounted.

# ── build stage ───────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS build

# Toolchain: python3 (concat/sync/verify), bash (build scripts), unzip (neu
# update extracts runtime archives), ca-certificates (TLS for downloads).
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      python3 bash unzip ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# Install the `neu` CLI off-tree (mirrors scripts/setup.sh) so the project dir
# stays free of node_modules and the parent pnpm workspace is ignored. Pin must
# match vela-neutralino/package.json devDependencies["@neutralinojs/neu"].
ENV NEU_TOOLS=/opt/neu-tools
ENV PATH=$NEU_TOOLS/node_modules/.bin:$PATH
COPY vela-neutralino/.npmrc $NEU_TOOLS/.npmrc
RUN printf '%s\n' \
      '{' \
      '  "name": "vela-neutralino-tools",' \
      '  "version": "0.0.0",' \
      '  "private": true,' \
      '  "devDependencies": { "@neutralinojs/neu": "11.7.1" }' \
      '}' > $NEU_TOOLS/package.json \
 && cd $NEU_TOOLS \
 && CI=true pnpm install --ignore-scripts --ignore-workspace \
 && chmod -R a+rX $NEU_TOOLS

# Non-root build user (node uid 1000 ships with the base image).
WORKDIR /work
COPY --chown=node:node . /work
USER node

# 1. Rebuild the monolith from parts so resources track the latest source.
# 2. neu update → bin/ runtime + client lib (network).
# 3. verify-runtime → SHA256 pins must match the committed checksums.
# 4. sync-vela → resources/vela.jsx.
# 5. neu build → dist/vela/ per-OS, resources embedded.
RUN python3 skills/vela-slides/scripts/concat.py \
 && cd vela-neutralino \
 && neu update \
 && python3 scripts/verify-runtime.py \
 && python3 scripts/sync-vela.py \
 && neu build --release --embed-resources

# ── export stage ──────────────────────────────────────────────────────────
# `--output type=local` copies just the artefacts to the host.
FROM scratch AS export
COPY --from=build /work/vela-neutralino/dist/ /
