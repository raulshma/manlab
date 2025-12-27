using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Microsoft.Extensions.Configuration;
using ManLab.Server.Services.Persistence;

namespace ManLab.Server.Data;

/// <summary>
/// Design-time factory used by EF Core tooling (dotnet-ef) to create <see cref="DataContext"/>
/// when scaffolding migrations.
///
/// This is required because the runtime wiring uses Aspire's <c>AddNpgsqlDbContext</c>, which
/// depends on the distributed app host to provide connection details.
/// </summary>
public sealed class DataContextFactory : IDesignTimeDbContextFactory<DataContext>
{
    public DataContext CreateDbContext(string[] args)
    {
        var environmentName =
            Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT") ??
            Environment.GetEnvironmentVariable("DOTNET_ENVIRONMENT") ??
            "Development";

        // At design time, the working directory can be either the project directory
        // or the repo root (depending on how dotnet-ef was invoked).
        // Locate the ManLab.Server project directory so we load the expected appsettings.
        var currentDir = Directory.GetCurrentDirectory();
        var serverDirCandidates = new[]
        {
            currentDir,
            Path.Combine(currentDir, "src", "ManLab.Server"),
        };

        var serverDir = serverDirCandidates.FirstOrDefault(d =>
            Directory.Exists(d) && File.Exists(Path.Combine(d, "appsettings.json")))
            ?? currentDir;

        var configuration = new ConfigurationBuilder()
            .SetBasePath(serverDir)
            .AddJsonFile("appsettings.json", optional: true)
            .AddJsonFile($"appsettings.{environmentName}.json", optional: true)
            .AddEnvironmentVariables()
            .Build();

        // Prefer the Aspire connection name ("manlab"), but fall back to the existing
        // conventional name used in local dev settings.
        var connectionString =
            configuration.GetConnectionString("manlab") ??
            configuration.GetConnectionString("DefaultConnection");

        // Migrations scaffolding doesn't require a live database connection, but EF Core
        // still requires a connection string to configure the provider.
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            connectionString = "Host=localhost;Port=5432;Database=manlab;Username=manlab;Password=manlab_secret";
        }

        var optionsBuilder = new DbContextOptionsBuilder<DataContext>();
        optionsBuilder.UseNpgsql(connectionString);
        optionsBuilder.AddInterceptors(new BoundedTextSaveChangesInterceptor());

        return new DataContext(optionsBuilder.Options);
    }
}
