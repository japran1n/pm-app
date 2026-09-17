"use client"

import * as React from "react"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

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

  return (
    <Tabs
      value={activeTab}
      onValueChange={(value) => setActiveTab(value as EditorTab)}
      className="flex h-full flex-col"
    >
      <TabsList variant="line">
        {TAB_CONFIG.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value}>
            <span className="inline-flex items-center gap-1.5">
              {tab.label}
              {values[tab.value].length > 0 ? (
                <span
                  data-testid={`${tab.value}-dot-indicator`}
                  className="h-1.5 w-1.5 rounded-full bg-blue-500"
                  aria-label={`${tab.label} has content`}
                />
              ) : null}
            </span>
          </TabsTrigger>
        ))}
      </TabsList>
      {TAB_CONFIG.map((tab) => (
        <TabsContent key={tab.value} value={tab.value} className="flex-1">
          <Textarea
            aria-label={`${tab.label} editor`}
            value={values[tab.value]}
            onChange={(event) => onChangeHandlers[tab.value](event.target.value)}
            placeholder={tab.placeholder}
            disabled={disabled}
            className={cn("h-full min-h-64 resize-none font-mono")}
          />
        </TabsContent>
      ))}
    </Tabs>
  )
}
