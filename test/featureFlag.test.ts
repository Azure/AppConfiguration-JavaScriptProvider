// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/* eslint-disable @typescript-eslint/no-unused-expressions */
import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
import { featureFlagContentType } from "@azure/app-configuration";
import { load } from "../src/index.js";
import { mockAppConfigurationClientGetSnapshot, mockAppConfigurationClientListConfigurationSettingsForSnapshot, createMockedConnectionString, createMockedEndpoint, createMockedFeatureFlag, createMockedKeyValue, mockAppConfigurationClientListConfigurationSettings, restoreMocks } from "./utils/testHelper.js";
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
    contentType: featureFlagContentType,
}].map(createMockedKeyValue).concat([
    createMockedFeatureFlag("FlagWithTestLabel", { enabled: true }, {label: "Test"}),
    createMockedFeatureFlag("Alpha_1", { enabled: true }),
    createMockedFeatureFlag("Alpha_2", { enabled: false }),
    createMockedFeatureFlag("DevFeatureFlag", { enabled: true }, { tags: { "environment": "dev" } }),
    createMockedFeatureFlag("ProdFeatureFlag", { enabled: false }, { tags: { "environment": "prod" } }),
    createMockedFeatureFlag("TaggedFeature", { enabled: true }, { tags: { "team": "backend", "priority": "high" } }),
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
    

    before(() => {
        mockAppConfigurationClientListConfigurationSettings([mockedKVs]);
    });

    after(() => {
        restoreMocks();
    });

    it("should load feature flags if enabled", async () => {
        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString, {
            featureFlagOptions: {
                enabled: true
            }
        });
        expect(settings).not.undefined;
        expect(settings.get("feature_management")).not.undefined;
        expect(settings.get<any>("feature_management").feature_flags).not.undefined;
        // it should only load feature flags with no label by default
        expect((settings.get<any>("feature_management").feature_flags as any[]).find(ff => ff.id === "FlagWithTestLabel")).to.be.undefined;

        const settings2 = await load(connectionString, {
            featureFlagOptions: {
                enabled: true,
                selectors: [ { keyFilter: "*", labelFilter: "Test" } ]
            }
        });
        expect((settings2.get<any>("feature_management").feature_flags as any[]).find(ff => ff.id === "FlagWithTestLabel")).not.undefined;
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
        expect(featureFlag.telemetry.metadata.FeatureFlagReference).equals(`${createMockedEndpoint()}/kv/.appconfig.featureflag/Telemetry_1`);

        featureFlag = featureFlags[1];
        expect(featureFlag).not.undefined;
        expect(featureFlag.id).equals("Telemetry_2");
        expect(featureFlag.telemetry).not.undefined;
        expect(featureFlag.telemetry.enabled).equals(true);
        expect(featureFlag.telemetry.metadata.ETag).equals("ETag");
        expect(featureFlag.telemetry.metadata.FeatureFlagReference).equals(`${createMockedEndpoint()}/kv/.appconfig.featureflag/Telemetry_2?label=Test`);
    });

    it("should load feature flags using tag filters", async () => {
        const connectionString = createMockedConnectionString();

        // Test filtering by environment=dev tag
        const settingsWithDevTag = await load(connectionString, {
            featureFlagOptions: {
                enabled: true,
                selectors: [{
                    keyFilter: "*",
                    tagFilters: ["environment=dev"]
                }]
            }
        });

        expect(settingsWithDevTag).not.undefined;
        expect(settingsWithDevTag.get("feature_management")).not.undefined;
        let featureFlags = settingsWithDevTag.get<any>("feature_management").feature_flags;
        expect(featureFlags).not.undefined;
        expect((featureFlags as []).length).equals(1);
        expect(featureFlags[0].id).equals("DevFeatureFlag");
        expect(featureFlags[0].enabled).equals(true);

        // Test filtering by environment=prod tag
        const settingsWithProdTag = await load(connectionString, {
            featureFlagOptions: {
                enabled: true,
                selectors: [{
                    keyFilter: "*",
                    tagFilters: ["environment=prod"]
                }]
            }
        });

        featureFlags = settingsWithProdTag.get<any>("feature_management").feature_flags;
        expect(featureFlags).not.undefined;
        expect((featureFlags as []).length).equals(1);
        expect(featureFlags[0].id).equals("ProdFeatureFlag");
        expect(featureFlags[0].enabled).equals(false);

        // Test filtering by multiple tags (team=backend AND priority=high)
        const settingsWithMultipleTags = await load(connectionString, {
            featureFlagOptions: {
                enabled: true,
                selectors: [{
                    keyFilter: "*",
                    tagFilters: ["team=backend", "priority=high"]
                }]
            }
        });

        featureFlags = settingsWithMultipleTags.get<any>("feature_management").feature_flags;
        expect(featureFlags).not.undefined;
        expect((featureFlags as []).length).equals(1);
        expect(featureFlags[0].id).equals("TaggedFeature");
        expect(featureFlags[0].enabled).equals(true);

        // Test filtering by non-existent tag
        const settingsWithNonExistentTag = await load(connectionString, {
            featureFlagOptions: {
                enabled: true,
                selectors: [{
                    keyFilter: "*",
                    tagFilters: ["nonexistent=tag"]
                }]
            }
        });

        featureFlags = settingsWithNonExistentTag.get<any>("feature_management").feature_flags;
        expect(featureFlags).not.undefined;
        expect((featureFlags as []).length).equals(0);
    });

    it("should load feature flags from snapshot", async () => {
        const snapshotName = "Test";
        mockAppConfigurationClientGetSnapshot(snapshotName, {compositionType: "key"});
        mockAppConfigurationClientListConfigurationSettingsForSnapshot(snapshotName, [[createMockedFeatureFlag("TestFeature", { enabled: true })]]);
        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString, {
            featureFlagOptions: {
                enabled: true,
                selectors: [ { snapshotName: snapshotName } ]
            }
        });
        expect(settings).not.undefined;
        expect(settings.get("feature_management")).not.undefined;
        const featureFlags = settings.get<any>("feature_management").feature_flags;
        expect((featureFlags as []).length).equals(1);
        const featureFlag = featureFlags[0];
        expect(featureFlag.id).equals("TestFeature");
        expect(featureFlag.enabled).equals(true);
        restoreMocks();
    });
});
/* eslint-enable @typescript-eslint/no-unused-expressions */
