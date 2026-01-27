using Microsoft.Extensions.Caching.Memory;
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
    private readonly IMemoryCache _cache;
    private readonly ILogger<SettingsService> _logger;
    private const string CacheKeyPrefix = "SystemSetting_";

    public SettingsService(
        IServiceScopeFactory scopeFactory,
        IMemoryCache cache,
        ILogger<SettingsService> logger)
    {
        _scopeFactory = scopeFactory;
        _cache = cache;
        _logger = logger;
    }

    public async Task<string?> GetValueAsync(string key)
    {
        if (_cache.TryGetValue($"{CacheKeyPrefix}{key}", out string? cachedValue))
        {
            return cachedValue;
        }

        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<DataContext>();

        var setting = await db.SystemSettings.FindAsync(key);
        var value = setting?.Value;

        // Cache for 5 minutes
        _cache.Set($"{CacheKeyPrefix}{key}", value, TimeSpan.FromMinutes(5));

        return value;
    }

    public async Task<T> GetValueAsync<T>(string key, T defaultValue)
    {
        var valueStr = await GetValueAsync(key);
        if (valueStr == null) return defaultValue;

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
            setting.Category = category; // Update category just in case
            if (description != null) setting.Description = description;
        }

        await db.SaveChangesAsync();

        // Update cache
        _cache.Set($"{CacheKeyPrefix}{key}", value, TimeSpan.FromMinutes(5));
    }

    public async Task<List<SystemSetting>> GetAllAsync()
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<DataContext>();
        return await db.SystemSettings.OrderBy(s => s.Category).ThenBy(s => s.Key).ToListAsync();
    }
}
