// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { FeatureFlagRefreshOptions } from "../RefreshOptions.js";
import { SettingSelector } from "../types.js";

/**
 * Options used to configure feature flags.
 */
export interface FeatureFlagOptions {
    /**
     * Specifies whether feature flags will be loaded from Azure App Configuration.
     */
    enabled: boolean;

    /**
     * Specifies what feature flags to include in the configuration provider.
     *
     * @remarks
     * keyFilter of selector will be prefixed with "appconfig.featureflag/" when request is sent.
     * If no selectors are specified then all feature flags with no label will be included.
     */
    selectors?: SettingSelector[];

    /**
     * Specifies how feature flag refresh is configured. All selected feature flags will be watched for changes.
     */
    refresh?: FeatureFlagRefreshOptions;
}
