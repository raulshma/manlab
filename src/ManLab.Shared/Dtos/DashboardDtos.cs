namespace ManLab.Shared.Dtos;

/// <summary>
/// Dashboard layout configuration.
/// </summary>
public class DashboardLayoutDto
{
    public Guid Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public List<DashboardWidgetDto> Widgets { get; set; } = [];
    public DateTime UpdatedAt { get; set; }
}

/// <summary>
/// Single widget configuration in dashboard layout.
/// </summary>
public class DashboardWidgetDto
{
    public string Id { get; set; } = string.Empty;
    public string Type { get; set; } = string.Empty;
    public int Column { get; set; }
    public int Row { get; set; }
    public int Width { get; set; }
    public int Height { get; set; }
    public int? WidthPercent { get; set; }
    public int? HeightPercent { get; set; }
    public Dictionary<string, object> Config { get; set; } = new();
}

/// <summary>
/// Response containing RSS feed data.
/// </summary>
public class RssFeedResponse
{
    public string FeedTitle { get; set; } = string.Empty;
    public string FeedUrl { get; set; } = string.Empty;
    public List<RssFeedItemDto> Items { get; set; } = [];
    public DateTime? CachedAt { get; set; }
}

/// <summary>
/// Individual RSS feed item.
/// </summary>
public class RssFeedItemDto
{
    public string Title { get; set; } = string.Empty;
    public string Link { get; set; } = string.Empty;
    public string? Description { get; set; }
    public DateTime? PublishedAt { get; set; }
    public string? ThumbnailUrl { get; set; }
    public string? Author { get; set; }
}

/// <summary>
/// RSS feed validation response.
/// </summary>
public class RssFeedValidationResponse
{
    public bool Valid { get; set; }
    public string? FeedTitle { get; set; }
    public string? Error { get; set; }
}

/// <summary>
/// Widget type definition for the UI.
/// </summary>
public class WidgetTypeDefinitionDto
{
    public string Type { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string Category { get; set; } = string.Empty;
    public string Icon { get; set; } = string.Empty;
    public bool RequiresAdmin { get; set; }
    public Dictionary<string, WidgetConfigPropertyDto> ConfigSchema { get; set; } = new();
}

/// <summary>
/// Widget configuration property definition.
/// </summary>
public class WidgetConfigPropertyDto
{
    public string Type { get; set; } = string.Empty;
    public string Label { get; set; } = string.Empty;
    public string? Description { get; set; }
    public bool Required { get; set; }
    public object? DefaultValue { get; set; }
    public string[]? Options { get; set; }
    public int? Min { get; set; }
    public int? Max { get; set; }
}

/// <summary>
/// Error response object.
/// </summary>
public class ErrorResponse
{
    public string Error { get; set; } = string.Empty;
    public string? Message { get; set; }
}

/// <summary>
/// Validation error response object.
/// </summary>
public class ValidationErrorResponse
{
    public string Error { get; set; } = string.Empty;
    public bool Valid { get; set; }
}
