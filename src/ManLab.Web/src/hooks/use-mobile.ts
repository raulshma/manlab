import { useEffect, useState } from "react"

const DEFAULT_MOBILE_BREAKPOINT_PX = 768

/**
 * Simple viewport-width mobile detector used by shadcn/ui Sidebar.
 *
 * NOTE: This intentionally uses a conservative breakpoint (768px) to match
 * Tailwind's `md` breakpoint.
 */
export function useIsMobile(breakpointPx: number = DEFAULT_MOBILE_BREAKPOINT_PX) {
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === "undefined") return false
    return window.innerWidth < breakpointPx
  })

  useEffect(() => {
    if (typeof window === "undefined") return

    const mediaQuery = window.matchMedia(`(max-width: ${breakpointPx - 1}px)`) // < md
    const update = () => setIsMobile(mediaQuery.matches)

    update()

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", update)
      return () => mediaQuery.removeEventListener("change", update)
    }

    // Safari fallback
    mediaQuery.addListener(update)
    return () => mediaQuery.removeListener(update)
  }, [breakpointPx])

  return isMobile
}
