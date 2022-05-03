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

WORKDIR /var/lib/datatruck/
COPY . /var/lib/datatruck

RUN set -x \
    && npm install -g pnpm@6 \
    && pnpm install \
    && pnpm build \
    && BIN_PATH=/usr/local/bin/datatruck \
    && ALTBIN_PATH=/usr/local/bin/dtt \
    && echo "#!/bin/sh" > $BIN_PATH \
    && echo "node /var/lib/datatruck/packages/cli/lib/bin.js \"\$@\"" >> $BIN_PATH \
    && cp $BIN_PATH $ALTBIN_PATH \
    && chmod +x $BIN_PATH $ALTBIN_PATH \
    && pnpm prune --production \
    && npm uninstall -g pnpm