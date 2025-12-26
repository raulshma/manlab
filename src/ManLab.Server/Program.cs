using ManLab.Server.Data;
using ManLab.Server.Hubs;
using ManLab.Server.Services;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
builder.Services.AddOpenApi();
builder.Services.AddControllers();
builder.Services.AddSignalR();

builder.Services.AddHttpClient();
builder.Services.AddOptions<DiscordOptions>()
    .Bind(builder.Configuration.GetSection(DiscordOptions.SectionName))
    .Validate(o => string.IsNullOrWhiteSpace(o.WebhookUrl) || Uri.IsWellFormedUriString(o.WebhookUrl, UriKind.Absolute),
        "Discord:WebhookUrl must be a valid absolute URL when provided");

builder.Services.AddSingleton<INotificationService, DiscordWebhookNotificationService>();

// Background services
builder.Services.AddHostedService<HealthMonitorService>();

// Configure Entity Framework Core with PostgreSQL
builder.Services.AddDbContext<DataContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("DefaultConnection")));

var app = builder.Build();

// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.MapControllers();
app.MapHub<AgentHub>("/hubs/agent");

app.Run();
