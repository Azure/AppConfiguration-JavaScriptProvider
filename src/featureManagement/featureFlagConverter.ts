// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { FeatureFlag } from "@azure/app-configuration";

/**
 * Converts @see FeatureFlag returned by the feature flag endpoint into the
 * Microsoft Feature Management schema object (snake_case) used within the `feature_management.feature_flags`
 * array. This mirrors the shape produced by parsing a classic feature flag key-value, so that downstream
 * feature management parsing and the provider's telemetry/tracing logic are unchanged.
 */
export function convertToMicrosoftSchema(featureFlag: FeatureFlag): any {
    const result: any = {
        id: featureFlag.name,
        enabled: featureFlag.enabled
    };

    if (featureFlag.description !== undefined) {
        result.description = featureFlag.description;
    }

    // conditions: filters -> client_filters, requirementType -> requirement_type
    const conditions: any = {
        client_filters: (featureFlag.conditions?.filters ?? []).map(filter => {
            const clientFilter: any = { name: filter.name };
            if (filter.parameters !== undefined) {
                clientFilter.parameters = filter.parameters;
            }
            return clientFilter;
        })
    };
    if (featureFlag.conditions?.requirementType !== undefined) {
        conditions.requirement_type = featureFlag.conditions.requirementType;
    }
    result.conditions = conditions;

    // variants: value -> configuration_value, statusOverride -> status_override
    if (featureFlag.variants !== undefined) {
        result.variants = featureFlag.variants.map(variant => {
            const result_variant: any = { name: variant.name };
            if (variant.value !== undefined) {
                result_variant.configuration_value = variant.value;
            }
            if (variant.statusOverride !== undefined) {
                result_variant.status_override = variant.statusOverride;
            }
            return result_variant;
        });
    }

    // allocation: camelCase -> snake_case
    if (featureFlag.allocation !== undefined) {
        const allocation: any = {};
        const sourceAllocation = featureFlag.allocation;
        if (sourceAllocation.defaultWhenDisabled !== undefined) {
            allocation.default_when_disabled = sourceAllocation.defaultWhenDisabled;
        }
        if (sourceAllocation.defaultWhenEnabled !== undefined) {
            allocation.default_when_enabled = sourceAllocation.defaultWhenEnabled;
        }
        if (sourceAllocation.percentile !== undefined) {
            allocation.percentile = sourceAllocation.percentile.map(p => ({ variant: p.variant, from: p.from, to: p.to }));
        }
        if (sourceAllocation.user !== undefined) {
            allocation.user = sourceAllocation.user.map(u => ({ variant: u.variant, users: u.users }));
        }
        if (sourceAllocation.group !== undefined) {
            allocation.group = sourceAllocation.group.map(g => ({ variant: g.variant, groups: g.groups }));
        }
        if (sourceAllocation.seed !== undefined) {
            allocation.seed = sourceAllocation.seed;
        }
        result.allocation = allocation;
    }

    // telemetry: metadata is (re)populated later by the provider with ETag/FeatureFlagReference/AllocationId
    if (featureFlag.telemetry !== undefined) {
        const telemetry: any = { enabled: featureFlag.telemetry.enabled };
        if (featureFlag.telemetry.metadata !== undefined) {
            telemetry.metadata = featureFlag.telemetry.metadata;
        }
        result.telemetry = telemetry;
    }

    return result;
}
