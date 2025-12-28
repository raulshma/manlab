# syntax=docker/dockerfile:1

# Build stage (run on the builder's native architecture)
FROM --platform=$BUILDPLATFORM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# Copy project files first for better layer caching
COPY ["src/ManLab.Server/ManLab.Server.csproj", "ManLab.Server/"]
COPY ["src/ManLab.Shared/ManLab.Shared.csproj", "ManLab.Shared/"]
COPY ["src/ManLab.ServiceDefaults/ManLab.ServiceDefaults.csproj", "ManLab.ServiceDefaults/"]

# Restore dependencies
RUN dotnet restore "ManLab.Server/ManLab.Server.csproj"

# Copy scripts (embedded resources)
COPY ["scripts/", "/scripts/"]

# Copy source code
COPY ["src/ManLab.Server/", "ManLab.Server/"]
COPY ["src/ManLab.Shared/", "ManLab.Shared/"]
COPY ["src/ManLab.ServiceDefaults/", "ManLab.ServiceDefaults/"]

# Build and publish
RUN dotnet publish "ManLab.Server/ManLab.Server.csproj" \
    -c Release \
    -o /app/publish

# Ensure the Distribution folder exists and will be owned by the runtime user.
RUN mkdir -p /app/publish/Distribution

# Runtime stage
FROM mcr.microsoft.com/dotnet/aspnet:10.0-alpine AS runtime
WORKDIR /app

# Copy published app
COPY --from=build --chown=app:app /app/publish .

# Switch to non-root user
USER app

# Expose ports
EXPOSE 8080 8081

# Health check (wget is provided by BusyBox in Alpine)
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD wget -qO- http://localhost:8080/health >/dev/null || exit 1

# Set environment variables
ENV ASPNETCORE_URLS=http://+:8080 \
    ASPNETCORE_ENVIRONMENT=Production \
    DOTNET_RUNNING_IN_CONTAINER=true

ENTRYPOINT ["dotnet", "ManLab.Server.dll"]
