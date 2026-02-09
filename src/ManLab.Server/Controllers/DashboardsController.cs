using ManLab.Server.Data;
using ManLab.Server.Data.Entities;
using ManLab.Server.Services;
using ManLab.Shared.Dtos;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;

namespace ManLab.Server.Controllers;

/// <summary>
/// Controller for dashboard layout and widget management.
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class DashboardsController : ControllerBase
{
    private readonly DataContext _dbContext;
    private readonly RssFeedService _rssFeedService;
    private readonly ILogger<DashboardsController> _logger;

    public DashboardsController(
        DataContext dbContext,
        RssFeedService rssFeedService,
        ILogger<DashboardsController> logger)
    {
        _dbContext = dbContext;
        _rssFeedService = rssFeedService;
        _logger = logger;
    }

    /// <summary>
    /// Gets the default shared dashboard layout.
    /// </summary>
    [HttpGet("current")]
    public async Task<ActionResult<DashboardLayoutDto>> GetCurrentDashboard()
    {
        var dashboard = await _dbContext.UserDashboards
            .Include(d => d.Widgets)
            .OrderByDescending(d => d.IsDefault)
            .ThenByDescending(d => d.UpdatedAt)
            .FirstOrDefaultAsync();

        if (dashboard == null)
        {
            return new DashboardLayoutDto
            {
                Id = Guid.Empty,
                Name = "Default Dashboard",
                Widgets = [],
                UpdatedAt = DateTime.UtcNow
            };
        }

        var widgets = dashboard.Widgets
            .OrderBy(w => w.DisplayOrder)
            .ThenBy(w => w.Row)
            .ThenBy(w => w.Column)
            .Select(w => new DashboardWidgetDto
            {
                Id = w.Id.ToString(),
                Type = w.WidgetType,
                Column = w.Column,
                Row = w.Row,
                Width = w.Width,
                Height = w.Height,
                WidthPercent = w.WidthPercent,
                HeightPercent = w.HeightPercent,
                Config = string.IsNullOrEmpty(w.ConfigJson)
                    ? new Dictionary<string, object>()
                    : JsonSerializer.Deserialize<Dictionary<string, object>>(w.ConfigJson) ?? new Dictionary<string, object>()
            })
            .ToList();

        return new DashboardLayoutDto
        {
            Id = dashboard.Id,
            Name = dashboard.Name,
            Widgets = widgets,
            UpdatedAt = dashboard.UpdatedAt
        };
    }

    /// <summary>
    /// Saves the dashboard layout configuration.
    /// </summary>
    [HttpPut("current")]
    public async Task<ActionResult> SaveDashboard([FromBody] DashboardLayoutDto layout)
    {
        try
        {
            var dashboard = await _dbContext.UserDashboards
                .Include(d => d.Widgets)
                .OrderByDescending(d => d.IsDefault)
                .FirstOrDefaultAsync();

            if (dashboard == null)
            {
                dashboard = new UserDashboard
                {
                    Id = Guid.NewGuid(),
                    Name = layout.Name ?? "Default Dashboard",
                    IsDefault = true,
                    LayoutJson = JsonSerializer.Serialize(layout),
                    UpdatedAt = DateTime.UtcNow
                };
                _dbContext.UserDashboards.Add(dashboard);
            }
            else
            {
                dashboard.Name = layout.Name ?? dashboard.Name;
                dashboard.LayoutJson = JsonSerializer.Serialize(layout);
                dashboard.UpdatedAt = DateTime.UtcNow;
            }

            var existingWidgetIds = new HashSet<Guid>();

            foreach (var widgetDto in layout.Widgets)
            {
                if (!Guid.TryParse(widgetDto.Id, out var widgetId))
                {
                    widgetId = Guid.NewGuid();
                }

                existingWidgetIds.Add(widgetId);

                var widget = dashboard.Widgets.FirstOrDefault(w => w.Id == widgetId);

                if (widget == null)
                {
                    widget = new WidgetConfig
                    {
                        Id = widgetId,
                        DashboardId = dashboard.Id,
                        WidgetType = widgetDto.Type,
                        ConfigJson = JsonSerializer.Serialize(widgetDto.Config),
                        DisplayOrder = layout.Widgets.IndexOf(widgetDto),
                        Column = widgetDto.Column,
                        Row = widgetDto.Row,
                        Width = widgetDto.Width,
                        Height = widgetDto.Height,
                        WidthPercent = widgetDto.WidthPercent,
                        HeightPercent = widgetDto.HeightPercent
                    };
                    _dbContext.WidgetConfigs.Add(widget);
                }
                else
                {
                    widget.WidgetType = widgetDto.Type;
                    widget.ConfigJson = JsonSerializer.Serialize(widgetDto.Config);
                    widget.DisplayOrder = layout.Widgets.IndexOf(widgetDto);
                    widget.Column = widgetDto.Column;
                    widget.Row = widgetDto.Row;
                    widget.Width = widgetDto.Width;
                    widget.Height = widgetDto.Height;
                    widget.WidthPercent = widgetDto.WidthPercent;
                    widget.HeightPercent = widgetDto.HeightPercent;
                }
            }

            var widgetsToRemove = dashboard.Widgets
                .Where(w => !existingWidgetIds.Contains(w.Id))
                .ToList();

            _dbContext.WidgetConfigs.RemoveRange(widgetsToRemove);

            await _dbContext.SaveChangesAsync();

            _logger.LogInformation("Dashboard layout saved with {WidgetCount} widgets", layout.Widgets.Count);

            return Ok();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error saving dashboard layout");
            return BadRequest(new ErrorResponse { Error = ex.Message, Message = "Failed to save dashboard layout" });
        }
    }

    /// <summary>
    /// Gets the list of available widget types.
    /// </summary>
    [HttpGet("widgets")]
    public ActionResult<List<WidgetTypeDefinitionDto>> GetWidgetTypes()
    {
        var schema = new Dictionary<string, WidgetConfigPropertyDto>();
        var widgetTypes = new List<WidgetTypeDefinitionDto>();

        // Node Card Widget
        schema.Clear();
        schema.Add("nodeId", new WidgetConfigPropertyDto
        {
            Type = "select",
            Label = "Node",
            Description = "Select a specific node or choose 'All Nodes' to show multiple",
            Required = true,
            Options = ["auto"],
            DefaultValue = "auto"
        });
        schema.Add("showThumbnail", new WidgetConfigPropertyDto
        {
            Type = "boolean",
            Label = "Show Thumbnail",
            DefaultValue = true
        });
        schema.Add("compactMode", new WidgetConfigPropertyDto
        {
            Type = "boolean",
            Label = "Compact Mode",
            Description = "Show mini cards instead of detailed cards",
            DefaultValue = false
        });
        widgetTypes.Add(new WidgetTypeDefinitionDto
        {
            Type = "node-card",
            Name = "Node Card",
            Description = "Display a node's status and resource usage",
            Category = "fleet",
            Icon = "Server",
            RequiresAdmin = false,
            ConfigSchema = new Dictionary<string, WidgetConfigPropertyDto>(schema)
        });

        // Fleet Stats Widget
        schema.Clear();
        schema.Add("stats", new WidgetConfigPropertyDto
        {
            Type = "multiselect",
            Label = "Statistics",
            Description = "Which statistics to display",
            Required = true,
            Options = ["total", "online", "offline", "avgCpu", "avgRam", "avgDisk", "issues"],
            DefaultValue = new List<string> { "total", "online", "avgCpu", "issues" }
        });
        schema.Add("refreshInterval", new WidgetConfigPropertyDto
        {
            Type = "number",
            Label = "Refresh Interval (seconds)",
            Description = "How often to refresh the statistics",
            Required = true,
            Min = 10,
            Max = 300,
            DefaultValue = 30
        });
        widgetTypes.Add(new WidgetTypeDefinitionDto
        {
            Type = "fleet-stats",
            Name = "Fleet Statistics",
            Description = "Show overall fleet health metrics",
            Category = "fleet",
            Icon = "Activity",
            RequiresAdmin = false,
            ConfigSchema = new Dictionary<string, WidgetConfigPropertyDto>(schema)
        });

        // Resource Chart Widget
        schema.Clear();
        schema.Add("nodeId", new WidgetConfigPropertyDto
        {
            Type = "select",
            Label = "Node",
            Description = "Select which node to chart",
            Required = true,
            Options = [],
            DefaultValue = ""
        });
        schema.Add("metrics", new WidgetConfigPropertyDto
        {
            Type = "multiselect",
            Label = "Metrics",
            Description = "Which metrics to display",
            Required = true,
            Options = ["cpu", "ram", "disk", "temperature"],
            DefaultValue = new List<string> { "cpu", "ram" }
        });
        schema.Add("timeRange", new WidgetConfigPropertyDto
        {
            Type = "select",
            Label = "Time Range",
            Required = true,
            Options = ["1h", "6h", "12h", "24h", "48h"],
            DefaultValue = "24h"
        });
        schema.Add("height", new WidgetConfigPropertyDto
        {
            Type = "select",
            Label = "Height",
            Required = true,
            Options = ["1", "2", "3", "4"],
            DefaultValue = "2"
        });
        widgetTypes.Add(new WidgetTypeDefinitionDto
        {
            Type = "resource-chart",
            Name = "Resource History Chart",
            Description = "Display resource usage over time for a node",
            Category = "fleet",
            Icon = "BarChart3",
            RequiresAdmin = false,
            ConfigSchema = new Dictionary<string, WidgetConfigPropertyDto>(schema)
        });

        // System Updates Widget
        schema.Clear();
        schema.Add("showAllNodes", new WidgetConfigPropertyDto
        {
            Type = "boolean",
            Label = "Show All Nodes",
            Description = "List all nodes with updates, or just show the count",
            DefaultValue = false
        });
        schema.Add("criticalOnly", new WidgetConfigPropertyDto
        {
            Type = "boolean",
            Label = "Critical Only",
            Description = "Show only critical updates",
            DefaultValue = false
        });
        widgetTypes.Add(new WidgetTypeDefinitionDto
        {
            Type = "system-updates",
            Name = "System Updates",
            Description = "Show pending system updates across the fleet",
            Category = "fleet",
            Icon = "RefreshCw",
            RequiresAdmin = false,
            ConfigSchema = new Dictionary<string, WidgetConfigPropertyDto>(schema)
        });

        // RSS Feed Widget
        schema.Clear();
        schema.Add("feedUrl", new WidgetConfigPropertyDto
        {
            Type = "url",
            Label = "Feed URL",
            Description = "URL of the RSS or Atom feed",
            Required = true,
            DefaultValue = ""
        });
        schema.Add("maxItems", new WidgetConfigPropertyDto
        {
            Type = "number",
            Label = "Max Items",
            Description = "Maximum number of feed items to display",
            Required = true,
            Min = 1,
            Max = 50,
            DefaultValue = 10
        });
        schema.Add("showThumbnails", new WidgetConfigPropertyDto
        {
            Type = "boolean",
            Label = "Show Thumbnails",
            DefaultValue = true
        });
        schema.Add("cacheDuration", new WidgetConfigPropertyDto
        {
            Type = "number",
            Label = "Cache Duration (minutes)",
            Description = "How long to cache feed data",
            Min = 1,
            Max = 60,
            DefaultValue = 5
        });
        widgetTypes.Add(new WidgetTypeDefinitionDto
        {
            Type = "rss-feed",
            Name = "RSS Feed",
            Description = "Display items from an RSS or Atom feed",
            Category = "feed",
            Icon = "Rss",
            RequiresAdmin = false,
            ConfigSchema = new Dictionary<string, WidgetConfigPropertyDto>(schema)
        });

        // Weather Widget
        schema.Clear();
        schema.Add("location", new WidgetConfigPropertyDto
        {
            Type = "text",
            Label = "Location",
            Description = "City name or coordinates (lat,lon)",
            Required = true,
            DefaultValue = ""
        });
        schema.Add("units", new WidgetConfigPropertyDto
        {
            Type = "select",
            Label = "Units",
            Required = true,
            Options = ["celsius", "fahrenheit"],
            DefaultValue = "celsius"
        });
        widgetTypes.Add(new WidgetTypeDefinitionDto
        {
            Type = "weather",
            Name = "Weather",
            Description = "Display current weather information",
            Category = "info",
            Icon = "Cloud",
            RequiresAdmin = false,
            ConfigSchema = new Dictionary<string, WidgetConfigPropertyDto>(schema)
        });

        // Time Date Widget
        schema.Clear();
        schema.Add("showDate", new WidgetConfigPropertyDto
        {
            Type = "boolean",
            Label = "Show Date",
            DefaultValue = true
        });
        schema.Add("timeFormat", new WidgetConfigPropertyDto
        {
            Type = "select",
            Label = "Time Format",
            Required = true,
            Options = ["12h", "24h"],
            DefaultValue = "24h"
        });
        schema.Add("timeZone", new WidgetConfigPropertyDto
        {
            Type = "text",
            Label = "Time Zone",
            Description = "Specific time zone or leave blank for local",
            DefaultValue = ""
        });
        widgetTypes.Add(new WidgetTypeDefinitionDto
        {
            Type = "time-date",
            Name = "Time & Date",
            Description = "Display current time and date",
            Category = "info",
            Icon = "Clock",
            RequiresAdmin = false,
            ConfigSchema = new Dictionary<string, WidgetConfigPropertyDto>(schema)
        });

        // Bookmark Widget
        schema.Clear();
        schema.Add("bookmarks", new WidgetConfigPropertyDto
        {
            Type = "array",
            Label = "Bookmarks",
            Description = "Array of bookmark objects with title, url, and icon",
            Required = true,
            DefaultValue = new List<string>()
        });
        schema.Add("columns", new WidgetConfigPropertyDto
        {
            Type = "select",
            Label = "Columns",
            Description = "Number of columns in the bookmark grid",
            Required = true,
            Min = 1,
            Max = 6,
            DefaultValue = 3
        });
        widgetTypes.Add(new WidgetTypeDefinitionDto
        {
            Type = "bookmark",
            Name = "Quick Links",
            Description = "Display a grid of bookmark links",
            Category = "bookmark",
            Icon = "Bookmark",
            RequiresAdmin = false,
            ConfigSchema = new Dictionary<string, WidgetConfigPropertyDto>(schema)
        });

        // Custom HTML Widget (Admin Only)
        schema.Clear();
        schema.Add("htmlContent", new WidgetConfigPropertyDto
        {
            Type = "textarea",
            Label = "HTML Content",
            Description = "Raw HTML to render in the widget",
            Required = true,
            DefaultValue = ""
        });
        widgetTypes.Add(new WidgetTypeDefinitionDto
        {
            Type = "custom-html",
            Name = "Custom HTML",
            Description = "Render custom HTML content",
            Category = "custom",
            Icon = "Code",
            RequiresAdmin = true,
            ConfigSchema = new Dictionary<string, WidgetConfigPropertyDto>(schema)
        });

        // Custom Iframe Widget (Admin Only)
        schema.Clear();
        schema.Add("iframeUrl", new WidgetConfigPropertyDto
        {
            Type = "url",
            Label = "URL",
            Description = "URL to embed in the iframe",
            Required = true,
            DefaultValue = ""
        });
        schema.Add("height", new WidgetConfigPropertyDto
        {
            Type = "number",
            Label = "Height (pixels)",
            Required = true,
            Min = 100,
            Max = 2000,
            DefaultValue = 400
        });
         schema.Add("allowFullscreen", new WidgetConfigPropertyDto
         {
             Type = "boolean",
             Label = "Allow Fullscreen",
             DefaultValue = false
         });
         widgetTypes.Add(new WidgetTypeDefinitionDto
         {
             Type = "system-updates",
             Name = "System Updates",
             Description = "Show pending system updates across fleet",
             Category = "fleet",
             Icon = "RefreshCw",
             RequiresAdmin = false,
             ConfigSchema = new Dictionary<string, WidgetConfigPropertyDto>(schema)
         });

         // Custom HTML Widget (Admin Only)
         schema.Clear();
         schema.Add("htmlContent", new WidgetConfigPropertyDto
         {
             Type = "textarea",
             Label = "HTML Content",
             Description = "Raw HTML to render in widget",
             Required = true,
             DefaultValue = ""
         });
         widgetTypes.Add(new WidgetTypeDefinitionDto
         {
             Type = "custom-html",
             Name = "Custom HTML",
             Description = "Render custom HTML content",
             Category = "custom",
             Icon = "Code",
             RequiresAdmin = true,
             ConfigSchema = new Dictionary<string, WidgetConfigPropertyDto>(schema)
         });

         // Custom Iframe Widget (Admin Only)
         schema.Clear();
         schema.Add("iframeUrl", new WidgetConfigPropertyDto
         {
             Type = "url",
             Label = "URL",
             Description = "URL to embed in iframe",
             Required = true,
             DefaultValue = ""
         });
         schema.Add("height", new WidgetConfigPropertyDto
         {
             Type = "number",
             Label = "Height (pixels)",
             Description = "Height of iframe in pixels",
             Required = true,
             Min = 100,
             Max = 2000,
             DefaultValue = 400
         });
         schema.Add("allowFullscreen", new WidgetConfigPropertyDto
         {
             Type = "boolean",
             Label = "Allow Fullscreen",
             Description = "Allow iframe to go fullscreen",
             Required = true,
             DefaultValue = false
         });
         widgetTypes.Add(new WidgetTypeDefinitionDto
         {
             Type = "custom-iframe",
             Name = "Custom Iframe",
             Description = "Embed external content in an iframe",
             Category = "custom",
             Icon = "Globe",
             RequiresAdmin = true,
             ConfigSchema = new Dictionary<string, WidgetConfigPropertyDto>(schema)
         });

         return widgetTypes;
    }

    /// <summary>
    /// Tests an RSS feed URL to see if it's valid.
    /// </summary>
    [HttpPost("widgets/rss-feed/test")]
    public async Task<ActionResult<RssFeedValidationResponse>> TestRssFeed([FromBody] Dictionary<string, string> body)
    {
        if (!body.TryGetValue("url", out var url) || string.IsNullOrEmpty(url))
        {
            return BadRequest(new ValidationErrorResponse
            {
                Valid = false,
                Error = "Feed URL is required"
            });
        }

        var result = await _rssFeedService.ValidateFeedAsync(url);
        return Ok(result);
    }

    /// <summary>
    /// Fetches an RSS feed for display in a widget.
    /// </summary>
    [HttpGet("widgets/rss-feed")]
    public async Task<ActionResult<RssFeedResponse>> FetchRssFeed(
        [FromQuery] string url,
        [FromQuery] int maxItems = 10)
    {
        if (string.IsNullOrEmpty(url))
        {
            return BadRequest(new RssFeedResponse { FeedUrl = url });
        }

        var feed = await _rssFeedService.FetchFeedAsync(url, maxItems);
        return Ok(feed);
    }

    /// <summary>
    /// Resets the dashboard to default configuration.
    /// </summary>
    [HttpDelete("current")]
    public async Task<ActionResult> ResetDashboard()
    {
        try
        {
            var dashboard = await _dbContext.UserDashboards
                .Include(d => d.Widgets)
                .OrderByDescending(d => d.IsDefault)
                .FirstOrDefaultAsync();

            if (dashboard != null)
            {
                _dbContext.WidgetConfigs.RemoveRange(dashboard.Widgets);
                _dbContext.UserDashboards.Remove(dashboard);
                await _dbContext.SaveChangesAsync();
            }

            _logger.LogInformation("Dashboard reset to default");
            return Ok();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error resetting dashboard");
            return BadRequest(new ErrorResponse { Error = ex.Message, Message = "Failed to reset dashboard" });
        }
    }
}
