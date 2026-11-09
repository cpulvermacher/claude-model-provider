import type { Anthropic } from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';

import {
    createReasoningParams,
    getReasoningCapabilities,
    type ReasoningCapabilities,
    resolveReasoningSettings,
} from './reasoning';

const supported = { supported: true };
const unsupported = { supported: false };

const allCapabilities: ReasoningCapabilities = {
    adaptiveThinking: true,
    effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
};

describe('getReasoningCapabilities', () => {
    it('reads adaptive thinking and supported effort levels', () => {
        const capabilities = {
            thinking: {
                supported: true,
                types: { adaptive: supported, enabled: unsupported },
            },
            effort: {
                supported: true,
                low: supported,
                medium: supported,
                high: supported,
                xhigh: null,
                max: supported,
            },
        } as unknown as Anthropic.ModelCapabilities;

        expect(getReasoningCapabilities(capabilities)).toEqual({
            adaptiveThinking: true,
            effortLevels: ['low', 'medium', 'high', 'max'],
        });
    });

    it('treats missing capabilities as unsupported', () => {
        expect(getReasoningCapabilities(null)).toEqual({
            adaptiveThinking: false,
            effortLevels: [],
        });
    });

    it('ignores effort levels if effort is unsupported', () => {
        const capabilities = {
            thinking: {
                supported: true,
                types: { adaptive: unsupported, enabled: supported },
            },
            effort: {
                supported: false,
                low: supported,
                medium: supported,
                high: supported,
                xhigh: null,
                max: supported,
            },
        } as unknown as Anthropic.ModelCapabilities;

        expect(getReasoningCapabilities(capabilities)).toEqual({
            adaptiveThinking: false,
            effortLevels: [],
        });
    });
});

describe('resolveReasoningSettings', () => {
    const settings = { thinking: 'default', effort: 'high' } as const;

    it('uses settings without modelOptions', () => {
        expect(resolveReasoningSettings(settings, undefined)).toEqual(settings);
    });

    it('lets valid modelOptions override settings', () => {
        expect(
            resolveReasoningSettings(settings, {
                thinking: 'adaptive',
                effort: 'low',
            })
        ).toEqual({ thinking: 'adaptive', effort: 'low' });
    });

    it('ignores invalid modelOptions', () => {
        expect(
            resolveReasoningSettings(settings, {
                thinking: 'enabled',
                effort: 'extreme',
            })
        ).toEqual(settings);
    });
});

describe('createReasoningParams', () => {
    it('omits everything for default settings', () => {
        expect(
            createReasoningParams(
                allCapabilities,
                { thinking: 'default', effort: 'default' },
                false
            )
        ).toEqual({});
    });

    it('enables adaptive thinking and sets effort', () => {
        expect(
            createReasoningParams(
                allCapabilities,
                { thinking: 'adaptive', effort: 'xhigh' },
                false
            )
        ).toEqual({
            thinking: { type: 'adaptive' },
            output_config: { effort: 'xhigh' },
        });
    });

    it('omits params the model does not support', () => {
        expect(
            createReasoningParams(
                { adaptiveThinking: false, effortLevels: [] },
                { thinking: 'adaptive', effort: 'high' },
                false
            )
        ).toEqual({});
    });

    it('does not enable thinking when tool use is forced', () => {
        expect(
            createReasoningParams(
                allCapabilities,
                { thinking: 'adaptive', effort: 'low' },
                true
            )
        ).toEqual({ output_config: { effort: 'low' } });
    });

    it('falls back to the closest lower supported effort level', () => {
        expect(
            createReasoningParams(
                {
                    adaptiveThinking: true,
                    effortLevels: ['low', 'medium', 'high', 'max'],
                },
                { thinking: 'default', effort: 'xhigh' },
                false
            )
        ).toEqual({ output_config: { effort: 'high' } });
    });

    it('omits effort if no supported level is at or below it', () => {
        expect(
            createReasoningParams(
                { adaptiveThinking: true, effortLevels: ['medium', 'high'] },
                { thinking: 'default', effort: 'low' },
                false
            )
        ).toEqual({});
    });
});
