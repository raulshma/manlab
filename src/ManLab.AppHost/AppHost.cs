using Aspire.Hosting.ApplicationModel;

var builder = DistributedApplication.CreateBuilder(args);

// Postgres password is stored in User Secrets (run: dotnet user-secrets set "Parameters:pgpassword" "your-pass")
// Default fallback is provided to avoid startup prompts.
var postgresPassword = builder.AddParameter(
    name: "pgpassword",
    secret: true);

// PostgreSQL server + database.
// IMPORTANT: the database resource name ("manlab") must match the connection name used by the consumer
// (see ManLab.Server: builder.AddNpgsqlDbContext<DataContext>("manlab")).

var postgres = builder.AddPostgres("postgres")
    .WithDataVolume("manlab-pg-data")
    .WithPassword(postgresPassword);
var manlabDb = postgres.AddDatabase("manlab");

var server = builder.AddProject<Projects.ManLab_Server>("server")
    .WithExternalHttpEndpoints()
    .WithHttpHealthCheck("/health")
    .WithReference(manlabDb)
    .WaitFor(manlabDb);

var web = builder.AddViteApp("web", "../ManLab.Web")
    .WithExternalHttpEndpoints()
    .WithReference(server)
    .WaitFor(server)
    // Ensure the dev server binds to an address reachable from the orchestrator.
    .WithArgs("--host", "0.0.0.0");

builder.Build().Run();
