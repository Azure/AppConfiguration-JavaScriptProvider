// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type {
    FeatureFlag as AzAppConfigFeatureFlag,
    FeatureFlagAllocation as AzAppConfigFeatureFlagAllocation,
    FeatureFlagConditions as AzAppConfigFeatureFlagConditions,
    FeatureFilter as AzAppConfigFeatureFilter,
    FeatureFlagTelemetryConfiguration as AzAppConfigFeatureFlagTelemetryConfiguration,
    FeatureFlagVariantDefinition as AzAppConfigFeatureFlagVariantDefinition,
    GroupAllocation as AzAppConfigGroupAllocation,
    PercentileAllocation as AzAppConfigPercentileAllocation,
    UserAllocation as AzAppConfigUserAllocation
} from "@azure/app-configuration";

export interface FeatureFilter {
    name: AzAppConfigFeatureFilter["name"];
    parameters?: Record<string, unknown>;
}

export interface FeatureFlagConditions {
    client_filters: FeatureFilter[];
    requirement_type?: AzAppConfigFeatureFlagConditions["requirementType"];
}

export interface FeatureFlagVariant {
    name: AzAppConfigFeatureFlagVariantDefinition["name"];
    configuration_value?: unknown;
    status_override?: AzAppConfigFeatureFlagVariantDefinition["statusOverride"];
}

export interface FeatureFlagAllocation {
    default_when_disabled?: AzAppConfigFeatureFlagAllocation["defaultWhenDisabled"];
    default_when_enabled?: AzAppConfigFeatureFlagAllocation["defaultWhenEnabled"];
    percentile?: AzAppConfigPercentileAllocation[];
    user?: AzAppConfigUserAllocation[];
    group?: AzAppConfigGroupAllocation[];
    seed?: AzAppConfigFeatureFlagAllocation["seed"];
}

export interface FeatureFlagTelemetry {
    enabled: AzAppConfigFeatureFlagTelemetryConfiguration["enabled"];
    metadata?: AzAppConfigFeatureFlagTelemetryConfiguration["metadata"];
}

export interface FeatureFlag {
    id: AzAppConfigFeatureFlag["name"];
    enabled: AzAppConfigFeatureFlag["enabled"];
    description?: AzAppConfigFeatureFlag["description"];
    conditions: FeatureFlagConditions;
    variants?: FeatureFlagVariant[];
    allocation?: FeatureFlagAllocation;
    telemetry?: FeatureFlagTelemetry;
}
