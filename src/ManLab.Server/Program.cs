using ManLab.Server.Data;
using ManLab.Server.Hubs;
using ManLab.Server.Services;
using ManLab.Server.Services.Agents;
using ManLab.Server.Services.Commands;
using ManLab.Server.Services.Enhancements;
using ManLab.Server.Services.Persistence;
using ManLab.Server.Services.Retention;
using ManLab.Shared.Dtos;
using Microsoft.EntityFrameworkCore;
using Scalar.AspNetCore;

var builder = WebApplication.CreateBuilder(args);

// Add Aspire ServiceDefaults for observability, service discovery, and default health endpoints.
builder.AddServiceDefaults();

// Add services to the container.
builder.Services.AddOpenApi();
builder.Services
    .AddControllers()
    .AddJsonOptions(options =>
    {
        // Reuse source-generated metadata for DTOs to reduce reflection and allocations.
        // This also keeps JSON shape consistent between Server <-> Agent.
        options.JsonSerializerOptions.TypeInfoResolverChain.Insert(0, ManLabJsonContext.Default);
    });

builder.Services
    .AddSignalR(hubOptions =>
    {
        // Keep defaults mostly intact, but make timeouts explicit and aligned with SignalR guidance:
        // ClientTimeoutInterval should be ~2x KeepAliveInterval.
        hubOptions.KeepAliveInterval = TimeSpan.FromSeconds(15);
        hubOptions.ClientTimeoutInterval = TimeSpan.FromSeconds(30);

        // Security/perf: keep detailed errors off by default.
        hubOptions.EnableDetailedErrors = builder.Environment.IsDevelopment();

        // Rate limits and bounds: limit maximum message size to prevent abuse.
        // 128KB allows for reasonably sized script output chunks while preventing excessive memory usage.
        hubOptions.MaximumReceiveMessageSize = 128 * 1024;

        // Limit concurrent streaming items per connection.
        hubOptions.StreamBufferCapacity = 10;
    })
    .AddJsonProtocol(protocolOptions =>
    {
        // JSON hub protocol uses System.Text.Json; supply our source-generated resolver.
        protocolOptions.PayloadSerializerOptions.TypeInfoResolverChain.Insert(0, ManLabJsonContext.Default);
    });


builder.Services.AddMemoryCache();

// Enhancements services
builder.Services.AddScoped<LogViewerSessionService>();
builder.Services.AddScoped<TerminalSessionService>();
builder.Services.AddScoped<RemoteToolsAuthorizationService>();
builder.Services.AddHostedService<TerminalSessionCleanupService>();

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

builder.Services.AddSingleton<ISettingsService, SettingsService>();

builder.Services.AddSingleton<INotificationService, DiscordWebhookNotificationService>();

// Agent connection tracking + command dispatch
builder.Services.AddSingleton<AgentConnectionRegistry>();
builder.Services.AddHostedService<CommandDispatchService>();

// Background services
builder.Services.AddHostedService<HealthMonitorService>();

// Retention cleanup (snapshot tables)
builder.Services.AddOptions<RetentionOptions>()
    .Bind(builder.Configuration.GetSection(RetentionOptions.SectionName));
builder.Services.AddHostedService<RetentionCleanupService>();

// Configure Entity Framework Core with PostgreSQL via Aspire integration.
// The connection name ("manlab") must match the database resource name in the AppHost.
var connectionString =
    builder.Configuration.GetConnectionString("manlab") ??
    builder.Configuration.GetConnectionString("DefaultConnection");

if (string.IsNullOrWhiteSpace(connectionString))
{
    throw new InvalidOperationException(
        "No database connection string configured. " +
        "Run via the Aspire AppHost (which provides ConnectionStrings:manlab) or set ConnectionStrings:DefaultConnection.");
}

builder.Services.AddDbContext<DataContext>(options =>
{
    options.UseNpgsql(connectionString);
    options.AddInterceptors(new BoundedTextSaveChangesInterceptor());
});

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

