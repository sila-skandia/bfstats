FROM alpine

ARG TARGETARCH

RUN apk add --no-cache curl && \
    curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/${TARGETARCH}/kubectl" && \
    chmod +x kubectl && \
    mv kubectl /usr/local/bin/kubectl && \
    apk del curl && \
    rm -rf /var/cache/apk/*

ENTRYPOINT ["sleep", "infinity"]
