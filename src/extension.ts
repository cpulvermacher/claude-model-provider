import * as vscode from 'vscode';

import { ChatModelProvider, initAnthropicClient } from './provider';

export async function activate(context: vscode.ExtensionContext) {
    await initAnthropicClient(context);

    context.subscriptions.push(
        vscode.lm.registerLanguageModelChatProvider(
            'claude-model-provider',
            new ChatModelProvider()
        )
    );
}

export function deactivate() {}
