# syntax=docker/dockerfile:1
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS base
USER $APP_UID
WORKDIR /app

# Build on the native host platform (amd64) and cross-compile for the target (arm64)
FROM --platform=$BUILDPLATFORM mcr.microsoft.com/dotnet/sdk:10.0 AS build
ARG TARGETARCH
ARG BUILD_CONFIGURATION=Release
ARG PROJECT_PATH
ARG PROJECT_NAME
WORKDIR /src
# Copy entire source tree first to ensure all dependencies can be resolved
COPY . .
# Restore dependencies with the full context
RUN dotnet restore "${PROJECT_PATH}/${PROJECT_NAME}.csproj" -a $TARGETARCH
WORKDIR "/src/${PROJECT_PATH}"
# The Six Labors (ImageSharp) licence is checked at compile time and a Release build fails
# without it. It comes in as a BuildKit secret (Jenkins: --secret id=sixlabors_lic,src=...),
# which is mounted for the one command and never written into a layer. A project that does
# not use ImageSharp ignores the property.
RUN --mount=type=secret,id=sixlabors_lic,required=false \
    dotnet build "${PROJECT_NAME}.csproj" -c $BUILD_CONFIGURATION -o /app/build -a $TARGETARCH \
      -p:SixLaborsLicenseFile=/run/secrets/sixlabors_lic

FROM build AS publish
ARG TARGETARCH
ARG BUILD_CONFIGURATION=Release
ARG PROJECT_NAME
RUN --mount=type=secret,id=sixlabors_lic,required=false \
    dotnet publish "${PROJECT_NAME}.csproj" -c $BUILD_CONFIGURATION -o /app/publish /p:UseAppHost=false -a $TARGETARCH \
      -p:SixLaborsLicenseFile=/run/secrets/sixlabors_lic

FROM base AS final
ARG PROJECT_NAME
# The API's ffmpeg: a studio share's fragmented MP4 is rewritten as a plain one so a link
# preview can read it (api/Shorts/VideoFlattener.cs). Only the API asks for it.
ARG WITH_FFMPEG=false
WORKDIR /app
USER root
RUN if [ "$WITH_FFMPEG" = "true" ]; then \
      apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/* && ffmpeg -version | head -1; \
    fi
COPY --from=publish /app/publish .
RUN echo "#!/bin/sh" > /app/entrypoint.sh && \
    echo "exec dotnet /app/${PROJECT_NAME}.dll \"\$@\"" >> /app/entrypoint.sh && \
    chmod +x /app/entrypoint.sh
USER $APP_UID
ENTRYPOINT ["/app/entrypoint.sh"]
