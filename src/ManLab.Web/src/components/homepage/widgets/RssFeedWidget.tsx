import { memo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchRssFeed } from "@/api";
import { Rss, ExternalLink, Calendar } from "lucide-react";
import type { WidgetProps } from "@/types/dashboard";

export const RssFeedWidget = memo(function RssFeedWidget({ config }: WidgetProps) {
  const feedUrl = (config.feedUrl as string) || "";
  const maxItems = (config.maxItems as number) || 10;
  const showThumbnails = (config.showThumbnails as boolean) ?? true;

  const { data: feed, isLoading, error } = useQuery({
    queryKey: ["rssFeed", feedUrl, maxItems],
    queryFn: () => fetchRssFeed(feedUrl, maxItems),
    enabled: !!feedUrl,
    staleTime: 300_000,
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-muted-foreground/70">
          <Rss className="h-4 w-4 animate-pulse" />
          <span className="text-sm">Loading feed...</span>
        </div>
      </div>
    );
  }

  if (error || !feedUrl) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-destructive">
          <Rss className="h-4 w-4" />
          <span className="text-sm">
            {error ? "Failed to load feed" : "No feed URL configured"}
          </span>
        </div>
      </div>
    );
  }

  if (!feed || feed.items.length === 0) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-muted-foreground/70">
          <Calendar className="h-4 w-4" />
          <span className="text-sm">No items available</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base font-semibold">{feed.feedTitle}</h3>
        <a
          href={feed.feedUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
        >
          <ExternalLink className="h-3 w-3" />
          Visit Feed
        </a>
      </div>
      <div className="space-y-2">
        {feed.items.slice(0, maxItems).map((item, index) => (
          <div key={index} className="group relative p-3 hover:bg-muted/30 transition-colors rounded-lg">
            <a
              href={item.link}
              target="_blank"
              rel="noopener noreferrer"
              className="block"
            >
              <div className="flex items-start gap-3">
                {showThumbnails && item.thumbnailUrl && (
                  <img
                    src={item.thumbnailUrl}
                    alt=""
                    className="w-16 h-16 rounded object-cover flex-shrink-0"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <h4 className="font-medium text-sm text-foreground group-hover:text-primary transition-colors mb-1 line-clamp-2">
                    {item.title}
                  </h4>
                  {item.description && (
                    <p className="text-xs text-muted-foreground/80 line-clamp-2">
                      {item.description}
                    </p>
                  )}
                  <div className="flex items-center gap-3 text-xs text-muted-foreground/60 mt-2">
                    {item.publishedAt && (
                      <>
                        <Calendar className="h-3 w-3" />
                        <span>
                          {new Date(item.publishedAt).toLocaleDateString()}
                        </span>
                      </>
                    )}
                    {item.author && (
                      <>
                        <span>•</span>
                        <span>{item.author}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </a>
          </div>
        ))}
      </div>
      {feed.cachedAt && (
        <div className="text-xs text-muted-foreground/50 text-center pt-2">
          Cached: {new Date(feed.cachedAt).toLocaleString()}
        </div>
      )}
    </div>
  );
});
