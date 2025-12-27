# Build stage
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
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
    -o /app/publish \
    --no-restore

# Runtime stage
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app

# Create non-root user for security
RUN adduser --disabled-password --gecos '' --uid 1000 appuser

# Copy published app
COPY --from=build /app/publish .

# Create Distribution directory for agent binaries (if staging locally)
RUN mkdir -p /app/Distribution && chown appuser:appuser /app/Distribution

# Switch to non-root user
USER appuser

# Expose ports
EXPOSE 8080 8081

# Health check (using wget which is available in debian-based images)
# Note: Install curl if preferred: apt-get update && apt-get install -y curl
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

# Set environment variables
ENV ASPNETCORE_URLS=http://+:8080 \
    ASPNETCORE_ENVIRONMENT=Production \
    DOTNET_RUNNING_IN_CONTAINER=true

ENTRYPOINT ["dotnet", "ManLab.Server.dll"]
