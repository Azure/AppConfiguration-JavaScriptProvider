// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as chai from "chai";
import * as chaiAsPromised from "chai-as-promised";
import { load } from "./exportedApi.js";
import { createMockedConnectionString, createMockedEndpoint, createMockedFeatureFlag, createMockedKeyValue, mockAppConfigurationClientListConfigurationSettings, restoreMocks } from "./utils/testHelper.js";
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
    createMockedFeatureFlag("Telemetry_1", { enabled: true, telemetry: { enabled: true } }, { etag: "ETag"}),
    createMockedFeatureFlag("Telemetry_2", { enabled: true, telemetry: { enabled: true } }, { etag: "ETag", label: "Test"}),
    createMockedFeatureFlag("NoPercentileAndSeed", {
        enabled: true,
        telemetry: { enabled: true },
        variants: [ { name: "Control" }, { name: "Test" } ],
        allocation: {
            default_when_disabled: "Control",
            user: [ {users: ["Jeff"], variant: "Test"} ]
        }
    }),
    createMockedFeatureFlag("SeedOnly", {
        enabled: true,
        telemetry: { enabled: true },
        variants: [ { name: "Control" }, { name: "Test" } ],
        allocation: {
            default_when_disabled: "Control",
            user: [ {users: ["Jeff"], variant: "Test"} ],
            seed: "123"
        }
    }),
    createMockedFeatureFlag("DefaultWhenEnabledOnly", {
        enabled: true,
        telemetry: { enabled: true },
        variants: [ { name: "Control" }, { name: "Test" } ],
        allocation: {
            default_when_enabled: "Control"
        }
    }),
    createMockedFeatureFlag("PercentileOnly", {
        enabled: true,
        telemetry: { enabled: true },
        variants: [ ],
        allocation: {
            percentile: [ { from: 0, to: 50, variant: "Control" }, { from: 50, to: 100, variant: "Test" } ]
        }
    }),
    createMockedFeatureFlag("SimpleConfigurationValue", {
        enabled: true,
        telemetry: { enabled: true },
        variants: [ { name: "Control", configuration_value: "standard" }, { name: "Test", configuration_value: "special" } ],
        allocation: {
            default_when_enabled: "Control",
            percentile: [ { from: 0, to: 50, variant: "Control" }, { from: 50, to: 100, variant: "Test" } ],
            seed: "123"
        }
    }),
    createMockedFeatureFlag("ComplexConfigurationValue", {
        enabled: true,
        telemetry: { enabled: true },
        variants: [ { name: "Control", configuration_value: { title: { size: 100, color: "red" }, options: [ 1, 2, 3 ]} }, { name: "Test", configuration_value: { title: { size: 200, color: "blue" }, options: [ "1", "2", "3" ]} } ],
        allocation: {
            default_when_enabled: "Control",
            percentile: [ { from: 0, to: 50, variant: "Control" }, { from: 50, to: 100, variant: "Test" } ],
            seed: "123"
        }
    }),
    createMockedFeatureFlag("TelemetryVariantPercentile", {
        enabled: true,
        telemetry: { enabled: true },
        variants: [
            {
                name: "True_Override",
                configuration_value: {
                    someOtherKey: {
                        someSubKey: "someSubValue"
                    },
                    someKey4: [3, 1, 4, true],
                    someKey: "someValue",
                    someKey3: 3.14,
                    someKey2: 3
                }
            }
        ],
        allocation: {
            default_when_enabled: "True_Override",
            percentile: [
                {
                    variant: "True_Override",
                    from: 0,
                    to: 100
                }
            ]
        }
    }),
    createMockedFeatureFlag("Complete", {
        enabled: true,
        telemetry: { enabled: true },
        variants: [
            {
                name: "Large",
                configuration_value: 100
            },
            {
                name: "Medium",
                configuration_value: 50
            },
            {
                name: "Small",
                configuration_value: 10
            }
        ],
        allocation: {
            percentile: [
                {
                    variant: "Large",
                    from: 0,
                    to: 25
                },
                {
                    variant: "Medium",
                    from: 25,
                    to: 55
                },
                {
                    variant: "Small",
                    from: 55,
                    to: 95
                },
                {
                    variant: "Large",
                    from: 95,
                    to: 100
                }
            ],
            group: [
                {
                    variant: "Large",
                    groups: ["beta"]
                }
            ],
            user: [
                {
                    variant: "Small",
                    users: ["Richel"]
                }
            ],
            seed: "test-seed",
            default_when_enabled: "Medium",
            default_when_disabled: "Medium"
        }
    })
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

    it("should populate telemetry metadata", async () => {
        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString, {
            featureFlagOptions: {
                enabled: true,
                selectors: [
                    {
                        keyFilter: "Telemetry_1"
                    },
                    {
                        keyFilter: "Telemetry_2",
                        labelFilter: "Test"
                    }
                ]
            }
        });
        expect(settings).not.undefined;
        expect(settings.get("feature_management")).not.undefined;
        const featureFlags = settings.get<any>("feature_management").feature_flags;
        expect(featureFlags).not.undefined;
        expect((featureFlags as []).length).equals(2);

        let featureFlag = featureFlags[0];
        expect(featureFlag).not.undefined;
        expect(featureFlag.id).equals("Telemetry_1");
        expect(featureFlag.telemetry).not.undefined;
        expect(featureFlag.telemetry.enabled).equals(true);
        expect(featureFlag.telemetry.metadata.ETag).equals("ETag");
        expect(featureFlag.telemetry.metadata.FeatureFlagId).equals("krkOsu9dVV9huwbQDPR6gkV_2T0buWxOCS-nNsj5-6g");
        expect(featureFlag.telemetry.metadata.FeatureFlagReference).equals(`${createMockedEndpoint()}/kv/.appconfig.featureflag/Telemetry_1`);

        featureFlag = featureFlags[1];
        expect(featureFlag).not.undefined;
        expect(featureFlag.id).equals("Telemetry_2");
        expect(featureFlag.telemetry).not.undefined;
        expect(featureFlag.telemetry.enabled).equals(true);
        expect(featureFlag.telemetry.metadata.ETag).equals("ETag");
        expect(featureFlag.telemetry.metadata.FeatureFlagId).equals("Rc8Am7HIGDT7HC5Ovs3wKN_aGaaK_Uz1mH2e11gaK0o");
        expect(featureFlag.telemetry.metadata.FeatureFlagReference).equals(`${createMockedEndpoint()}/kv/.appconfig.featureflag/Telemetry_2?label=Test`);
    });

    it("should not populate allocation id", async () => {
        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString, {
            featureFlagOptions: {
                enabled: true,
                selectors: [ { keyFilter: "*" } ]
            }
        });
        expect(settings).not.undefined;
        expect(settings.get("feature_management")).not.undefined;
        const featureFlags = settings.get<any>("feature_management").feature_flags;
        expect(featureFlags).not.undefined;

        const NoPercentileAndSeed = (featureFlags as any[]).find(item => item.id === "NoPercentileAndSeed");
        expect(NoPercentileAndSeed).not.undefined;
        expect(NoPercentileAndSeed?.telemetry.metadata.AllocationId).to.be.undefined;
    });

    it("should populate allocation id", async () => {
        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString, {
            featureFlagOptions: {
                enabled: true,
                selectors: [ { keyFilter: "*" } ]
            }
        });
        expect(settings).not.undefined;
        expect(settings.get("feature_management")).not.undefined;
        const featureFlags = settings.get<any>("feature_management").feature_flags;
        expect(featureFlags).not.undefined;

        const SeedOnly = (featureFlags as any[]).find(item => item.id === "SeedOnly");
        expect(SeedOnly).not.undefined;
        expect(SeedOnly?.telemetry.metadata.AllocationId).equals("qZApcKdfXscxpgn_8CMf");

        const DefaultWhenEnabledOnly = (featureFlags as any[]).find(item => item.id === "DefaultWhenEnabledOnly");
        expect(DefaultWhenEnabledOnly).not.undefined;
        expect(DefaultWhenEnabledOnly?.telemetry.metadata.AllocationId).equals("k486zJjud_HkKaL1C4qB");

        const PercentileOnly = (featureFlags as any[]).find(item => item.id === "PercentileOnly");
        expect(PercentileOnly).not.undefined;
        expect(PercentileOnly?.telemetry.metadata.AllocationId).equals("5YUbmP0P5s47zagO_LvI");

        const SimpleConfigurationValue = (featureFlags as any[]).find(item => item.id === "SimpleConfigurationValue");
        expect(SimpleConfigurationValue).not.undefined;
        expect(SimpleConfigurationValue?.telemetry.metadata.AllocationId).equals("QIOEOTQJr2AXo4dkFFqy");

        const ComplexConfigurationValue = (featureFlags as any[]).find(item => item.id === "ComplexConfigurationValue");
        expect(ComplexConfigurationValue).not.undefined;
        expect(ComplexConfigurationValue?.telemetry.metadata.AllocationId).equals("4Bes0AlwuO8kYX-YkBWs");

        const TelemetryVariantPercentile = (featureFlags as any[]).find(item => item.id === "TelemetryVariantPercentile");
        expect(TelemetryVariantPercentile).not.undefined;
        expect(TelemetryVariantPercentile?.telemetry.metadata.AllocationId).equals("YsdJ4pQpmhYa8KEhRLUn");

        const Complete = (featureFlags as any[]).find(item => item.id === "Complete");
        expect(Complete).not.undefined;
        expect(Complete?.telemetry.metadata.AllocationId).equals("DER2rF-ZYog95c4CBZoi");
    });
});
