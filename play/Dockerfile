# play.bfstats.io - BF1942 in the browser.
#
# The same static-nginx shape as mesh/Dockerfile over the same assets PVC,
# carrying a different set of pages: the Instant Battle screen, the map page
# and the modules `map.html` imports. The model, pose and kit browsers stay
# on mesh.bfstats.io.
#
# `viewer/` is copied wholesale and then cut back, rather than copied file by
# file: a new module that `map.html` starts importing must not 404 in
# production because someone forgot to add a COPY line. The three pages left
# out are named explicitly, so leaving one out is a deliberate act.
FROM nginx:stable-alpine

COPY tools/bf1942-models/viewer/ /usr/share/nginx/html/

# Two removals:
#  - the browsers belong to the mesh site. nginx redirects their paths there
#    (see play/nginx.conf), so the viewer's own nav bar still works here.
#  - local extract trees must never ship in the image; the PVC mounts replace
#    them. `play/pack-dev` is a worktree-only symlink into a scratch build of
#    the menu pack and must never reach an image either.
RUN rm -f /usr/share/nginx/html/index.html \
          /usr/share/nginx/html/poses.html \
          /usr/share/nginx/html/kits.html \
 && rm -rf /usr/share/nginx/html/models \
           /usr/share/nginx/html/maps \
           /usr/share/nginx/html/play/pack-dev \
 && mkdir -p /usr/share/nginx/html/models /usr/share/nginx/html/maps

COPY play/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
