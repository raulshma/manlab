import * as React from "react";

/**
 * A simple WidthProvider HOC that uses ResizeObserver to provide width to the wrapped component.
 * Replaces the broken WidthProvider from react-grid-layout v2.2.2.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function WidthProvider(ComposedComponent: React.ComponentType<any>) {
  return function WidthProviderWrapper(props: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
    const [width, setWidth] = React.useState<number | null>(null);
    const elementRef = React.useRef<HTMLDivElement>(null);
    const [mounted, setMounted] = React.useState(false);

    React.useEffect(() => {
      setMounted(true);
      const el = elementRef.current;
      if (!el) return;

      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
           // Use contentRect.width for precise content box measurement
           // But offsetWidth includes padding/borders which might be what RGL wants if sizing = border-box
           // RGL usually expects the container width.
           // Let's use contentRect.width as it's the available space.
           // However, if the container has padding, contentRect excludes it.
           // RGL often wants the full width to divide into cols.
           // offsetWidth is safer for "container size".
           if (entry.contentBoxSize) {
               // ResizeObserver often returns content box
               // We will use offsetWidth from the element directly to be safe and match standard "container width" behavior
               setWidth(el.offsetWidth);
           }
        }
      });
      
      observer.observe(el);
      // Initial measure
      setWidth(el.offsetWidth);

      return () => observer.disconnect();
    }, []);

    // On server/initial render, we might not have width.
    // RGL requires a width.
    // Default to 1200 or props.width if provided.
    const currentWidth = width ?? props.width ?? 1200;

    return (
      <div 
        className={props.className} 
        style={{ ...props.style }} 
        ref={elementRef}
      >
        {mounted && width !== null ? (
            <ComposedComponent 
                {...props} 
                width={currentWidth} 
                // Pass empty className/style to inner component to avoid duplicating styles on both wrapper and inner
                // ONLY if the composed component applies them to the root.
                // RGL applies className to its root.
                // So we should strip them from props passed down, as we applied them to the wrapper.
                className=""
                style={{}}
            />
        ) : (
            // Render basic placeholder or nothing until measured
             <div style={{ height: '100px' }} />
        )}
      </div>
    );
  };
}
