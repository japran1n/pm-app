import { NextResponse, type NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

import { createClient as createServerSupabaseClient } from "@/lib/supabase/server";

// W6 (docs/docs-system-plan.md) — AI Edit for the Markdown doc editor
// (components/docs/markdown-editor.tsx). The user selects/writes an
// instruction in the toolbar's Sparkles popover; this route rewrites the
// whole document via Anthropic and hands the new Markdown string back for
// `editor.commands.setContent(result)`. Auth: cookie-based Supabase session
// (same pattern as Server Actions/Server Components in this app) — this is
// not scoped to a specific doc id (the client sends the current in-editor
// content directly), so the only authorization check needed is "is this a
// signed-in user of the app," mirrored on any other authenticated-but-
// doc-agnostic route in this codebase would be.

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as Record<string, unknown>).content !== "string" ||
    typeof (body as Record<string, unknown>).instruction !== "string"
  ) {
    return NextResponse.json(
      { error: "Expected { content: string; instruction: string }." },
      { status: 400 },
    );
  }

  const { content, instruction } = body as { content: string; instruction: string };

  if (!instruction.trim()) {
    return NextResponse.json({ error: "Instruction is required." }, { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("docs/ai-edit: ANTHROPIC_API_KEY is not configured.");
    return NextResponse.json(
      { error: "AI edit is not configured. Please try again later." },
      { status: 500 },
    );
  }

  const anthropic = new Anthropic({ apiKey });

  const prompt = `You are a document editor. The user has a Markdown document and wants you to modify it according to their instruction.
Return ONLY the modified Markdown document — no explanation, no preamble, no code fences around the whole document.
Instruction: ${instruction}
Document:
${content}`;

  try {
    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 8192,
      messages: [{ role: "user", content: prompt }],
    });

    const result = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();

    if (!result) {
      return NextResponse.json(
        { error: "AI edit returned an empty result. Please try again." },
        { status: 500 },
      );
    }

    return NextResponse.json({ result }, { status: 200 });
  } catch (error) {
    console.error("docs/ai-edit: Anthropic request failed:", error);
    return NextResponse.json(
      { error: "AI edit failed. Please try again." },
      { status: 500 },
    );
  }
}
