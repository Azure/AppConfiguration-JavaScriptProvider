// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { FeatureFlag as AzAppConfigFeatureFlag } from "@azure/app-configuration";
import type {
    FeatureFilter,
    FeatureFlag,
    FeatureFlagAllocation,
    FeatureFlagTelemetry,
    FeatureFlagVariant
} from "./featureFlags.js";
import { isJsonContentType, parseContentType } from "../common/contentType.js";

/**
 * Converts @see FeatureFlag into the
 * Microsoft Feature Flag schema object used within the `feature_management.feature_flags`
 * array. This mirrors the shape produced by parsing a classic feature flag key-value, so that downstream
 * feature management parsing and the provider's telemetry/tracing logic are unchanged.
 */
export function convert(featureFlag: AzAppConfigFeatureFlag): FeatureFlag {
    const result: FeatureFlag = {
        id: featureFlag.name,
        enabled: featureFlag.enabled,
        conditions: {
            client_filters: (featureFlag.conditions?.filters ?? []).map(filter => {
                const clientFilter: FeatureFilter = { name: filter.name };
                if (filter.parameters != null) {
                    clientFilter.parameters = Object.fromEntries(
                        Object.entries(filter.parameters).map(([name, value]) => [name, parseJsonValue(value, featureFlag.name)]));
                }
                return clientFilter;
            })
        }
    };

    if (featureFlag.description != null) {
        result.description = featureFlag.description;
    }

    if (featureFlag.conditions?.requirementType != null) {
        result.conditions.requirement_type = featureFlag.conditions.requirementType;
    }

    // variants: value -> configuration_value, statusOverride -> status_override
    if (featureFlag.variants != null) {
        result.variants = featureFlag.variants.map(variant => {
            const resultVariant: FeatureFlagVariant = { name: variant.name };
            if (variant.value !== undefined) {
                resultVariant.configuration_value = isJsonContentType(parseContentType(variant.contentType))
                    ? parseJsonValue(variant.value, featureFlag.name)
                    : variant.value;
            }
            if (variant.statusOverride != null) {
                resultVariant.status_override = variant.statusOverride;
            }
            return resultVariant;
        });
    }

    // allocation: camelCase -> snake_case
    if (featureFlag.allocation != null) {
        const allocation: FeatureFlagAllocation = {};
        const sourceAllocation = featureFlag.allocation;
        if (sourceAllocation.defaultWhenDisabled != null) {
            allocation.default_when_disabled = sourceAllocation.defaultWhenDisabled;
        }
        if (sourceAllocation.defaultWhenEnabled != null) {
            allocation.default_when_enabled = sourceAllocation.defaultWhenEnabled;
        }
        if (sourceAllocation.percentile != null) {
            allocation.percentile = sourceAllocation.percentile.map(p => ({ variant: p.variant, from: p.from, to: p.to }));
        }
        if (sourceAllocation.user != null) {
            allocation.user = sourceAllocation.user.map(u => ({ variant: u.variant, users: u.users }));
        }
        if (sourceAllocation.group != null) {
            allocation.group = sourceAllocation.group.map(g => ({ variant: g.variant, groups: g.groups }));
        }
        if (sourceAllocation.seed != null) {
            allocation.seed = sourceAllocation.seed;
        }
        result.allocation = allocation;
    }

    // telemetry: metadata is (re)populated later by the provider with ETag/FeatureFlagReference/AllocationId
    if (featureFlag.telemetry != null) {
        const telemetry: FeatureFlagTelemetry = { enabled: featureFlag.telemetry.enabled };
        if (featureFlag.telemetry.metadata != null) {
            telemetry.metadata = featureFlag.telemetry.metadata;
        }
        result.telemetry = telemetry;
    }

    return result;
}

function parseJsonValue(value: string, featureFlagName: string): unknown {
    try {
        return JSON.parse(value) as unknown;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new SyntaxError(`Enhanced feature flag '${featureFlagName}': ${errorMessage}`, { cause: error });
    }
}
