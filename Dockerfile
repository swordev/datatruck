FROM node:16-alpine

# datatruck

RUN apk add --no-cache \
    restic \
    git \
    less \
    mariadb-client \
    mariadb-backup \
    postgresql-client \
    python3 \
    pigz

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

# 7zip v22

RUN apk add --no-cache --virtual tmp \
    sudo \ 
    build-base \ 
    alpine-sdk \
    curl \
    && adduser -D packager  \
    && addgroup packager abuild  \
    && echo 'packager ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/packager

USER packager
ARG P7ZIP_VERSION=c0a89835494c9292f36b1f4596b910830d3818bc

RUN cd /home/packager \
    && abuild-keygen -a -i -n \
    && curl https://git.alpinelinux.org/aports/plain/community/7zip/7-zip-flags.patch?h=$P7ZIP_VERSION > 7-zip-flags.patch \
    && curl https://git.alpinelinux.org/aports/plain/community/7zip/7-zip-musl.patch?h=$P7ZIP_VERSION > 7-zip-musl.patch \
    && curl https://git.alpinelinux.org/aports/plain/community/7zip/APKBUILD?h=$P7ZIP_VERSION > APKBUILD \
    && abuild -r

USER root
RUN apk add /home/packager/packages/home/x86_64/7zip-22.01-r0.apk \
    && apk del tmp \
    && delgroup packager abuild \
    && deluser --remove-home packager \
    && rm /etc/sudoers.d/packager

ENTRYPOINT ["docker-entrypoint.sh"]