FROM node:16-alpine
RUN apk add --no-cache \
    p7zip \
    restic \
    git \
    less \
    mariadb-client \
    mariadb-backup \
    postgresql-client \
    python3

ENV NODE_PATH=/usr/local/lib/node_modules
ARG BIN_PATH=/usr/local/bin/datatruck
ARG SHORTBIN_PATH=/usr/local/bin/dtt
ARG ENTRYPOINT_PATH=/usr/local/bin/docker-entrypoint.sh

WORKDIR /var/lib/datatruck/
COPY . /var/lib/datatruck

RUN set -x \
    && npm install -g pnpm@7 \
    && pnpm install \
    && pnpm build \
    && pnpm compose \
    && echo "#!/bin/sh" > $BIN_PATH \
    && echo "node /var/lib/datatruck/packages/cli/lib/bin.js \"\$@\"" >> $BIN_PATH \
    && cp "/var/lib/datatruck/docker/docker-entrypoint.sh" $ENTRYPOINT_PATH \
    && cp $BIN_PATH $SHORTBIN_PATH \
    && chmod +x $BIN_PATH $SHORTBIN_PATH $ENTRYPOINT_PATH \
    && mkdir -p "/usr/local/lib/node_modules/@datatruck" \
    && ln -s "/var/lib/datatruck/packages/cli/lib" "/usr/local/lib/node_modules/@datatruck/cli" \
    && pnpm prune --production \
    && npm uninstall -g pnpm

ENTRYPOINT ["docker-entrypoint.sh"]