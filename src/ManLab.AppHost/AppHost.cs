using Aspire.Hosting.ApplicationModel;

var builder = DistributedApplication.CreateBuilder(args);

// Docker Compose environment (used by Aspire Docker hosting integration during publish/deploy).
// Docs: https://learn.microsoft.com/en-us/dotnet/aspire/deployment/docker-integration
var compose = builder.AddDockerComposeEnvironment("compose")
    .WithProperties(env =>
    {
        // Keep network naming stable vs the legacy docker-compose.yml.
        env.DefaultNetworkName = "manlab-network";
    })
    // The dashboard is handy, but we keep it off by default to avoid extra exposed ports.
    .WithDashboard(enabled: false);

// Postgres password is stored in User Secrets (run: dotnet user-secrets set "Parameters:pgpassword" "your-pass")
// Default fallback is provided to avoid startup prompts.
var postgresPassword = builder.AddParameter(
    name: "pgpassword",
    secret: true);

// PostgreSQL server + database.
// IMPORTANT: the database resource name ("manlab") must match the connection name used by the consumer
// (see ManLab.Server: builder.AddNpgsqlDbContext<DataContext>("manlab")).

var postgres = builder.AddPostgres("postgres")
    .WithDataVolume("manlab-db-data")
    .WithPassword(postgresPassword);
var manlabDb = postgres.AddDatabase("manlab");

var server = builder.AddProject<Projects.ManLab_Server>("server")
    .WithHttpHealthCheck("/health")
    .WithReference(manlabDb)
    .WaitFor(manlabDb);

if (builder.ExecutionContext.IsRunMode)
{
    // Dev experience: expose API + Vite dev server.
    server.WithExternalHttpEndpoints();

    builder.AddViteApp("web-dev", "../ManLab.Web")
        .WithExternalHttpEndpoints()
        .WithReference(server)
        .WaitFor(server)
        .WithEndpoint("http", (endpointAnnotation) =>
        {
            endpointAnnotation.Port = 5173;
        })
        // Ensure the dev server binds to an address reachable from the orchestrator.
        .WithArgs("--host", "0.0.0.0");
}
else
{
    // Containerized deployment: build & run services under Docker Compose.
    // Web is an nginx container serving the SPA + reverse proxying /api and /hubs to the server.

    postgres
        .WithComputeEnvironment(compose)
        .PublishAsDockerComposeService((resource, service) =>
        {
            service.Name = "postgres";
        });

    server
        .WithComputeEnvironment(compose)
        // Pin internal container/listening port so the nginx reverse proxy can target it.
        // We modify the existing endpoint instead of adding a new one to avoid name conflicts.
        .WithEndpoint("http", endpoint =>
        {
            endpoint.Port = 8080;
            endpoint.TargetPort = 8080;
            endpoint.IsExternal = false;
        })
        .PublishAsDockerComposeService((resource, service) =>
        {
            // Keep the service name aligned with the resource name so generated
            // references (e.g., depends_on and injected URLs) are consistent.
            service.Name = "server";
        });

    builder.AddDockerfile("web", "../ManLab.Web")
        .WithComputeEnvironment(compose)
        // Expose web on host port 8080, map to container port 80.
        .WithEndpoint(port: 8080, targetPort: 80, scheme: "http", name: "http", isExternal: true)
        .WithReference(server)
        .WaitFor(server)
        .PublishAsDockerComposeService((resource, service) =>
        {
            service.Name = "manlab-web";
        });
}

builder.Build().Run();
