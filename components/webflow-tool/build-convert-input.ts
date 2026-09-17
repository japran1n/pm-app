/**
 * Prepends JS-tab content as a <script> block to the HTML before conversion.
 * The convert() engine then extracts it via js-extract.ts.
 * Called by F031 before invoking the server action.
 */
export function buildConvertInput(html: string, js: string): string {
  const trimmedJs = js.trim();
  if (!trimmedJs) return html;
  return `<script>\n${trimmedJs}\n</script>\n${html}`;
}
