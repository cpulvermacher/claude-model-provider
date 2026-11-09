import { Anthropic } from '@anthropic-ai/sdk';
import * as vscode from 'vscode';

/**
 * VS Code's stable API has no thinking part, so thinking blocks travel
 * through the chat history as data parts of this type. With thinking on, the
 * API needs them (including their signature) back in front of the assistant
 * turn whose tool calls are being answered.
 */
export const THINKING_MIME_TYPE =
    'application/vnd.claude-model-provider.thinking+json';

export type ThinkingBlockParam =
    | Anthropic.ThinkingBlockParam
    | Anthropic.RedactedThinkingBlockParam;

interface ThinkingPayload {
    /** signatures are only valid for the model that produced them */
    model: string;
    block: ThinkingBlockParam;
}

export function createThinkingPart(
    model: string,
    block: Anthropic.ThinkingBlock | Anthropic.RedactedThinkingBlock
): vscode.LanguageModelDataPart {
    const param: ThinkingBlockParam =
        block.type === 'thinking'
            ? {
                  type: 'thinking',
                  thinking: block.thinking,
                  signature: block.signature,
              }
            : { type: 'redacted_thinking', data: block.data };
    const payload: ThinkingPayload = { model, block: param };
    return vscode.LanguageModelDataPart.json(payload, THINKING_MIME_TYPE);
}

/** the thinking block in `part`, if it is one that `model` produced */
export function parseThinkingPart(
    part: vscode.LanguageModelDataPart,
    model?: string
): ThinkingBlockParam | undefined {
    if (part.mimeType !== THINKING_MIME_TYPE) {
        return undefined;
    }
    try {
        const payload = JSON.parse(
            new TextDecoder().decode(part.data)
        ) as ThinkingPayload;
        if (model !== undefined && payload.model !== model) {
            return undefined;
        }
        return payload.block;
    } catch {
        return undefined;
    }
}

export function convertDataPart(
    part: vscode.LanguageModelDataPart
): Anthropic.ImageBlockParam | undefined {
    if (!part.mimeType.startsWith('image/')) {
        return undefined;
    }

    return {
        type: 'image',
        source: {
            type: 'base64',
            media_type:
                part.mimeType as Anthropic.Base64ImageSource['media_type'],
            data: Buffer.from(part.data).toString('base64'),
        },
    };
}
