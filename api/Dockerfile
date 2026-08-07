FROM gradle:8.14.3-jdk21 AS build
WORKDIR /workspace
COPY gradle gradle
COPY gradlew gradlew
COPY gradlew.bat gradlew.bat
COPY settings.gradle.kts build.gradle.kts ./
COPY src src
RUN ./gradlew --no-daemon clean bootJar

FROM eclipse-temurin:21-jre
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
RUN useradd --system --uid 10001 --create-home ownkeep
WORKDIR /app
COPY --from=build /workspace/build/libs/ownkeep-api-*.jar app.jar
RUN mkdir -p /data/attachments && chown -R ownkeep:ownkeep /data
USER ownkeep
ENV OWNKEEP_ATTACHMENT_STORAGE_ROOT=/data/attachments
EXPOSE 8080
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75.0", "-jar", "/app/app.jar"]
