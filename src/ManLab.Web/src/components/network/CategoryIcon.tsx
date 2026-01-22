import {
  Database,
  Globe,
  HardDrive,
  Mail,
  Server,
  Terminal,
} from "lucide-react";
import type { ServiceCategory } from "./port-constants";

export function CategoryIcon({
  category,
  className,
}: {
  category: ServiceCategory;
  className?: string;
}) {
  switch (category) {
    case "web":
      return <Globe className={className} />;
    case "database":
      return <Database className={className} />;
    case "remote":
      return <Terminal className={className} />;
    case "mail":
      return <Mail className={className} />;
    case "file":
      return <HardDrive className={className} />;
    default:
      return <Server className={className} />;
  }
}
