"use client"

import * as React from "react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

const LS_KEY_HTML = "webflow-converter:html"
const LS_KEY_CSS = "webflow-converter:css"
const LS_KEY_JS = "webflow-converter:js"

export function useEditorPersistence(
  html: string,
  css: string,
  js: string,
  setHtml: (val: string) => void,
  setCss: (val: string) => void,
  setJs: (val: string) => void
): void {
  React.useEffect(() => {
    try {
      const storedHtml = window.localStorage.getItem(LS_KEY_HTML)
      const storedCss = window.localStorage.getItem(LS_KEY_CSS)
      const storedJs = window.localStorage.getItem(LS_KEY_JS)

      if (storedHtml) setHtml(storedHtml)
      if (storedCss) setCss(storedCss)
      if (storedJs) setJs(storedJs)
    } catch {
      // localStorage unavailable (private browsing, storage blocked, etc.) — ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  React.useEffect(() => {
    try {
      window.localStorage.setItem(LS_KEY_HTML, html)
      window.localStorage.setItem(LS_KEY_CSS, css)
      window.localStorage.setItem(LS_KEY_JS, js)
    } catch {
      // localStorage unavailable — ignore
    }
  }, [html, css, js])
}

export interface ConverterEditorProps {
  html: string
  css: string
  js: string
  onHtmlChange: (val: string) => void
  onCssChange: (val: string) => void
  onJsChange: (val: string) => void
  disabled?: boolean
}

type EditorTab = "html" | "css" | "js"

const TAB_CONFIG: Array<{
  value: EditorTab
  label: string
  placeholder: string
}> = [
  {
    value: "html",
    label: "HTML",
    placeholder: "Paste your HTML here…",
  },
  {
    value: "css",
    label: "CSS",
    placeholder:
      "Paste your CSS here… (or include a <style> block in the HTML tab)",
  },
  {
    value: "js",
    label: "JS",
    placeholder:
      "Paste GSAP or other scripts here… (or include <script> tags in the HTML tab)",
  },
]

export function ConverterEditor({
  html,
  css,
  js,
  onHtmlChange,
  onCssChange,
  onJsChange,
  disabled = false,
}: ConverterEditorProps) {
  const [activeTab, setActiveTab] = React.useState<EditorTab>("html")

  const values: Record<EditorTab, string> = { html, css, js }
  const onChangeHandlers: Record<EditorTab, (val: string) => void> = {
    html: onHtmlChange,
    css: onCssChange,
    js: onJsChange,
  }

  const handleClearAll = () => {
    onHtmlChange("")
    onCssChange("")
    onJsChange("")
  }

  return (
    <Tabs
      value={activeTab}
      onValueChange={(value) => setActiveTab(value as EditorTab)}
      className="flex h-full flex-col"
    >
      <div className="flex items-center justify-between">
        <TabsList variant="line">
          {TAB_CONFIG.map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              aria-label={
                values[tab.value].length > 0
                  ? `${tab.label} (has content)`
                  : undefined
              }
            >
              <span className="inline-flex items-center gap-1.5">
                {tab.label}
                {values[tab.value].length > 0 ? (
                  <span
                    data-testid={`${tab.value}-dot-indicator`}
                    aria-hidden="true"
                    className="h-1.5 w-1.5 rounded-full bg-primary"
                  />
                ) : null}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
        <AlertDialog>
          <AlertDialogTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled}
              >
                Clear all
              </Button>
            }
          />
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Clear all editors?</AlertDialogTitle>
              <AlertDialogDescription>
                This will remove the HTML, CSS, and JS content from all three
                editors. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleClearAll}>
                Clear all
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      {TAB_CONFIG.map((tab) => (
        <TabsContent
          key={tab.value}
          value={tab.value}
          className="min-h-0 flex-1 overflow-hidden"
        >
          <Textarea
            aria-label={`${tab.label} editor`}
            value={values[tab.value]}
            onChange={(event) => onChangeHandlers[tab.value](event.target.value)}
            placeholder={tab.placeholder}
            disabled={disabled}
            className={cn(
              "field-sizing-fixed h-full min-h-0 resize-none overflow-y-auto font-mono"
            )}
          />
        </TabsContent>
      ))}
    </Tabs>
  )
}
