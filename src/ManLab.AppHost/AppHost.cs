using Aspire.Hosting.ApplicationModel;

var builder = DistributedApplication.CreateBuilder(args);

// PostgreSQL server + database.
// IMPORTANT: the database resource name ("manlab") must match the connection name used by the consumer
// (see ManLab.Server: builder.AddNpgsqlDbContext<DataContext>("manlab")).

var manlabDb = builder.AddPostgres("postgres")
    .WithLifetime(ContainerLifetime.Persistent)
    .WithDataVolume()
    .AddDatabase("manlab");

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
