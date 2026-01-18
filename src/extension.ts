import * as vscode from 'vscode';

import { initializeProvider } from './provider';

export async function activate(context: vscode.ExtensionContext) {
    const provider = await initializeProvider(context);

    context.subscriptions.push(
        vscode.lm.registerLanguageModelChatProvider(
            'claude-model-provider',
            provider
        )
    );
}

export function deactivate() {}
