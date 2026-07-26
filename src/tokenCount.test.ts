import { Anthropic } from '@anthropic-ai/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';

import {
    CHARS_PER_TOKEN,
    countTokens,
    EXACT_COUNT_FRACTION,
    estimateTokens,
    toCountableBlocks,
} from './tokenCount';

const maxInputTokens = 1000;
const threshold = maxInputTokens * EXACT_COUNT_FRACTION;

const model: vscode.LanguageModelChatInformation = {
    id: 'claude-test-1-0',
    name: 'Claude Test',
    family: 'claude',
    version: '1.0',
    maxInputTokens,
    maxOutputTokens: 64000,
    capabilities: { toolCalling: true, imageInput: true },
};

let apiCountTokens: ReturnType<typeof vi.fn>;
let anthropic: Anthropic;

beforeEach(() => {
    apiCountTokens = vi.fn().mockResolvedValue({ input_tokens: 42 });
    anthropic = {
        messages: { countTokens: apiCountTokens },
    } as unknown as Anthropic;
});

function createToken() {
    let listener: (() => void) | undefined;
    const dispose = vi.fn();
    const token: vscode.CancellationToken = {
        isCancellationRequested: false,
        onCancellationRequested: (fn: (e: unknown) => unknown) => {
            listener = () => fn(undefined);
            return { dispose };
        },
    };
    return { token, dispose, cancel: () => listener?.() };
}

/** a message whose content is `parts` */
function message(parts: unknown[]): vscode.LanguageModelChatRequestMessage {
    return {
        role: vscode.LanguageModelChatMessageRole.User,
        content: parts,
        name: undefined,
    } as unknown as vscode.LanguageModelChatRequestMessage;
}

/** text long enough to produce `tokens` estimated tokens */
function textOfTokens(tokens: number) {
    return 'a'.repeat(Math.floor(tokens * CHARS_PER_TOKEN));
}

describe('estimateTokens', () => {
    it('divides characters by CHARS_PER_TOKEN, rounding up', () => {
        expect(estimateTokens([{ type: 'text', text: 'a'.repeat(35) }])).toBe(
            10
        );
        expect(estimateTokens([{ type: 'text', text: 'a' }])).toBe(1);
        expect(estimateTokens([{ type: 'text', text: '' }])).toBe(0);
        expect(estimateTokens([])).toBe(0);
    });

    it('sums over all text blocks and ignores images', () => {
        const blocks: Anthropic.ContentBlockParam[] = [
            { type: 'text', text: 'a'.repeat(35) },
            {
                type: 'image',
                source: { type: 'base64', media_type: 'image/png', data: 'x' },
            },
            { type: 'text', text: 'a'.repeat(35) },
        ];
        expect(
            estimateTokens(blocks as Parameters<typeof estimateTokens>[0])
        ).toBe(20);
    });
});

describe('toCountableBlocks', () => {
    it('converts text parts, dropping empty ones', () => {
        const parts = [
            new vscode.LanguageModelTextPart('hello'),
            new vscode.LanguageModelTextPart(''),
        ];
        expect(toCountableBlocks(parts)).toEqual([
            { type: 'text', text: 'hello' },
        ]);
    });

    it('flattens tool calls to name plus serialized input', () => {
        const parts = [
            new vscode.LanguageModelToolCallPart('id1', 'readFile', {
                path: 'a.ts',
            }),
        ];
        expect(toCountableBlocks(parts)).toEqual([
            { type: 'text', text: 'readFile{"path":"a.ts"}' },
        ]);
    });

    it('flattens nested tool result content', () => {
        const parts = [
            new vscode.LanguageModelToolResultPart('id1', [
                new vscode.LanguageModelTextPart('result'),
                new vscode.LanguageModelDataPart(
                    new Uint8Array([1, 2, 3]),
                    'image/png'
                ),
            ]),
        ];
        expect(toCountableBlocks(parts)).toEqual([
            { type: 'text', text: 'result' },
            {
                type: 'image',
                source: {
                    type: 'base64',
                    media_type: 'image/png',
                    data: 'AQID',
                },
            },
        ]);
    });

    it('keeps image data parts exact', () => {
        const parts = [
            new vscode.LanguageModelDataPart(
                new Uint8Array([255, 0, 255]),
                'image/jpeg'
            ),
        ];
        expect(toCountableBlocks(parts)).toEqual([
            {
                type: 'image',
                source: {
                    type: 'base64',
                    media_type: 'image/jpeg',
                    data: Buffer.from([255, 0, 255]).toString('base64'),
                },
            },
        ]);
    });

    it('ignores non-image data parts and unknown parts', () => {
        const parts = [
            new vscode.LanguageModelDataPart(
                new Uint8Array([1]),
                'application/json'
            ),
            { some: 'unknown part' },
        ];
        expect(toCountableBlocks(parts)).toEqual([]);
    });
});

describe('countTokens', () => {
    it('estimates a plain string locally', async () => {
        const { token } = createToken();

        const count = await countTokens(
            anthropic,
            model,
            'a'.repeat(35),
            token
        );

        expect(count).toBe(10);
        expect(apiCountTokens).not.toHaveBeenCalled();
    });

    it('estimates a message from all its parts', async () => {
        const { token } = createToken();
        const msg = message([
            new vscode.LanguageModelTextPart('a'.repeat(35)),
            new vscode.LanguageModelToolResultPart('id1', [
                new vscode.LanguageModelTextPart('a'.repeat(35)),
            ]),
        ]);

        expect(await countTokens(anthropic, model, msg, token)).toBe(20);
        expect(apiCountTokens).not.toHaveBeenCalled();
    });

    it('returns 0 without an API call for a message with no countable parts', async () => {
        const { token } = createToken();

        const count = await countTokens(anthropic, model, message([]), token);

        expect(count).toBe(0);
        expect(apiCountTokens).not.toHaveBeenCalled();
    });

    it('stays local right up to the exact-count threshold', async () => {
        const { token } = createToken();

        const count = await countTokens(
            anthropic,
            model,
            textOfTokens(threshold),
            token
        );

        expect(count).toBe(threshold);
        expect(apiCountTokens).not.toHaveBeenCalled();
    });

    it('asks the API once the estimate exceeds the threshold', async () => {
        const { token } = createToken();
        const text = textOfTokens(threshold + 1);

        const count = await countTokens(anthropic, model, text, token);

        expect(count).toBe(42);
        expect(apiCountTokens).toHaveBeenCalledWith(
            {
                model: model.id,
                messages: [{ role: 'user', content: [{ type: 'text', text }] }],
            },
            { signal: expect.any(AbortSignal) }
        );
    });

    it('asks the API for any message containing an image', async () => {
        const { token } = createToken();
        const msg = message([
            new vscode.LanguageModelTextPart('short'),
            new vscode.LanguageModelDataPart(
                new Uint8Array([1, 2, 3]),
                'image/png'
            ),
        ]);

        expect(await countTokens(anthropic, model, msg, token)).toBe(42);
        expect(apiCountTokens).toHaveBeenCalledTimes(1);
    });

    it('falls back to the estimate when the API call fails', async () => {
        const { token } = createToken();
        apiCountTokens.mockRejectedValue(new Error('network down'));

        const count = await countTokens(
            anthropic,
            model,
            textOfTokens(threshold + 1),
            token
        );

        expect(count).toBe(threshold + 1);
    });

    it('aborts the API call when cancellation is requested', async () => {
        const { token, cancel } = createToken();
        let signal: AbortSignal | undefined;
        apiCountTokens.mockImplementation(
            (
                _params: Anthropic.MessageCountTokensParams,
                options: { signal: AbortSignal }
            ) => {
                signal = options.signal;
                cancel();
                return Promise.reject(new Error('aborted'));
            }
        );

        const count = await countTokens(
            anthropic,
            model,
            textOfTokens(threshold + 1),
            token
        );

        expect(signal?.aborted).toBe(true);
        expect(count).toBe(threshold + 1);
    });

    it('disposes the cancellation listener after the API call', async () => {
        const { token, dispose } = createToken();

        await countTokens(anthropic, model, textOfTokens(threshold + 1), token);

        expect(dispose).toHaveBeenCalledTimes(1);
    });
});
