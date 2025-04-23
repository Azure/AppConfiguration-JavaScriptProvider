// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { TIME_WINDOW_FILTER_NAMES, TARGETING_FILTER_NAMES } from "../featureManagement/constants.js";
import { CUSTOM_FILTER_KEY, TIME_WINDOW_FILTER_KEY, TARGETING_FILTER_KEY, FF_SEED_USED_TAG, FF_TELEMETRY_USED_TAG, DELIMITER } from "./constants.js";

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
    usesTelemetry: boolean = false;
    usesSeed: boolean = false;
    maxVariants: number = 0;

    reset(): void {
        this.usesCustomFilter = false;
        this.usesTimeWindowFilter = false;
        this.usesTargetingFilter = false;
        this.usesTelemetry = false;
        this.usesSeed = false;
        this.maxVariants = 0;
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

    notifyMaxVariants(currentFFTotalVariants: number): void {
        if (currentFFTotalVariants > this.maxVariants) {
            this.maxVariants = currentFFTotalVariants;
        }
    }

    usesAnyFeatureFilter(): boolean {
        return this.usesCustomFilter || this.usesTimeWindowFilter || this.usesTargetingFilter;
    }

    usesAnyTracingFeature() {
        return this.usesSeed || this.usesTelemetry;
    }

    createFeatureFiltersString(): string {
        const tags: string[] = [];
        if (this.usesCustomFilter) {
            tags.push(CUSTOM_FILTER_KEY);
        }
        if (this.usesTimeWindowFilter) {
            tags.push(TIME_WINDOW_FILTER_KEY);
        }
        if (this.usesTargetingFilter) {
            tags.push(TARGETING_FILTER_KEY);
        }
        return tags.join(DELIMITER);
    }

    createFeaturesString(): string {
        const tags: string[] = [];
        if (this.usesSeed) {
            tags.push(FF_SEED_USED_TAG);
        }
        if (this.usesTelemetry) {
            tags.push(FF_TELEMETRY_USED_TAG);
        }
        return tags.join(DELIMITER);
    }
}
