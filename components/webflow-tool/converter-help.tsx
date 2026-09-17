// F030 (AS-124): collapsed-by-default help section explaining the three key
// constraints of the converter -- class selectors only, breakpoint pixel
// mapping, and images becoming empty blocks. Uses a native <details>/<summary>
// element so it is collapsed by default without any extra state management.

export function ConverterHelp() {
  return (
    <details className="group rounded-md border border-border bg-secondary/30 px-4 py-2 text-sm text-muted-foreground">
      <summary className="cursor-pointer select-none list-none font-medium text-foreground">
        How this works
      </summary>

      <div className="mt-3 flex flex-col gap-3 text-sm text-muted-foreground">
        <div>
          <p className="font-medium text-foreground">Class selectors only</p>
          <p>
            The converter only reads <code className="font-mono">.class</code>{" "}
            selectors. Element selectors (div, p, h1...) and attribute
            selectors are skipped. If you want to style an element, give it a
            class.
          </p>
        </div>

        <div>
          <p className="font-medium text-foreground">Breakpoint pixel values</p>
          <p>
            The converter maps media queries to Webflow&apos;s breakpoints:
          </p>
          <ul className="ml-4 list-disc">
            <li>
              <code className="font-mono">max-width: 991px</code> → Tablet
              (medium)
            </li>
            <li>
              <code className="font-mono">max-width: 767px</code> → Mobile
              Landscape (small)
            </li>
            <li>
              <code className="font-mono">max-width: 479px</code> → Mobile
              Portrait (tiny)
            </li>
            <li>
              <code className="font-mono">min-width: 1280px</code> → Large
            </li>
            <li>
              <code className="font-mono">min-width: 1440px</code> → XL
            </li>
            <li>
              <code className="font-mono">min-width: 1920px</code> → XXL
            </li>
          </ul>
          <p>Other breakpoint values are not converted.</p>
        </div>

        <div>
          <p className="font-medium text-foreground">
            Images become empty blocks
          </p>
          <p>
            <code className="font-mono">&lt;img&gt;</code> elements become
            plain Webflow blocks with no <code className="font-mono">src</code>
            . Swap in the real image from Webflow&apos;s Assets panel after
            pasting.
          </p>
        </div>
      </div>
    </details>
  )
}
