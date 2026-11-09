import type { Anthropic } from '@anthropic-ai/sdk';

export type Effort = NonNullable<Anthropic.OutputConfig['effort']>;
export type ThinkingMode = 'default' | 'adaptive';

/** effort levels from lowest to highest */
const effortLevels: readonly Effort[] = [
    'low',
    'medium',
    'high',
    'xhigh',
    'max',
];

export interface ReasoningCapabilities {
    adaptiveThinking: boolean;
    /** supported effort levels, from lowest to highest; empty if unsupported */
    effortLevels: Effort[];
}

export interface ReasoningSettings {
    thinking: ThinkingMode;
    effort: Effort | 'default';
}

type ReasoningParams = Pick<
    Anthropic.MessageCreateParamsStreaming,
    'thinking' | 'output_config'
>;

export function getReasoningCapabilities(
    capabilities: Anthropic.ModelCapabilities | null | undefined
): ReasoningCapabilities {
    const effort = capabilities?.effort;
    return {
        adaptiveThinking:
            capabilities?.thinking?.types?.adaptive?.supported ?? false,
        effortLevels: effort?.supported
            ? effortLevels.filter((level) => effort[level]?.supported)
            : [],
    };
}

/**
 * Settings can be overridden per request via `modelOptions`, so that other
 * extensions can pick e.g. a lower effort for simple tasks.
 * Invalid values are ignored.
 */
export function resolveReasoningSettings(
    settings: ReasoningSettings,
    modelOptions: { readonly [name: string]: unknown } | undefined
): ReasoningSettings {
    const { thinking, effort } = modelOptions ?? {};
    return {
        thinking: isThinkingMode(thinking) ? thinking : settings.thinking,
        effort: isEffort(effort) ? effort : settings.effort,
    };
}

/** Builds the `thinking` and `output_config` request params, omitting any the model doesn't support. */
export function createReasoningParams(
    capabilities: ReasoningCapabilities,
    settings: ReasoningSettings,
    forcedToolUse: boolean
): ReasoningParams {
    const params: ReasoningParams = {};

    // Forcing tool use is not compatible with explicitly enabled thinking.
    if (
        settings.thinking === 'adaptive' &&
        capabilities.adaptiveThinking &&
        !forcedToolUse
    ) {
        params.thinking = { type: 'adaptive' };
    }

    if (settings.effort !== 'default') {
        const effort = clampEffort(settings.effort, capabilities.effortLevels);
        if (effort) {
            params.output_config = { effort };
        }
    }

    return params;
}

/** highest supported level not above `requested`; undefined if there is none */
function clampEffort(
    requested: Effort,
    supported: Effort[]
): Effort | undefined {
    const maxIndex = effortLevels.indexOf(requested);
    return supported
        .filter((level) => effortLevels.indexOf(level) <= maxIndex)
        .at(-1);
}

function isThinkingMode(value: unknown): value is ThinkingMode {
    return value === 'default' || value === 'adaptive';
}

function isEffort(value: unknown): value is Effort | 'default' {
    return value === 'default' || effortLevels.includes(value as Effort);
}
