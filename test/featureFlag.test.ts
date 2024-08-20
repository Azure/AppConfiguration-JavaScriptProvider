// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as chai from "chai";
import * as chaiAsPromised from "chai-as-promised";
import { load } from "./exportedApi";
import { createMockedConnectionString, createMockedFeatureFlag, createMockedKeyValue, mockAppConfigurationClientListConfigurationSettings, restoreMocks } from "./utils/testHelper";
chai.use(chaiAsPromised);
const expect = chai.expect;

const sampleVariantValue = JSON.stringify({
    "id": "variant",
    "description": "",
    "enabled": true,
    "variants": [
        {
            "name": "Off",
            "configuration_value": false
        },
        {
            "name": "On",
            "configuration_value": true
        }
    ],
    "allocation": {
        "percentile": [
            {
                "variant": "Off",
                "from": 0,
                "to": 40
            },
            {
                "variant": "On",
                "from": 49,
                "to": 100
            }
        ],
        "default_when_enabled": "Off",
        "default_when_disabled": "Off"
    },
    "telemetry": {
        "enabled": false
    }
});

const mockedKVs = [{
    key: "app.settings.fontColor",
    value: "red",
}, {
    key: ".appconfig.featureflag/variant",
    value: sampleVariantValue,
    contentType: "application/vnd.microsoft.appconfig.ff+json;charset=utf-8",
}].map(createMockedKeyValue).concat([
    createMockedFeatureFlag("Beta", { enabled: true }),
    createMockedFeatureFlag("Alpha_1", { enabled: true }),
    createMockedFeatureFlag("Alpha_2", { enabled: false }),
]);

describe("feature flags", function () {
    this.timeout(10000);

    before(() => {
        mockAppConfigurationClientListConfigurationSettings(mockedKVs);
    });

    after(() => {
        restoreMocks();
    });
    
    it("should load feature flags if enabled", async () => {
        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString, {
            featureFlagOptions: {
                enabled: true,
                selectors: [{
                    keyFilter: "*"
                }]
            }
        });
        expect(settings).not.undefined;
        expect(settings.get("feature_management")).not.undefined;
        expect(settings.get<any>("feature_management").feature_flags).not.undefined;
    });

    it("should not load feature flags if disabled", async () => {
        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString, {
            featureFlagOptions: {
                enabled: false
            }
        });
        expect(settings).not.undefined;
        expect(settings.get("feature_management")).undefined;
    });

    it("should not load feature flags if featureFlagOptions not specified", async () => {
        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString);
        expect(settings).not.undefined;
        expect(settings.get("feature_management")).undefined;
    });

    it("should throw error if selectors not specified", async () => {
        const connectionString = createMockedConnectionString();
        return expect(load(connectionString, {
            featureFlagOptions: {
                enabled: true
            }
        })).eventually.rejectedWith("Feature flag selectors must be provided.");
    });

    it("should load feature flags with custom selector", async () => {
        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString, {
            featureFlagOptions: {
                enabled: true,
                selectors: [{
                    keyFilter: "Alpha*"
                }]
            }
        });
        expect(settings).not.undefined;
        expect(settings.get("feature_management")).not.undefined;
        const featureFlags = settings.get<any>("feature_management").feature_flags;
        expect(featureFlags).not.undefined;
        expect((featureFlags as []).length).equals(2);
    });

    it("should parse variant", async () => {
        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString, {
            featureFlagOptions: {
                enabled: true,
                selectors: [{
                    keyFilter: "variant"
                }]
            }
        });
        expect(settings).not.undefined;
        expect(settings.get("feature_management")).not.undefined;
        const featureFlags = settings.get<any>("feature_management").feature_flags;
        expect(featureFlags).not.undefined;
        expect((featureFlags as []).length).equals(1);
        const variant = featureFlags[0];
        expect(variant).not.undefined;
        expect(variant.id).equals("variant");
        expect(variant.variants).not.undefined;
        expect(variant.variants.length).equals(2);
        expect(variant.variants[0].configuration_value).equals(false);
        expect(variant.variants[1].configuration_value).equals(true);
        expect(variant.allocation).not.undefined;
        expect(variant.allocation.percentile).not.undefined;
        expect(variant.allocation.percentile.length).equals(2);
        expect(variant.allocation.percentile[0].variant).equals("Off");
        expect(variant.allocation.percentile[1].variant).equals("On");
        expect(variant.allocation.default_when_enabled).equals("Off");
        expect(variant.allocation.default_when_disabled).equals("Off");
        expect(variant.telemetry).not.undefined;
    });

});
