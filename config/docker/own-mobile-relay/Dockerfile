# Own-mobile-relay Coolify image (orca-auth + orca-relay). Not cloud/apps/relay.
# Build context is the repository root.
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN npm install --omit=dev esbuild@0.25.12 ws tweetnacl
COPY scripts/build-own-mobile-relay.mjs scripts/build-own-mobile-relay.mjs
COPY src/main/runtime/ src/main/runtime/
RUN node scripts/build-own-mobile-relay.mjs

FROM node:22-bookworm-slim
RUN useradd --system --uid 10001 --create-home --home-dir /var/lib/own-mobile-relay own-relay \
  && mkdir -p /var/lib/own-mobile-relay \
  && chown -R own-relay:own-relay /var/lib/own-mobile-relay
WORKDIR /app
COPY --from=build --chown=own-relay:own-relay /app/dist-own-mobile-relay /app/dist-own-mobile-relay
USER own-relay
ENV OWN_RELAY_LISTEN_HOST=0.0.0.0
ENV OWN_RELAY_LISTEN_PORT=8093
ENV OWN_RELAY_STATE_PATH=/var/lib/own-mobile-relay/security-state.db
VOLUME /var/lib/own-mobile-relay
EXPOSE 8093
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8093/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist-own-mobile-relay/own-mobile-relay.cjs"]
