using ManLab.Server.Data;
using ManLab.Server.Hubs;
using ManLab.Server.Services;
using ManLab.Server.Services.Agents;
using ManLab.Server.Services.Commands;
using ManLab.Server.Services.Enhancements;
using ManLab.Server.Services.Audit;
using ManLab.Server.Services.Persistence;
using ManLab.Server.Services.Retention;
using ManLab.Shared.Dtos;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.SignalR;
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

        // Audit failures in SignalR invocations (best-effort).
        hubOptions.AddFilter<AuditHubFilter>();
    })
    .AddJsonProtocol(protocolOptions =>
    {
        // JSON hub protocol uses System.Text.Json; supply our source-generated resolver.
        protocolOptions.PayloadSerializerOptions.TypeInfoResolverChain.Insert(0, ManLabJsonContext.Default);
    });

// Activity/audit logging (best-effort, durable).
builder.Services.AddOptions<AuditOptions>()
    .Bind(builder.Configuration.GetSection(AuditOptions.SectionName));
builder.Services.AddSingleton<AuditLogQueue>();
builder.Services.AddSingleton<IAuditLog, AuditLogService>();
builder.Services.AddHostedService<AuditLogWriterService>();
builder.Services.AddHostedService<AuditRetentionCleanupService>();
builder.Services.AddSingleton<AuditHubFilter>();
builder.Services.AddHttpContextAccessor();


builder.Services.AddMemoryCache();
builder.Services.AddResponseCaching();

// Enhancements services
builder.Services.AddScoped<LogViewerSessionService>();
builder.Services.AddScoped<FileBrowserSessionService>();
builder.Services.AddScoped<TerminalSessionService>();
builder.Services.AddSingleton<DownloadSessionService>();
builder.Services.AddSingleton<FileStreamingService>();
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
builder.Services.AddScoped<ManLab.Server.Services.CredentialEncryptionService>();

builder.Services.AddHttpClient();
builder.Services.AddOptions<DiscordOptions>()
    .Bind(builder.Configuration.GetSection(DiscordOptions.SectionName))
    .Validate(o => string.IsNullOrWhiteSpace(o.WebhookUrl) || Uri.IsWellFormedUriString(o.WebhookUrl, UriKind.Absolute),
        "Discord:WebhookUrl must be a valid absolute URL when provided");

builder.Services.AddOptions<BinaryDistributionOptions>()
    .Bind(builder.Configuration.GetSection(BinaryDistributionOptions.SectionName));

builder.Services.AddSingleton<ISettingsService, SettingsService>();

builder.Services.AddSingleton<DiscordWebhookNotificationService>();
builder.Services.AddSingleton<INotificationService>(sp => sp.GetRequiredService<DiscordWebhookNotificationService>());

// Agent connection tracking + command dispatch
builder.Services.AddSingleton<AgentConnectionRegistry>();
builder.Services.AddSingleton<IWakeOnLanService, WakeOnLanService>();
builder.Services.AddHostedService<CommandDispatchService>();

// Background services
builder.Services.AddHostedService<HealthMonitorService>();
builder.Services.AddHostedService<ServiceMonitorSchedulerService>();

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

// Support running behind a reverse proxy (e.g., nginx in the containerized 'web' service).
// This ensures Request.Scheme/Host reflect X-Forwarded-* headers.
var forwardedHeadersOptions = new ForwardedHeadersOptions
{
    ForwardedHeaders =
        ForwardedHeaders.XForwardedFor |
        ForwardedHeaders.XForwardedProto |
        ForwardedHeaders.XForwardedHost
};
// When running in containers, the reverse proxy is on a private network; allow forwarded headers.
forwardedHeadersOptions.KnownIPNetworks.Clear();
forwardedHeadersOptions.KnownProxies.Clear();
app.UseForwardedHeaders(forwardedHeadersOptions);

// Activity logging for mutating HTTP requests (best-effort).
app.UseMiddleware<AuditHttpMiddleware>();

// Enable response caching middleware for ResponseCache attribute with VaryByQueryKeys support.
app.UseResponseCaching();

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
        // In container orchestrators (Docker Compose, K8s, etc.) the DB container may be started
        // but not yet accepting TCP connections. Retry for a short window to avoid hard-failing
        // on a transient startup race.
        const int maxAttempts = 12;
        var delay = TimeSpan.FromSeconds(1);

        for (var attempt = 1; attempt <= maxAttempts; attempt++)
        {
            try
            {
                await dbContext.Database.MigrateAsync();
                logger.LogInformation("Database migration completed successfully (attempt {Attempt}/{MaxAttempts})", attempt, maxAttempts);
                break;
            }
            catch (Exception ex) when (attempt < maxAttempts)
            {
                logger.LogWarning(ex,
                    "Database migration attempt {Attempt}/{MaxAttempts} failed; retrying in {Delay}s",
                    attempt,
                    maxAttempts,
                    delay.TotalSeconds);

                await Task.Delay(delay);

                // Cap the delay so we don't stall startup for too long.
                delay = TimeSpan.FromSeconds(Math.Min(delay.TotalSeconds * 1.5, 10));
            }
        }
    }
    catch (Exception ex)
    {
        logger.LogCritical(ex, "Database migration failed");
        throw;
    }
}

// Map Aspire ServiceDefaults endpoints (/health and /alive in development).
app.MapDefaultEndpoints();

app.MapOpenApi();
app.MapScalarApiReference();

app.MapControllers();
app.MapHub<AgentHub>("/hubs/agent");

app.Run();

