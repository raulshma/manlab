using Microsoft.EntityFrameworkCore;
using ManLab.Server.Data;
using ManLab.Server.Data.Entities;

namespace ManLab.Server.Services;

public interface ISettingsService
{
    Task<string?> GetValueAsync(string key);
    Task<T> GetValueAsync<T>(string key, T defaultValue);
    Task SetValueAsync(string key, string? value, string category, string? description = null);
    Task<List<SystemSetting>> GetAllAsync();
}

public class SettingsService : ISettingsService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ICacheService _cache;
    private readonly ILogger<SettingsService> _logger;
    private const string CacheKeyPrefix = "settings:";
    private const string SettingsTag = "settings";

    public SettingsService(
        IServiceScopeFactory scopeFactory,
        ICacheService cache,
        ILogger<SettingsService> logger)
    {
        _scopeFactory = scopeFactory;
        _cache = cache;
        _logger = logger;
    }

    public async Task<string?> GetValueAsync(string key)
    {
        var cacheKey = $"{CacheKeyPrefix}{key}";
        var tags = new[] { SettingsTag, $"setting:{key}" };

        return await _cache.GetOrCreateAsync(
            cacheKey,
            async ct =>
            {
                using var scope = _scopeFactory.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<DataContext>();
                var setting = await db.SystemSettings.FindAsync(new object[] { key }, ct);
                return setting?.Value;
            },
            expiration: TimeSpan.FromMinutes(5),
            tags: tags);
    }

    public async Task<T> GetValueAsync<T>(string key, T defaultValue)
    {
        var valueStr = await GetValueAsync(key);
        if (string.IsNullOrWhiteSpace(valueStr)) return defaultValue;

        try
        {
            return (T)Convert.ChangeType(valueStr, typeof(T));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to convert setting {Key} value '{Value}' to type {Type}", key, valueStr, typeof(T).Name);
            return defaultValue;
        }
    }

    public async Task SetValueAsync(string key, string? value, string category, string? description = null)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<DataContext>();

        var setting = await db.SystemSettings.FindAsync(key);
        if (setting == null)
        {
            setting = new SystemSetting
            {
                Key = key,
                Value = value,
                Category = category,
                Description = description
            };
            db.SystemSettings.Add(setting);
        }
        else
        {
            setting.Value = value;
            setting.Category = category;
            if (description != null) setting.Description = description;
        }

        await db.SaveChangesAsync();

        // Invalidate by tag for this specific setting and the "all" collection
        await _cache.RemoveByTagsAsync(new[] { $"setting:{key}", "settings:all" });

        // If value is not null, cache it immediately
        if (value != null)
        {
            var cacheKey = $"{CacheKeyPrefix}{key}";
            var tags = new[] { SettingsTag, $"setting:{key}" };
            await _cache.SetAsync(cacheKey, value, expiration: TimeSpan.FromMinutes(5), tags: tags);
        }
    }

    public async Task<List<SystemSetting>> GetAllAsync()
    {
        var cacheKey = $"{CacheKeyPrefix}all";
        var tags = new[] { SettingsTag, "settings:all" };

        return await _cache.GetOrCreateAsync(
            cacheKey,
            async ct =>
            {
                using var scope = _scopeFactory.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<DataContext>();
                return await db.SystemSettings
                    .OrderBy(s => s.Category)
                    .ThenBy(s => s.Key)
                    .ToListAsync(ct);
            },
            expiration: TimeSpan.FromMinutes(2),
            tags: tags);
    }
}
