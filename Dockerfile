# Unified OwnKeep image: React SPA + Spring Boot API on one port.
# Postgres remains a separate service.

FROM node:24-alpine AS web-build
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM gradle:8.14.3-jdk21 AS api-build
WORKDIR /workspace
COPY api/gradle gradle
COPY api/gradlew api/gradlew.bat api/settings.gradle.kts api/build.gradle.kts ./
COPY api/src src
COPY --from=web-build /web/dist/ src/main/resources/static/
RUN ./gradlew --no-daemon clean bootJar

FROM eclipse-temurin:21-jre
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
RUN useradd --system --uid 10001 --create-home ownkeep
WORKDIR /app
COPY --from=api-build /workspace/build/libs/ownkeep-api-*.jar app.jar
RUN mkdir -p /data/attachments && chown -R ownkeep:ownkeep /data
USER ownkeep
ENV OWNKEEP_ATTACHMENT_STORAGE_ROOT=/data/attachments
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=5 \
    CMD curl --fail --silent http://127.0.0.1:8080/api/health > /dev/null || exit 1
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75.0", "-jar", "/app/app.jar"]
