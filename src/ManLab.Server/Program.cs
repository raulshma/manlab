using ManLab.Server.Data;
using ManLab.Server.Hubs;
using ManLab.Server.Services;

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

builder.Services.AddHttpClient();
builder.Services.AddOptions<DiscordOptions>()
    .Bind(builder.Configuration.GetSection(DiscordOptions.SectionName))
    .Validate(o => string.IsNullOrWhiteSpace(o.WebhookUrl) || Uri.IsWellFormedUriString(o.WebhookUrl, UriKind.Absolute),
        "Discord:WebhookUrl must be a valid absolute URL when provided");

builder.Services.AddOptions<BinaryDistributionOptions>()
    .Bind(builder.Configuration.GetSection(BinaryDistributionOptions.SectionName));

builder.Services.AddSingleton<INotificationService, DiscordWebhookNotificationService>();

// Background services
builder.Services.AddHostedService<HealthMonitorService>();

// Configure Entity Framework Core with PostgreSQL via Aspire integration.
// The connection name ("manlab") must match the database resource name in the AppHost.
builder.AddNpgsqlDbContext<DataContext>(connectionName: "manlab");

var app = builder.Build();

// Map Aspire ServiceDefaults endpoints (/health and /alive in development).
app.MapDefaultEndpoints();

// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.MapControllers();
app.MapHub<AgentHub>("/hubs/agent");

app.Run();

