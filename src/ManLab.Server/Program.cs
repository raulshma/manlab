using ManLab.Server.Data;
using ManLab.Server.Hubs;
using ManLab.Server.Services;
using ManLab.Server.Services.Agents;
using ManLab.Server.Services.Commands;
using ManLab.Server.Services.Enhancements;
using ManLab.Server.Services.Audit;
using ManLab.Server.Services.Network;
using ManLab.Server.Services.Monitoring;
using ManLab.Server.Services.Persistence;
using ManLab.Server.Services.Retention;
using ManLab.Server.Services.Security;
using ManLab.Shared.Dtos;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using Quartz;
using Scalar.AspNetCore;
using System.Security.Cryptography;
using System.Text;

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
        // JSON hub protocol uses System.Text.Json; supply our source-generated resolvers.
        protocolOptions.PayloadSerializerOptions.TypeInfoResolverChain.Insert(0, NetworkHubJsonContext.Default);
        protocolOptions.PayloadSerializerOptions.TypeInfoResolverChain.Insert(1, ManLabJsonContext.Default);
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

// Auth options (JWT)
var authOptions = builder.Configuration.GetSection(AuthOptions.SectionName).Get<AuthOptions>() ?? new AuthOptions();
if (string.IsNullOrWhiteSpace(authOptions.JwtSigningKey))
{
    authOptions.JwtSigningKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
}
builder.Services.AddSingleton<IOptions<AuthOptions>>(Options.Create(authOptions));
builder.Services.AddSingleton<AuthTokenService>();
builder.Services.AddSingleton<LocalBypassEvaluator>();
builder.Services.AddSingleton<PasswordHasher<string>>();
builder.Services.AddScoped<UsersService>();
builder.Services.AddSingleton<IAuthorizationHandler, AdminOrLocalBypassHandler>();
builder.Services.AddSingleton<IAuthorizationHandler, PasswordChangeRequiredHandler>();
builder.Services.AddSingleton<IAuthorizationHandler, PermissionAuthorizationHandler>();

builder.Services
    .AddAuthentication(options =>
    {
        options.DefaultAuthenticateScheme = JwtBearerDefaults.AuthenticationScheme;
        options.DefaultChallengeScheme = JwtBearerDefaults.AuthenticationScheme;
    })
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = authOptions.Issuer,
            ValidAudience = authOptions.Audience,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(authOptions.JwtSigningKey))
        };

        options.Events = new JwtBearerEvents
        {
            OnMessageReceived = context =>
            {
                // Prefer Authorization header if present; fallback to query/cookie.
                if (!string.IsNullOrWhiteSpace(context.Token))
                {
                    return Task.CompletedTask;
                }

                var path = context.HttpContext.Request.Path;
                if (path.StartsWithSegments("/hubs"))
                {
                    var accessToken = context.Request.Query["access_token"].ToString();
                    if (!string.IsNullOrWhiteSpace(accessToken))
                    {
                        context.Token = accessToken;
                        return Task.CompletedTask;
                    }
                }

                var cookieToken = context.Request.Cookies[AuthTokenService.CookieName];
                if (!string.IsNullOrWhiteSpace(cookieToken))
                {
                    context.Token = cookieToken;
                }

                return Task.CompletedTask;
            }
        };
    })
    .AddScheme<AuthenticationSchemeOptions, LocalBypassAuthenticationHandler>(
        LocalBypassAuthenticationHandler.SchemeName, _ => { });

builder.Services.AddAuthorization(options =>
{
    options.AddPolicy("AdminOnly", policy =>
    {
        policy.AddAuthenticationSchemes(JwtBearerDefaults.AuthenticationScheme, LocalBypassAuthenticationHandler.SchemeName)
            .AddRequirements(new AdminOrLocalBypassRequirement());
    });

    foreach (var permission in Permissions.All)
    {
        options.AddPolicy(Permissions.PolicyFor(permission), policy =>
        {
            policy.AddAuthenticationSchemes(JwtBearerDefaults.AuthenticationScheme, LocalBypassAuthenticationHandler.SchemeName)
                .RequireAuthenticatedUser()
                .AddRequirements(new PermissionRequirement(permission));
        });
    }

    options.FallbackPolicy = new Microsoft.AspNetCore.Authorization.AuthorizationPolicyBuilder()
        .AddAuthenticationSchemes(JwtBearerDefaults.AuthenticationScheme, LocalBypassAuthenticationHandler.SchemeName)
        .RequireAuthenticatedUser()
        .AddRequirements(new PasswordChangeRequiredRequirement())
        .Build();
});

// Enhancements services
builder.Services.AddScoped<LogViewerSessionService>();
builder.Services.AddScoped<FileBrowserSessionService>();
builder.Services.AddScoped<TerminalSessionService>();
builder.Services.AddSingleton<DownloadSessionService>();
builder.Services.AddSingleton<StreamingDownloadService>();
builder.Services.AddScoped<RemoteToolsAuthorizationService>();
builder.Services.AddHostedService<TerminalSessionCleanupService>();

builder.Services.AddOptions<ManLab.Server.Services.Ssh.SshProvisioningOptions>()
    .Bind(builder.Configuration.GetSection(ManLab.Server.Services.Ssh.SshProvisioningOptions.SectionName));

// Onboarding services
builder.Services.AddScoped<EnrollmentTokenService>();
builder.Services.AddScoped<ManLab.Server.Services.Ssh.SshProvisioningService>();
builder.Services.AddScoped<ManLab.Server.Services.Ssh.SshAuditService>();
builder.Services.AddScoped<ManLab.Server.Services.Ssh.SshFileService>();
builder.Services.AddSingleton<ManLab.Server.Services.Ssh.SshRateLimitService>();
builder.Services.AddSingleton<OnboardingJobRunner>();
builder.Services.AddSingleton<LocalAgentInstallationService>();
builder.Services.AddScoped<ManLab.Server.Services.CredentialEncryptionService>();

builder.Services.AddHttpClient();
builder.Services.AddQuartz();
builder.Services.AddQuartzHostedService(options =>
{
    options.WaitForJobsToComplete = true;
});
builder.Services.AddOptions<SpeedTestOptions>()
    .Bind(builder.Configuration.GetSection(SpeedTestOptions.SectionName));
builder.Services.AddOptions<SyslogOptions>()
    .Bind(builder.Configuration.GetSection(SyslogOptions.SectionName));
builder.Services.AddOptions<PacketCaptureOptions>()
    .Bind(builder.Configuration.GetSection(PacketCaptureOptions.SectionName));
builder.Services.AddOptions<NetworkRateLimitOptions>()
    .Bind(builder.Configuration.GetSection("NetworkRateLimit"));
builder.Services.AddOptions<PublicIpOptions>()
    .Bind(builder.Configuration.GetSection(PublicIpOptions.SectionName));
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

// Network scanning services
builder.Services.AddSingleton<ManLab.Server.Services.Network.IOuiDatabase, ManLab.Server.Services.Network.OuiDatabase>();
if (OperatingSystem.IsWindows())
{
    builder.Services.AddSingleton<ManLab.Server.Services.Network.IArpService, ManLab.Server.Services.Network.WindowsArpService>();
}
else if (OperatingSystem.IsLinux())
{
    builder.Services.AddSingleton<ManLab.Server.Services.Network.IArpService, ManLab.Server.Services.Network.LinuxArpService>();
}
builder.Services.AddSingleton<ManLab.Server.Services.Network.INetworkScannerService, ManLab.Server.Services.Network.NetworkScannerService>();
builder.Services.AddSingleton<ManLab.Server.Services.Network.INetworkTopologyService, ManLab.Server.Services.Network.NetworkTopologyService>();
builder.Services.AddSingleton<ISpeedTestService, SpeedTestService>();
builder.Services.AddSingleton<ISnmpService, SnmpService>();

// Syslog receiver + packet capture
builder.Services.AddSingleton<SyslogReceiverService>();
builder.Services.AddSingleton<ISyslogMessageStore>(sp => sp.GetRequiredService<SyslogReceiverService>());
builder.Services.AddHostedService(sp => sp.GetRequiredService<SyslogReceiverService>());

builder.Services.AddSingleton<PacketCaptureService>();
builder.Services.AddSingleton<IPacketCaptureService>(sp => sp.GetRequiredService<PacketCaptureService>());
builder.Services.AddHostedService(sp => sp.GetRequiredService<PacketCaptureService>());

// mDNS/UPnP device discovery
builder.Services.AddSingleton<ManLab.Server.Services.Network.IDeviceDiscoveryService, ManLab.Server.Services.Network.DeviceDiscoveryService>();

// WiFi scanner (platform-specific)
if (OperatingSystem.IsWindows())
{
    builder.Services.AddSingleton<ManLab.Server.Services.Network.IWifiScannerService, ManLab.Server.Services.Network.WindowsWifiScannerService>();
}
else if (OperatingSystem.IsLinux())
{
    builder.Services.AddSingleton<ManLab.Server.Services.Network.IWifiScannerService, ManLab.Server.Services.Network.LinuxWifiScannerService>();
}
else
{
    // Fallback for unsupported platforms - use a no-op implementation
    builder.Services.AddSingleton<ManLab.Server.Services.Network.IWifiScannerService, ManLab.Server.Services.Network.UnsupportedWifiScannerService>();
}

// IP Geolocation service
builder.Services.AddSingleton<ManLab.Server.Services.Network.IIpGeolocationService, ManLab.Server.Services.Network.IpGeolocationService>();

// Network rate limiting for SignalR hub
builder.Services.AddSingleton<ManLab.Server.Services.Network.NetworkRateLimitService>();

// Network tool history tracking for analytics
builder.Services.AddSingleton<ManLab.Server.Services.Network.NetworkToolHistoryService>();
builder.Services.AddSingleton<ManLab.Server.Services.Network.INetworkToolHistoryService>(sp =>
    sp.GetRequiredService<ManLab.Server.Services.Network.NetworkToolHistoryService>());
builder.Services.AddHostedService(sp =>
    sp.GetRequiredService<ManLab.Server.Services.Network.NetworkToolHistoryService>());

builder.Services.AddHostedService<CommandDispatchService>();

// Background services
builder.Services.AddHostedService<HealthMonitorService>();
builder.Services.AddHostedService<ServiceMonitorSchedulerService>();
builder.Services.AddSingleton<MonitorJobScheduler>();
builder.Services.AddHostedService<MonitorJobBootstrapper>();
builder.Services.AddSingleton<DashboardConnectionTracker>();
builder.Services.AddHostedService<ServerResourceUsageService>();

// Auto-update services
builder.Services.AddScoped<AutoUpdateService>();
builder.Services.AddSingleton<AutoUpdateScheduler>();
builder.Services.AddHostedService<AutoUpdateBootstrapper>();

// System update services
builder.Services.AddScoped<SystemUpdateService>();
builder.Services.AddSingleton<SystemUpdateScheduler>();
builder.Services.AddHostedService<SystemUpdateBootstrapper>();

// Retention cleanup (snapshot tables)
builder.Services.AddOptions<RetentionOptions>()
    .Bind(builder.Configuration.GetSection(RetentionOptions.SectionName));
builder.Services.AddHostedService<RetentionCleanupService>();

// Telemetry rollup aggregation
builder.Services.AddOptions<TelemetryRollupOptions>()
    .Bind(builder.Configuration.GetSection(TelemetryRollupOptions.SectionName));
builder.Services.AddHostedService<TelemetryRollupService>();

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
    // Allow startup to proceed even if model changes exist; migrations will still be applied.
    options.ConfigureWarnings(warnings =>
        warnings.Ignore(RelationalEventId.PendingModelChangesWarning));
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

app.UseAuthentication();
app.UseAuthorization();

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

        try
        {
            await dbContext.Database.OpenConnectionAsync();
            await using var command = dbContext.Database.GetDbConnection().CreateCommand();
            command.CommandText = "SELECT 1 FROM pg_extension WHERE extname = 'timescaledb' LIMIT 1";
            var result = await command.ExecuteScalarAsync();
            if (result is null)
            {
                logger.LogWarning("TimescaleDB extension is not installed. Time-series tables will not use hypertables.");
            }
            else
            {
                logger.LogInformation("TimescaleDB extension detected.");
            }
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Failed to verify TimescaleDB extension");
        }
        finally
        {
            await dbContext.Database.CloseConnectionAsync();
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
app.MapHub<AgentHub>("/hubs/agent").AllowAnonymous();
app.MapHub<ManLab.Server.Hubs.NetworkHub>("/hubs/network");

app.Run();

