import { Anthropic } from '@anthropic-ai/sdk';
import * as vscode from 'vscode';

import { convertDataPart } from './content';

export type CountableBlock =
    | Anthropic.TextBlockParam
    | Anthropic.ImageBlockParam;

// ~4 chars/token on prose but ~2.5 on dense source; estimating low is
// deliberate, since undercounting breaks a caller's budgeting while
// overcounting only wastes context.
export const CHARS_PER_TOKEN = 3.5;

// An estimate at this fraction still fits the real budget down to 2.1
// chars/token (0.6 * 3.5 / 2.1 = 1).
export const EXACT_COUNT_FRACTION = 0.6;

export async function countTokens(
    anthropic: Anthropic,
    model: vscode.LanguageModelChatInformation,
    text: string | vscode.LanguageModelChatRequestMessage,
    token: vscode.CancellationToken
): Promise<number> {
    // VS Code calls this thousands of times per chat session, so the
    // common path stays local; only estimates near the input budget are
    // worth a network round-trip.
    const blocks =
        typeof text === 'string'
            ? [{ type: 'text' as const, text }]
            : toCountableBlocks(text.content);
    const estimate = estimateTokens(blocks);

    // Images contribute no characters, so the estimate cannot see them.
    const hasImage = blocks.some((block) => block.type === 'image');
    const threshold = model.maxInputTokens * EXACT_COUNT_FRACTION;
    if (blocks.length === 0 || (!hasImage && estimate <= threshold)) {
        return estimate;
    }

    const controller = new AbortController();
    const cancellation = token.onCancellationRequested(() =>
        controller.abort()
    );
    try {
        const count = await anthropic.messages.countTokens(
            {
                model: model.id,
                messages: [{ role: 'user', content: blocks }],
            },
            { signal: controller.signal }
        );
        return count.input_tokens;
    } catch {
        // a budgeting caller needs a number, not an exception
        return estimate;
    } finally {
        cancellation.dispose();
    }
}

export function estimateTokens(blocks: readonly CountableBlock[]): number {
    const chars = blocks.reduce(
        (n, block) => n + (block.type === 'text' ? block.text.length : 0),
        0
    );
    return Math.ceil(chars / CHARS_PER_TOKEN);
}

// tool_use/tool_result blocks would need their counterparts to form a
// valid request, so they are flattened to their text rendering; images
// are the reason to ask the API at all and stay exact.
export function toCountableBlocks(
    parts: ReadonlyArray<unknown>
): CountableBlock[] {
    const blocks: CountableBlock[] = [];

    for (const part of parts) {
        if (part instanceof vscode.LanguageModelTextPart) {
            if (part.value.length > 0) {
                blocks.push({ type: 'text', text: part.value });
            }
        } else if (part instanceof vscode.LanguageModelToolCallPart) {
            blocks.push({
                type: 'text',
                text: part.name + JSON.stringify(part.input),
            });
        } else if (part instanceof vscode.LanguageModelToolResultPart) {
            blocks.push(...toCountableBlocks(part.content));
        } else if (part instanceof vscode.LanguageModelDataPart) {
            const block = convertDataPart(part);
            if (block) {
                blocks.push(block);
            }
        }
    }

    return blocks;
}
