// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { TIME_WINDOW_FILTER_NAMES, TARGETING_FILTER_NAMES } from "../featureManagement/constants";
import { CUSTOM_FILTER_KEY, TIME_WINDOW_FILTER_KEY, TARGETING_FILTER_KEY, DELIMITER } from "./constants";

/**
 * Tracing for tracking feature flag usage.
 */
export class FeatureFlagTracingOptions {
    /**
     * Built-in feature filter usage.
     */
    usesCustomFilter: boolean = false;
    usesTimeWindowFilter: boolean = false;
    usesTargetingFilter: boolean = false;

    resetFeatureFlagTracing(): void {
        this.usesCustomFilter = false;
        this.usesTimeWindowFilter = false;
        this.usesTargetingFilter = false;
    }

    updateFeatureFilterTracing(filterName: string): void {
        if (TIME_WINDOW_FILTER_NAMES.some(name => name === filterName)) {
            this.usesTimeWindowFilter = true;
        } else if (TARGETING_FILTER_NAMES.some(name => name === filterName)) {
            this.usesTargetingFilter = true;
        } else {
            this.usesCustomFilter = true;
        }
    }

    usesAnyFeatureFilter(): boolean {
        return this.usesCustomFilter || this.usesTimeWindowFilter || this.usesTargetingFilter;
    }

    createFeatureFiltersString(): string {
        if (!this.usesAnyFeatureFilter()) {
            return "";
        }

        let result: string = "";

        if (this.usesCustomFilter) {
            result += CUSTOM_FILTER_KEY;
        }

        if (this.usesTimeWindowFilter) {
            if (result !== "") {
                result += DELIMITER;
            }
            result += TIME_WINDOW_FILTER_KEY;
        }

        if (this.usesTargetingFilter) {
            if (result !== "") {
                result += DELIMITER;
            }
            result += TARGETING_FILTER_KEY;
        }

        return result;
    }
}
