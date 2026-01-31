using ManLab.Shared.Dtos;
using Microsoft.Extensions.Caching.Memory;

namespace ManLab.Server.Services;

/// <summary>
/// Service for fetching and caching RSS/Atom feeds.
/// </summary>
public class RssFeedService
{
    private readonly IMemoryCache _cache;
    private readonly ILogger<RssFeedService> _logger;
    private readonly HttpClient _httpClient;
    private readonly TimeSpan _defaultCacheDuration = TimeSpan.FromMinutes(5);

    public RssFeedService(IMemoryCache cache, ILogger<RssFeedService> logger, IHttpClientFactory httpClientFactory)
    {
        _cache = cache;
        _logger = logger;
        _httpClient = httpClientFactory.CreateClient("rss-feeds");
        _httpClient.Timeout = TimeSpan.FromSeconds(10);
    }

    /// <summary>
    /// Fetches RSS feed from URL with caching.
    /// </summary>
    public async Task<RssFeedResponse> FetchFeedAsync(
        string feedUrl,
        int maxItems = 10,
        TimeSpan? customCacheDuration = null)
    {
        if (string.IsNullOrWhiteSpace(feedUrl))
        {
            return new RssFeedResponse { FeedUrl = feedUrl };
        }

        var cacheKey = $"rss_feed_{feedUrl}_{maxItems}";
        var cacheDuration = customCacheDuration ?? _defaultCacheDuration;

        if (_cache.TryGetValue<RssFeedResponse>(cacheKey, out var cachedResponse) && cachedResponse is not null)
        {
            _logger.LogDebug("Returning cached RSS feed for {FeedUrl}", feedUrl);
            return cachedResponse;
        }

        try
        {
            _logger.LogInformation("Fetching RSS feed from {FeedUrl}", feedUrl);

            var response = await _httpClient.GetAsync(feedUrl);
            response.EnsureSuccessStatusCode();

            var content = await response.Content.ReadAsStringAsync();
            var doc = new System.Xml.XmlDocument();
            doc.LoadXml(content);

            var feedTitle = "";
            var items = new List<RssFeedItemDto>();

            var feedNode = doc.DocumentElement;

            if (feedNode?.LocalName == "feed" || feedNode?.Name == "feed")
            {
                var titleNode = feedNode.SelectSingleNode(".//*[local-name()='title']");
                feedTitle = titleNode?.InnerText ?? "Untitled Feed";

                var feedItemNodes = feedNode.SelectNodes(".//*[local-name()='entry']");
                var itemCount = Math.Min(feedItemNodes?.Count ?? 0, maxItems);
                items = (feedItemNodes?.OfType<System.Xml.XmlNode>() ?? Enumerable.Empty<System.Xml.XmlNode>()).Take(itemCount).Select(item => new RssFeedItemDto
                {
                    Title = item.SelectSingleNode(".//*[local-name()='title']")?.InnerText ?? "Untitled",
                    Link = item.SelectSingleNode(".//*[local-name()='link' and @rel='alternate']")?.Attributes?["href"]?.Value ??
                                item.SelectSingleNode(".//*[local-name()='link' and @type='text/html']")?.Attributes?["href"]?.Value ??
                                item.SelectSingleNode(".//*[local-name()='link']")?.InnerText ??
                                string.Empty,
                    Description = item.SelectSingleNode(".//*[local-name()='summary']")?.InnerText ?? string.Empty,
                    PublishedAt = item.SelectSingleNode(".//*[local-name()='published']")?.InnerText != null
                        ? System.DateTime.TryParse(item.SelectSingleNode(".//*[local-name()='published']")?.InnerText ?? "", out var pubDate)
                            ? pubDate
                            : null
                        : null,
                    Author = item.SelectSingleNode(".//*[local-name()='author']/*[local-name()='name']")?.InnerText,
                    ThumbnailUrl = TryExtractThumbnail(item)
                }).ToList();
            }
            else if (feedNode?.LocalName == "rss" || feedNode?.Name == "rss")
            {
                var channelNode = feedNode.SelectSingleNode(".//*[local-name()='channel']");
                if (channelNode == null) channelNode = feedNode.SelectSingleNode(".//*[local-name()='channel']");

                var titleNode = channelNode?.SelectSingleNode(".//*[local-name()='title']");
                feedTitle = titleNode?.InnerText ?? "Untitled Feed";

                var rssItemNodes = channelNode?.SelectNodes(".//*[local-name()='item']") ?? feedNode.SelectNodes(".//*[local-name()='item']");
                var itemCount = Math.Min(rssItemNodes?.Count ?? 0, maxItems);
                items = (rssItemNodes?.OfType<System.Xml.XmlNode>() ?? Enumerable.Empty<System.Xml.XmlNode>()).Take(itemCount).Select(item => new RssFeedItemDto
                {
                    Title = item.SelectSingleNode(".//*[local-name()='title']")?.InnerText ?? "Untitled",
                    Link = item.SelectSingleNode(".//*[local-name()='link']")?.InnerText ?? 
                                item.SelectSingleNode(".//*[local-name()='guid']")?.InnerText ?? 
                                string.Empty,
                    Description = item.SelectSingleNode(".//*[local-name()='description']")?.InnerText ?? string.Empty,
                    PublishedAt = item.SelectSingleNode(".//*[local-name()='pubDate']")?.InnerText != null
                        ? System.DateTime.TryParse(item.SelectSingleNode(".//*[local-name()='pubDate']")?.InnerText ?? "", out var pubDate)
                            ? pubDate
                            : null
                        : null,
                    Author = item.SelectSingleNode(".//*[local-name()='author']")?.InnerText,
                    ThumbnailUrl = TryExtractThumbnail(item)
                }).ToList();
            }

            var feedResponse = new RssFeedResponse
            {
                FeedUrl = feedUrl,
                FeedTitle = feedTitle,
                Items = items,
                CachedAt = System.DateTime.UtcNow
            };

            _cache.Set(cacheKey, feedResponse, cacheDuration);
            _logger.LogInformation("Successfully fetched and cached RSS feed {FeedTitle} with {ItemCount} items",
                feedResponse.FeedTitle, feedResponse.Items.Count);

            return feedResponse;
        }
        catch (System.Net.Http.HttpRequestException ex)
        {
            _logger.LogWarning(ex, "HTTP error fetching RSS feed from {FeedUrl}: {Message}",
                feedUrl, ex.Message);
            return new RssFeedResponse
            {
                FeedUrl = feedUrl,
                FeedTitle = "Error",
                Items = []
            };
        }
        catch (System.Xml.XmlException ex)
        {
            _logger.LogWarning(ex, "XML parsing error for RSS feed {FeedUrl}: {Message}",
                feedUrl, ex.Message);
            return new RssFeedResponse
            {
                FeedUrl = feedUrl,
                FeedTitle = "Parse Error",
                Items = []
            };
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Unexpected error fetching RSS feed from {FeedUrl}: {Message}",
                feedUrl, ex.Message);
            return new RssFeedResponse
            {
                FeedUrl = feedUrl,
                FeedTitle = "Error",
                Items = []
            };
        }
    }

    /// <summary>
    /// Validates an RSS feed URL by attempting to fetch and parse it.
    /// </summary>
    public async Task<RssFeedValidationResponse> ValidateFeedAsync(string feedUrl)
    {
        if (string.IsNullOrWhiteSpace(feedUrl))
        {
            return new RssFeedValidationResponse
            {
                Valid = false,
                Error = "Feed URL is required"
            };
        }

        try
        {
            _logger.LogDebug("Validating RSS feed {FeedUrl}", feedUrl);

            var response = await _httpClient.SendAsync(new System.Net.Http.HttpRequestMessage(System.Net.Http.HttpMethod.Head, feedUrl));
            if (!response.IsSuccessStatusCode)
            {
                return new RssFeedValidationResponse
                {
                    Valid = false,
                    Error = $"Failed to fetch feed: {response.StatusCode}"
                };
            }

            var content = await _httpClient.GetStringAsync(feedUrl);
            var doc = new System.Xml.XmlDocument();
            doc.LoadXml(content);

            var feedTitle = "";
            var feedNode = doc.DocumentElement;

            if (feedNode?.LocalName == "feed" || feedNode?.Name == "feed")
            {
                var titleNode = feedNode.SelectSingleNode(".//*[local-name()='title']");
                feedTitle = titleNode?.InnerText ?? "Untitled Feed";
            }
            else if (feedNode?.LocalName == "rss" || feedNode?.Name == "rss")
            {
                var channelNode = feedNode.SelectSingleNode(".//*[local-name()='channel']");
                if (channelNode == null) channelNode = feedNode.SelectSingleNode(".//*[local-name()='channel']");

                var titleNode = channelNode?.SelectSingleNode(".//*[local-name()='title']");
                feedTitle = titleNode?.InnerText ?? "Untitled Feed";
            }

            return new RssFeedValidationResponse
            {
                Valid = true,
                FeedTitle = feedTitle
            };
        }
        catch (System.Net.Http.HttpRequestException ex)
        {
            _logger.LogDebug(ex, "RSS feed validation failed for {FeedUrl}: {Message}",
                feedUrl, ex.Message);
            return new RssFeedValidationResponse
            {
                Valid = false,
                Error = "Could not connect to feed URL"
            };
        }
        catch (System.Xml.XmlException ex)
        {
            _logger.LogDebug(ex, "RSS feed validation failed for {FeedUrl}: {Message}",
                feedUrl, ex.Message);
            return new RssFeedValidationResponse
            {
                Valid = false,
                Error = "Feed is not valid RSS or Atom XML"
            };
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Unexpected error validating RSS feed {FeedUrl}: {Message}",
                feedUrl, ex.Message);
            return new RssFeedValidationResponse
            {
                Valid = false,
                Error = "An unexpected error occurred"
            };
        }
    }

    private static string? TryExtractThumbnail(System.Xml.XmlNode item)
    {
        try
        {
            var thumbnailNode = item.SelectSingleNode(".//*[local-name()='thumbnail']");
            if (thumbnailNode != null)
            {
                var urlAttr = thumbnailNode.Attributes?["url"];
                if (urlAttr != null) return urlAttr.Value;
            }

            var enclosureNode = item.SelectSingleNode(".//*[local-name()='enclosure']");
            if (enclosureNode != null)
            {
                var typeAttr = enclosureNode.Attributes?["type"];
                if (typeAttr != null && typeAttr.Value?.StartsWith("image/") == true)
                {
                    var urlAttr = enclosureNode.Attributes?["url"];
                    if (urlAttr != null) return urlAttr.Value;
                }
            }

            return null;
        }
        catch
        {
            return null;
        }
    }
}
