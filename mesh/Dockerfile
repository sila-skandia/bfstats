# Static viewer only — models, maps and recordings come from the assets PVC at runtime.
FROM nginx:stable-alpine

COPY tools/bf1942-models/viewer/ /usr/share/nginx/html/

# Local extract trees must never ship in the image; the PVC mounts replace these.
RUN rm -rf /usr/share/nginx/html/models /usr/share/nginx/html/maps /usr/share/nginx/html/replays \
    && mkdir -p /usr/share/nginx/html/models /usr/share/nginx/html/maps /usr/share/nginx/html/replays

# FileBrowser (uid and gid 1000) uploads files 0640 in folders 0750, and the
# pod's fsGroup keeps the volume group 1000. nginx's workers drop to the nginx
# user and only its groups, so a file uploaded by hand would 403 without this
# (features/gameplay-recordings). The publish scripts' chmod a+rX still stands.
RUN addgroup -g 1000 assets && addgroup nginx assets

# njs sets X-File-Size on a pre-compressed glb (mesh/file-size.js). The
# official image ships the module; the main config has to load it.
RUN sed -i '1i load_module modules/ngx_http_js_module.so;' /etc/nginx/nginx.conf
COPY mesh/file-size.js /etc/nginx/njs/file-size.js
COPY mesh/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
