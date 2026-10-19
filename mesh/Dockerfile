# Static viewer only — models, maps and recordings come from the assets PVC at runtime.

# The official image has no brotli module, so this stage builds ngx_brotli's
# STATIC module (brotli_static: send a pre-written `.br`; it compresses
# nothing and links nothing beyond nginx) against the image's own nginx
# version, from nginx.org source configured `--with-compat` — the official
# binary is built with it too (`nginx -V`), which is what makes a module
# built this way loadable whatever the other configure flags were. Adds ~24 KB
# to the final image and nothing at runtime.
#
# The module's source is vendored in mesh/ngx_brotli_static/ (google/ngx_brotli
# static/ at a71f9312c2deb28875acc7bacfdd5695a111aa53, BSD-2-Clause): the
# Jenkins builders cannot download GitHub archives (the connection stalls and
# is reset, every build of 2026-10-20).
FROM nginx:stable-alpine AS brotli-build
COPY mesh/ngx_brotli_static/ /tmp/ngx_brotli_static/
RUN apk add --no-cache build-base pcre2-dev zlib-dev curl \
    && curl -fsSL --retry 5 --retry-all-errors --retry-delay 5 \
       -o /tmp/nginx.tar.gz "https://nginx.org/download/nginx-${NGINX_VERSION}.tar.gz" \
    && tar xzf /tmp/nginx.tar.gz -C /tmp \
    && cd "/tmp/nginx-${NGINX_VERSION}" \
    && ./configure --with-compat --add-dynamic-module=/tmp/ngx_brotli_static \
    && make -j"$(nproc)" modules

FROM nginx:stable-alpine

COPY tools/bf1942-models/viewer/ /usr/share/nginx/html/

# Local extract trees must never ship in the image; the PVC mounts replace these.
RUN rm -rf /usr/share/nginx/html/models /usr/share/nginx/html/maps /usr/share/nginx/html/replays \
           /usr/share/nginx/html/glbs \
    && mkdir -p /usr/share/nginx/html/models /usr/share/nginx/html/maps /usr/share/nginx/html/replays \
                /usr/share/nginx/html/glbs

# FileBrowser (uid and gid 1000) uploads files 0640 in folders 0750, and the
# pod's fsGroup keeps the volume group 1000. nginx's workers drop to the nginx
# user and only its groups, so a file uploaded by hand would 403 without this
# (features/gameplay-recordings). The publish scripts' chmod a+rX still stands.
RUN addgroup -g 1000 assets && addgroup nginx assets

# njs sets X-File-Size on a pre-compressed glb (mesh/file-size.js). The
# official image ships that module; brotli_static comes from the build stage
# above. The main config has to load both.
COPY --from=brotli-build /tmp/nginx-*/objs/ngx_http_brotli_static_module.so /usr/lib/nginx/modules/
RUN sed -i '1i load_module modules/ngx_http_js_module.so;\nload_module modules/ngx_http_brotli_static_module.so;' /etc/nginx/nginx.conf
COPY mesh/file-size.js /etc/nginx/njs/file-size.js
COPY mesh/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
