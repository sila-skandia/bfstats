# bfstats-netcode: the BF1942 multiplayer room server (P2 of
# features/netcode-play-multiplayer/README.md).
#
# One Node process, no framework: `server.mjs` owns the WebSocket endpoint
# (WS on /netcode, one JSON GET on /netcode/rooms) and imports the viewer
# sim modules headless — world.js, soldier.js, seats.js, netcode.js,
# collision.js, physics.js, ... — the same modules map.html runs in the
# browser, stepped at 30 Hz with no renderer. It serves no static files.
#
# The viewer tree is copied wholesale (the mesh image's rule): a module the
# server starts importing must not be absent in production because someone
# forgot a COPY line. The local extract trees never ship — .dockerignore
# excludes them and the RUN below empties the targets so the PVC mounts have
# mount points.
#
# MOUNT CONTRACT: the image fixes /app/server/server.mjs as the entrypoint
# and mounts the assets PVC read-only over /app/viewer/maps and
# /app/viewer/models, so the server reads scene.json, the scene.glb JSON
# chunks, the vehicle glbs and the damage tables through --viewer /app/viewer
# at exactly the same-relative paths the modules use against a worktree. The
# server has no write path; all level data comes from the volume at runtime.
FROM node:22-alpine

WORKDIR /app

COPY tools/bf1942-models/viewer/ /app/viewer/
COPY tools/bf1942-models/server/ /app/server/

# Viewer modules import the bare specifier `three` (an import-map entry in
# the page; e.g. seats.js:17). Node needs a real package, so the vendored
# three.module.js is published as one — the same trick the test harnesses
# use (tests/test_flight.py, run_harness). /app/node_modules is the walk-up
# root for every module under both /app/viewer and /app/server, so one copy
# serves the whole tree.
COPY tools/bf1942-models/viewer/vendor/three.module.js /app/node_modules/three/three.module.js
RUN printf '%s' '{"name":"three","version":"0.0.0","type":"module","main":"three.module.js","exports":"./three.module.js"}' > /app/node_modules/three/package.json

# Local extract trees must never ship in the image; the PVC mounts replace
# these (same belt-and-braces as mesh/Dockerfile — dockerignore keeps them
# out of the context, and this keeps a local tree out of a hand-built image
# and guarantees the mount points exist).
RUN rm -rf /app/viewer/models /app/viewer/maps \
    && mkdir -p /app/viewer/models /app/viewer/maps

EXPOSE 8080
CMD ["node", "/app/server/server.mjs", "--port", "8080", "--viewer", "/app/viewer"]