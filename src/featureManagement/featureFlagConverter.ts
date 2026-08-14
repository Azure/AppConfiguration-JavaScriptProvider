// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { FeatureFlag } from "@azure/app-configuration";

/**
 * Converts @see FeatureFlag into the
 * Microsoft Feature Flag schema object used within the `feature_management.feature_flags`
 * array. This mirrors the shape produced by parsing a classic feature flag key-value, so that downstream
 * feature management parsing and the provider's telemetry/tracing logic are unchanged.
 */
export function convert(featureFlag: FeatureFlag): any {
    const result: any = {
        id: featureFlag.name,
        enabled: featureFlag.enabled
    };

    if (featureFlag.description != null) {
        result.description = featureFlag.description;
    }

    // conditions: filters -> client_filters, requirementType -> requirement_type
    const conditions: any = {
        client_filters: (featureFlag.conditions?.filters ?? []).map(filter => {
            const clientFilter: any = { name: filter.name };
            if (filter.parameters != null) {
                clientFilter.parameters = Object.fromEntries(
                    Object.entries(filter.parameters).map(([name, value]) => [name, JSON.parse(value)]));
            }
            return clientFilter;
        })
    };
    if (featureFlag.conditions?.requirementType != null) {
        conditions.requirement_type = featureFlag.conditions.requirementType;
    }
    result.conditions = conditions;

    // variants: value -> configuration_value, statusOverride -> status_override
    if (featureFlag.variants != null) {
        result.variants = featureFlag.variants.map(variant => {
            const result_variant: any = { name: variant.name };
            if (variant.value !== undefined) {
                result_variant.configuration_value = variant.value;
            }
            if (variant.statusOverride != null) {
                result_variant.status_override = variant.statusOverride;
            }
            return result_variant;
        });
    }

    // allocation: camelCase -> snake_case
    if (featureFlag.allocation != null) {
        const allocation: any = {};
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
        const telemetry: any = { enabled: featureFlag.telemetry.enabled };
        if (featureFlag.telemetry.metadata != null) {
            telemetry.metadata = featureFlag.telemetry.metadata;
        }
        result.telemetry = telemetry;
    }

    return result;
}
