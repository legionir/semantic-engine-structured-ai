FROM node:22-bookworm-slim AS dependencies

WORKDIR /app
COPY package.json package-lock.json ./
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && npm ci --omit=dev

FROM node:22-bookworm-slim

WORKDIR /app
COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node agent ./agent
COPY --chown=node:node bin ./bin
COPY --chown=node:node web ./web
COPY --chown=node:node README.md ./README.md

ENV NODE_ENV=production
ENV WORKSPACE_ROOT=/workspace
ENV AGENT_APPROVAL=deny
ENV ALLOW_UNSANDBOXED_PROCESS=false

RUN groupadd --system structured && useradd --system --gid structured --home-dir /home/structured structured \
  && mkdir -p /workspace /home/structured \
  && chown -R structured:structured /app /workspace /home/structured

USER structured
VOLUME ["/workspace"]
EXPOSE 7777
ENTRYPOINT ["node", "bin/agent.js"]
