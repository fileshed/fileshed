# ---------------------------------------------------------------------------------------------------------------------
# FileShed — single-image build: the Hono server serves both the API and the built client.
#
# The server runs TypeScript natively, so no server compile happens here: the runtime image carries the server and core
# SOURCES plus production node_modules; only the client gets built. No compiler toolchain is installed -- every
# dependency the server loads is pure JavaScript, SQLite included, since that one is node:sqlite from the runtime.
#
# Two install stages. `build` installs the whole workspace to run Vite; nothing from its node_modules reaches the
# runtime image. `deps` installs only what the server imports at runtime -- pruning the workspace install instead
# leaves the client's own production tree behind (Vue, Nuxt UI, TipTap, CodeMirror, pdfjs-dist), every byte of it
# already compiled into client-dist.
#
# `build` pins to $BUILDPLATFORM so a multi-arch build runs Vite once, natively, instead of once per target under
# emulation. `deps` deliberately does not pin, so each target installs its own architecture's binaries; it compiles
# nothing, so emulation is cheap.
# ---------------------------------------------------------------------------------------------------------------------

FROM --platform=$BUILDPLATFORM node:26-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY src/client/package.json src/client/
COPY src/server/package.json src/server/
RUN npm ci

COPY tsconfig.json eslint.config.js ./
COPY packages ./packages
COPY src ./src
RUN npm run build -w @fileshed/client

# ---------------------------------------------------------------------------------------------------------------------

FROM node:26-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY src/client/package.json src/client/
COPY src/server/package.json src/server/
RUN npm ci --omit=dev \
    --workspace @fileshed/server \
    --workspace @fileshed/core \
    --include-workspace-root

# ---------------------------------------------------------------------------------------------------------------------

FROM node:26-alpine
WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    CLIENT_DIST=./client-dist \
    DATABASE_KIND=sqlite \
    DATABASE_PATH=/data/fileshed.db \
    AUTH_SECRET_FILE=/data/auth-secret \
    STORAGE_ROOT=/data/blobs

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./package.json
COPY config ./config
COPY packages ./packages
COPY src/server ./src/server
COPY --from=build /app/src/client/dist ./client-dist

VOLUME /data
EXPOSE 3000

# node:sqlite prints an ExperimentalWarning on every boot; the API reached release-candidate status and the driver
# is wrapped by our own dialect, so the packaged product silences the noise. Source runs still see the warning.
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server/server.ts"]

# ---------------------------------------------------------------------------------------------------------------------
