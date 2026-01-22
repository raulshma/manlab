import { toast } from "sonner";
import { isNotificationsEnabled } from "@/lib/network-preferences";

function shouldNotify(): boolean {
  return isNotificationsEnabled();
}

export const notify = {
  success: (message: string) => {
    if (shouldNotify()) toast.success(message);
  },
  error: (message: string) => {
    if (shouldNotify()) toast.error(message);
  },
  info: (message: string) => {
    if (shouldNotify()) toast.info(message);
  },
  warning: (message: string) => {
    if (shouldNotify()) toast.warning(message);
  },
};