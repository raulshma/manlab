using ManLab.Server.Data;
using ManLab.Server.Hubs;
using ManLab.Server.Services;
using ManLab.Server.Services.Agents;
using ManLab.Server.Services.Commands;
using Microsoft.EntityFrameworkCore;
using Scalar.AspNetCore;

var builder = WebApplication.CreateBuilder(args);

// Add Aspire ServiceDefaults for observability, service discovery, and default health endpoints.
builder.AddServiceDefaults();

// Add services to the container.
builder.Services.AddOpenApi();
builder.Services.AddControllers();
builder.Services.AddSignalR();

builder.Services.AddMemoryCache();

builder.Services.AddOptions<ManLab.Server.Services.Ssh.SshProvisioningOptions>()
    .Bind(builder.Configuration.GetSection(ManLab.Server.Services.Ssh.SshProvisioningOptions.SectionName));

// Onboarding services
builder.Services.AddScoped<EnrollmentTokenService>();
builder.Services.AddScoped<ManLab.Server.Services.Ssh.SshProvisioningService>();
builder.Services.AddScoped<ManLab.Server.Services.Ssh.SshAuditService>();
builder.Services.AddSingleton<ManLab.Server.Services.Ssh.SshRateLimitService>();
builder.Services.AddSingleton<OnboardingJobRunner>();
builder.Services.AddSingleton<LocalAgentInstallationService>();

builder.Services.AddHttpClient();
builder.Services.AddOptions<DiscordOptions>()
    .Bind(builder.Configuration.GetSection(DiscordOptions.SectionName))
    .Validate(o => string.IsNullOrWhiteSpace(o.WebhookUrl) || Uri.IsWellFormedUriString(o.WebhookUrl, UriKind.Absolute),
        "Discord:WebhookUrl must be a valid absolute URL when provided");

builder.Services.AddOptions<BinaryDistributionOptions>()
    .Bind(builder.Configuration.GetSection(BinaryDistributionOptions.SectionName));

builder.Services.AddSingleton<INotificationService, DiscordWebhookNotificationService>();

// Agent connection tracking + command dispatch
builder.Services.AddSingleton<AgentConnectionRegistry>();
builder.Services.AddHostedService<CommandDispatchService>();

// Background services
builder.Services.AddHostedService<HealthMonitorService>();

// Configure Entity Framework Core with PostgreSQL via Aspire integration.
// The connection name ("manlab") must match the database resource name in the AppHost.
builder.AddNpgsqlDbContext<DataContext>(connectionName: "manlab");

var app = builder.Build();

// Ensure the database schema exists before hosted services start querying it.
// This prevents runtime errors like: relation "Nodes" does not exist.
await using (var scope = app.Services.CreateAsyncScope())
{
    var logger = scope.ServiceProvider
        .GetRequiredService<ILoggerFactory>()
        .CreateLogger("ManLab.Server.DatabaseMigration");

    try
    {
        var dbContext = scope.ServiceProvider.GetRequiredService<DataContext>();
        await dbContext.Database.MigrateAsync();
    }
    catch (Exception ex)
    {
        logger.LogCritical(ex, "Database migration failed");
        throw;
    }
}

// Map Aspire ServiceDefaults endpoints (/health and /alive in development).
app.MapDefaultEndpoints();

// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
    app.MapScalarApiReference();
}

app.MapControllers();
app.MapHub<AgentHub>("/hubs/agent");

app.Run();

