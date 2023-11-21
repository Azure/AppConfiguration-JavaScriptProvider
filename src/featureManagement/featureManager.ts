

/**
 * Feature Manager that determines if a feature flag is enabled for the given context
 */
export class FeatureManager {
    constructor(featureFlags: any) {}

    isEnable(featureFlag: string, context: any): boolean {
        return true;
    }
}