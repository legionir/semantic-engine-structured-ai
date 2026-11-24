FROM node:22-bookworm-slim

WORKDIR /app
COPY package.json ./
COPY agent ./agent
COPY bin ./bin
COPY web ./web
COPY README.md ./README.md

ENV NODE_ENV=production
ENV WORKSPACE_ROOT=/workspace
ENV AGENT_APPROVAL=deny
ENV ALLOW_UNSANDBOXED_PROCESS=false

RUN groupadd --system structured && useradd --system --gid structured structured \
  && mkdir -p /workspace \
  && chown -R structured:structured /app /workspace

USER structured
VOLUME ["/workspace"]
ENTRYPOINT ["node", "bin/agent.js"]
