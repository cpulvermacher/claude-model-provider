import { Anthropic } from '@anthropic-ai/sdk';
import * as vscode from 'vscode';

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
