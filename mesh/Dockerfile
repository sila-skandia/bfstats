# Static viewer only — models and maps come from the assets PVC at runtime.
FROM nginx:stable-alpine

COPY tools/bf1942-models/viewer/ /usr/share/nginx/html/

# Local extract trees must never ship in the image; the PVC mounts replace these.
RUN rm -rf /usr/share/nginx/html/models /usr/share/nginx/html/maps \
    && mkdir -p /usr/share/nginx/html/models /usr/share/nginx/html/maps

COPY mesh/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
