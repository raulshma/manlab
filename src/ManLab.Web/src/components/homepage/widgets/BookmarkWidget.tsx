import { memo } from "react";
import { Bookmark, Globe, Github, ExternalLink, Zap } from "lucide-react";
import type { WidgetProps } from "@/types/dashboard";

export const BookmarkWidget = memo(function BookmarkWidget({ config }: WidgetProps) {
  const bookmarks = (config.bookmarks as Array<{ title: string; url: string; icon?: string }>) || [];
  const columns = (config.columns as number) || 3;

  const gridColsClass = {
    1: "grid-cols-1",
    2: "grid-cols-2",
    3: "grid-cols-3",
    4: "grid-cols-4",
    5: "grid-cols-5",
    6: "grid-cols-6",
  }[columns] || "grid-cols-3";

  return (
    <div className="space-y-3">
      <div className={`grid ${gridColsClass} gap-3`}>
        {bookmarks.map((bookmark, index) => {
          const IconComponent = getBookmarkIcon(bookmark.icon);

          return (
            <a
              key={index}
              href={bookmark.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex flex-col items-center justify-center p-4 bg-muted/30 hover:bg-muted/50 rounded-lg transition-all hover:shadow-md"
            >
              <div className="flex items-center justify-center mb-3 h-12 w-12 rounded-lg bg-primary/10 group-hover:bg-primary/20">
                {IconComponent && <IconComponent className="h-6 w-6 text-primary" />}
                {!IconComponent && <Bookmark className="h-6 w-6 text-primary" />}
              </div>
              <span className="text-sm font-medium text-center line-clamp-2 group-hover:text-primary transition-colors">
                {bookmark.title}
              </span>
              <ExternalLink className="h-3 w-3 text-muted-foreground/50 opacity-0 group-hover:opacity-100 transition-opacity mt-2" />
            </a>
          );
        })}
        {bookmarks.length === 0 && (
          <div className="col-span-full flex items-center justify-center p-8 text-muted-foreground/50">
            <Bookmark className="h-12 w-12 text-muted-foreground/30" />
            <p className="text-sm text-center mt-3">No bookmarks configured</p>
          </div>
        )}
      </div>
    </div>
  );
});

function getBookmarkIcon(iconName?: string): React.ElementType {
  const iconMap: Record<string, React.ElementType> = {
    globe: Globe,
    github: Github,
    bolt: Zap,
  };
  return iconMap[iconName || ""] || Bookmark;
}
