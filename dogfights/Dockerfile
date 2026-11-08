# bfstats-dogfights: the job that keeps the dogfight school's Fights list
# fresh (deploy/app/dogfights-cronjob.yaml, features/dogfight-recordings).
#
# One Node process, refresh.mjs, which runs tools/bf1942-models/
# extract_dogfights.mjs: the detector and the recording reader are the
# viewer's own modules, so the image carries the viewer tree wholesale (the
# mesh and netcode images' rule) at the relative paths the extractor expects.
# Built from the same commit as the mesh image, the fights it writes are the
# ones the deployed school can read.
#
# MOUNT CONTRACT (the CronJob): the API's recordings volume read-only at
# /recordings, the assets volume's mesh/models read-only at /models (the
# aircraft catalogues), and mesh/replays read-write at /replays.
FROM node:22-alpine

WORKDIR /app

COPY tools/bf1942-models/viewer/ /app/tools/bf1942-models/viewer/
COPY tools/bf1942-models/sim/ /app/tools/bf1942-models/sim/
COPY tools/bf1942-models/extract_dogfights.mjs /app/tools/bf1942-models/
COPY dogfights/refresh.mjs /app/dogfights/

# Local extract trees never ship (.dockerignore keeps them out of the
# context; this keeps them out of a hand-built image too). VERSION is the
# code's hash: refresh.mjs rebuilds the list when it changes, so a detector
# fix reaches every fight on the next run without waiting for an upload.
RUN rm -rf /app/tools/bf1942-models/viewer/models /app/tools/bf1942-models/viewer/maps \
           /app/tools/bf1942-models/viewer/replays /app/tools/bf1942-models/viewer/dogfights \
           /app/tools/bf1942-models/viewer/glbs /app/tools/bf1942-models/viewer/textures \
    && find /app -type f | sort | xargs sha256sum | sha256sum | cut -c1-12 > /app/dogfights/VERSION

USER 1000:1000
CMD ["node", "/app/dogfights/refresh.mjs"]
