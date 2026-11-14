# drydock sandbox: the only place agent-issued commands run. Holds no credentials.
FROM node:22-alpine
RUN apk add --no-cache git \
 && mkdir -p /work \
 && chown node:node /work
USER node
WORKDIR /work
