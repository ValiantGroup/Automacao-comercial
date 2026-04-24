export function extractText(content: any): string {
  if (typeof content === "string") return content;

  if (Array.isArray(content)) {
    return content.map((c) => c.text || "").join("");
  }

  if (content?.text) return content.text;

  return JSON.stringify(content);
}