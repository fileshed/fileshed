# ---------------------------------------------------------------------------------------------------------------------
# FileShed — single-image build: the Hono server serves both the API and the built client.
#
# The server runs TypeScript natively, so no server compile happens here: the runtime image carries the server and core
# SOURCES plus production node_modules; only the client gets built. Nothing in the tree is a native addon -- SQLite is
# node:sqlite, part of the runtime itself -- so no compiler toolchain is installed and no architecture needs a prebuild.
# ---------------------------------------------------------------------------------------------------------------------

FROM node:26-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY src/client/package.json src/client/
COPY src/server/package.json src/server/
RUN npm ci

COPY tsconfig.json eslint.config.js ./
COPY packages ./packages
COPY src ./src
RUN npm run build -w @fileshed/client \
    && npm prune --omit=dev

# ---------------------------------------------------------------------------------------------------------------------

FROM node:26-alpine
WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    CLIENT_DIST=./client-dist \
    DATABASE_KIND=sqlite \
    DATABASE_PATH=/data/fileshed.db \
    STORAGE_ROOT=/data/blobs

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY config ./config
COPY --from=build /app/packages ./packages
COPY --from=build /app/src/server ./src/server
COPY --from=build /app/src/client/dist ./client-dist

VOLUME /data
EXPOSE 3000

# node:sqlite prints an ExperimentalWarning on every boot; the API reached release-candidate status and the driver
# is wrapped by our own dialect, so the packaged product silences the noise. Source runs still see the warning.
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server/server.ts"]

# ---------------------------------------------------------------------------------------------------------------------
