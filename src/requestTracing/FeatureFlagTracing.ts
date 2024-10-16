// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import {
    CUSTOM_FILTER_KEY,
    TIME_WINDOW_FILTER_KEY,
    TARGETING_FILTER_KEY,
    DELIMITER
} from "./constants";

/**
 * Tracing for tracking feature flag usage.
 */
export class FeatureFlagTracing {
    #timeWindowFilterNames: string[] = ["TimeWindow", "Microsoft.TimeWindow", "TimeWindowFilter", "Microsoft.TimeWindowFilter"];
    #targetingFilterNames: string[] = ["Targeting", "Microsoft.Targeting", "TargetingFilter", "Microsoft.TargetingFilter"];

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
        if (this.#timeWindowFilterNames.some(name => name.toLowerCase() === filterName.toLowerCase())) {
            this.usesTimeWindowFilter = true;
        } else if (this.#targetingFilterNames.some(name => name.toLowerCase() === filterName.toLowerCase())) {
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
            result += CUSTOM_FILTER_KEY
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
