import type { EmailAssistantContext, EmailEvaluation } from "./email-types.js";

/** Asks the LLM for a complete revised category-instruction prompt.
 * Example: `proposeCategoryPromptChange(context, "Newsletters", evaluation)`.
 */
export async function proposeCategoryPromptChange(
  context: EmailAssistantContext,
  category: string,
  email: EmailEvaluation,
): Promise<string> {
  const response = await context.generateText({
    prompt: proposalRequest(
      context.getPrompt("email-category-system"), category, email.description,
    ),
  });
  const proposal = response.text.trim();
  if (!proposal)
    throw new Error("The category-prompt proposal was empty; expected replacement instructions.");
  return proposal;
}

function proposalRequest(
  existingInstructions: string,
  category: string,
  summary: string,
): string {
  return [
    "Propose a complete replacement for the Email category instructions prompt.",
    "Keep the useful existing behavior while incorporating the newly approved category.",
    "Return only the proposed replacement prompt, with no commentary.",
    "",
    "Current Email category instructions:",
    existingInstructions,
    "",
    `Newly approved category: ${category}`,
    "Selected email summary:",
    summary,
  ].join("\n");
}
