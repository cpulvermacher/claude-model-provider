import * as vscode from 'vscode';
import { Anthropic } from '@anthropic-ai/sdk';

// See https://docs.anthropic.com/en/docs/about-claude/models
const claudeModel = {
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 64000,
};
const modelInformation: vscode.LanguageModelChatInformation = {
    id: claudeModel.model,
    name: 'Claude',
    family: 'claude',
    version: '4.5',
    maxInputTokens: 200000,
    maxOutputTokens: claudeModel.max_tokens,
    capabilities: {},
};

let anthropic: Anthropic | undefined;

async function initAnthropicClient(context: vscode.ExtensionContext) {
    if (!anthropic) {
        let apiKey = await context.secrets.get('claude.apiKey');
        if (!apiKey) {
            apiKey = await vscode.window.showInputBox({
                prompt: 'Enter your Anthropic API Key',
                ignoreFocusOut: true,
            });

            if (!apiKey) {
                throw new Error('API Key is required');
            }

            await context.secrets.store('claude.apiKey', apiKey);
        }
        anthropic = new Anthropic({
            apiKey,
        });
    }
}

export async function activate(context: vscode.ExtensionContext) {
    await initAnthropicClient(context);

    context.subscriptions.push(
        vscode.lm.registerLanguageModelChatProvider(
            'cpulvermacher',
            new ChatModelProvider()
        )
    );
}

export function deactivate() {}

export class ChatModelProvider implements vscode.LanguageModelChatProvider {
    constructor() {}

    async provideLanguageModelChatInformation(
        _options: vscode.PrepareLanguageModelChatModelOptions,
        _token: vscode.CancellationToken
    ) {
        return [modelInformation];
    }

    async provideLanguageModelChatResponse(
        _model: vscode.LanguageModelChatInformation,
        messages: readonly vscode.LanguageModelChatRequestMessage[],
        _options: vscode.ProvideLanguageModelChatResponseOptions,
        progress: vscode.Progress<vscode.LanguageModelResponsePart>,
        _token: vscode.CancellationToken
    ): Promise<void> {
        await new Promise((resolve, reject) => {
            if (!anthropic) {
                reject(new Error('Anthropic client is not initialized.'));
                return;
            }

            const concatenatedContent = messagesToPrompt(messages);
            if (concatenatedContent.length === 0) {
                resolve('');
                return;
            }
            anthropic.messages
                .stream(createModelParamsStreaming(concatenatedContent))
                .on('text', (text) => {
                    progress.report(new vscode.LanguageModelTextPart(text));
                })
                .on('error', (err) => {
                    reject(err);
                })
                .on('finalMessage', () => {
                    resolve('');
                });
        });
    }
    async provideTokenCount(
        model: vscode.LanguageModelChatInformation,
        text: string | vscode.LanguageModelChatRequestMessage,
        _token: vscode.CancellationToken
    ): Promise<number> {
        if (!anthropic) {
            throw new Error('Anthropic client is not initialized.');
        }

        const prompt = messageToPrompt(text);

        if (prompt.length === 0) {
            return 0;
        }

        const response = await anthropic.messages.countTokens({
            messages: createMessages(prompt),
            model: model.id,
        });
        if (!response) {
            throw new Error('Failed to count tokens.');
        }

        return response.input_tokens;
    }
}

function createModelParamsStreaming(
    userPrompt: string
): Anthropic.MessageCreateParamsStreaming {
    return {
        messages: createMessages(userPrompt),
        stream: true,
        ...claudeModel,
    };
}

function createMessages(userPrompt: string): Anthropic.MessageParam[] {
    return [{ role: 'user', content: userPrompt }];
}

function messagesToPrompt(
    messages: readonly vscode.LanguageModelChatRequestMessage[]
): string {
    return messages.map((msg) => messageToPrompt(msg)).join(' ');
}

function messageToPrompt(
    message: string | vscode.LanguageModelChatRequestMessage
): string {
    if (typeof message === 'string') {
        return message;
    }

    return message.content
        .map((msg) => {
            if (msg instanceof vscode.LanguageModelTextPart) {
                return msg.value;
            } else {
                // for tool result/call parts, estimate the token count
                return JSON.stringify(msg);
            }
        })
        .join(' ');
}
