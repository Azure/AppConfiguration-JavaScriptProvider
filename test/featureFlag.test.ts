// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/* eslint-disable @typescript-eslint/no-unused-expressions */
import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
import { featureFlagContentType } from "@azure/app-configuration";
import { load } from "../src/index.js";
import { convert } from "../src/featureManagement/featureFlagConverter.js";
import { mockAppConfigurationClientGetSnapshot, mockAppConfigurationClientListConfigurationSettingsForSnapshot, createMockedConnectionString, createMockedEndpoint, createMockedFeatureFlag, createMockedEnhancedFeatureFlag, createMockedKeyValue, mockAppConfigurationClientListConfigurationSettings, mockFeatureFlagClientListFeatureFlags, restoreMocks, sleepInMs, expectEnhancedFeatureFlagJsonError } from "./utils/testHelper.js";
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
        mockFeatureFlagClientListFeatureFlags([]);
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
        const snapshotResponses = new Map([
            [snapshotName, { compositionType: "key" }]
        ]);
        const snapshotKVs = new Map([
            [snapshotName, [[createMockedFeatureFlag("TestFeature", { enabled: true })]]]
        ]);
        mockAppConfigurationClientGetSnapshot(snapshotResponses);
        mockAppConfigurationClientListConfigurationSettingsForSnapshot(snapshotKVs);
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

describe("enhanced feature flags", function () {

    afterEach(() => {
        restoreMocks();
    });

    it("should load feature flags from the dedicated feature flag endpoint", async () => {
        // no feature flags; two enhanced feature flags returned by the dedicated endpoint
        mockAppConfigurationClientListConfigurationSettings([[]]);
        mockFeatureFlagClientListFeatureFlags([[
            createMockedEnhancedFeatureFlag("NewAlpha", { enabled: true }),
            createMockedEnhancedFeatureFlag("NewBeta", { enabled: false })
        ]]);

        const settings = await load(createMockedConnectionString(), {
            featureFlagOptions: { enabled: true }
        });

        const featureFlags = settings.get<any>("feature_management").feature_flags as any[];
        expect(featureFlags.length).equals(2);
        expect(featureFlags.find(ff => ff.id === "NewAlpha").enabled).equals(true);
        expect(featureFlags.find(ff => ff.id === "NewBeta").enabled).equals(false);
    });

    it("should load an enhanced feature flag with null optional fields", async () => {
        mockAppConfigurationClientListConfigurationSettings([[]]);
        mockFeatureFlagClientListFeatureFlags([[
            createMockedEnhancedFeatureFlag("Minimal", {
                description: null,
                conditions: null,
                variants: null,
                allocation: null,
                telemetry: null
            })
        ]]);

        const settings = await load(createMockedConnectionString(), {
            featureFlagOptions: { enabled: true }
        });

        const featureFlag = (settings.get<any>("feature_management").feature_flags as any[])
            .find(ff => ff.id === "Minimal");
        expect(featureFlag).not.undefined;
        expect(featureFlag.conditions.client_filters).deep.equals([]);
        expect(featureFlag).not.have.property("description");
        expect(featureFlag).not.have.property("variants");
        expect(featureFlag).not.have.property("allocation");
        expect(featureFlag).not.have.property("telemetry");
    });

    it("should parse enhanced feature flag filter parameters", async () => {
        const audience = {
            Users: ["test@contoso.com"],
            Groups: [{ Name: "contoso.com", RolloutPercentage: 50 }],
            DefaultRolloutPercentage: 0
        };
        mockAppConfigurationClientListConfigurationSettings([[]]);
        mockFeatureFlagClientListFeatureFlags([[
            createMockedEnhancedFeatureFlag("Targeted", {
                conditions: {
                    requirementType: "Any",
                    filters: [{
                        name: "Microsoft.Targeting",
                        parameters: {
                            Audience: JSON.stringify(audience),
                            JsonArray: "  [\"one\",\"two\"]  ",
                            PlainText: "not-json",
                            Percentage: "50"
                        }
                    }]
                }
            })
        ]]);

        const settings = await load(createMockedConnectionString(), {
            featureFlagOptions: { enabled: true }
        });

        const featureFlag = (settings.get<any>("feature_management").feature_flags as any[])
            .find(ff => ff.id === "Targeted");
        const parameters = featureFlag.conditions.client_filters[0].parameters;
        expect(parameters.Audience).deep.equals(audience);
        expect(parameters.JsonArray).deep.equals(["one", "two"]);
        expect(parameters.PlainText).equals("not-json");
        expect(parameters.Percentage).equals("50");
    });

    it("should throw for invalid JSON in enhanced feature flag filter parameters", () => {
        const enhancedFeatureFlag = createMockedEnhancedFeatureFlag("InvalidParameter", {
            conditions: {
                filters: [{
                    name: "CustomFilter",
                    parameters: { Value: "{not-json}" }
                }]
            }
        });

        expectEnhancedFeatureFlagJsonError(() => convert(enhancedFeatureFlag), "InvalidParameter");
    });

    it("should parse enhanced feature flag variants based on content type", () => {
        const enhancedFeatureFlag = createMockedEnhancedFeatureFlag("VariantContentType", {
            variants: [
                { name: "Json", value: "{\"color\":\"blue\"}", contentType: "application/json" },
                { name: "Text", value: "{\"color\":\"blue\"}", contentType: "text/plain" }
            ]
        });

        const featureFlag = convert(enhancedFeatureFlag);
        expect(featureFlag.variants?.[0].configuration_value).deep.equals({ color: "blue" });
        expect(featureFlag.variants?.[1].configuration_value).equals("{\"color\":\"blue\"}");
    });

    it("should throw for invalid JSON in an enhanced feature flag variant", () => {
        const enhancedFeatureFlag = createMockedEnhancedFeatureFlag("InvalidVariant", {
            variants: [{ name: "Json", value: "{not-json}", contentType: "application/json" }]
        });

        expectEnhancedFeatureFlagJsonError(() => convert(enhancedFeatureFlag), "InvalidVariant");
    });

    it("should let an enhanced feature flag supersede a feature flag with the same name", async () => {
        // "Shared" is enabled and "ClassicOnly" exists; the dedicated endpoint returns "Shared" disabled
        const featureFlagSettings = [
            createMockedFeatureFlag("Shared", { enabled: true }),
            createMockedFeatureFlag("ClassicOnly", { enabled: true })
        ];
        mockAppConfigurationClientListConfigurationSettings([featureFlagSettings]);
        mockFeatureFlagClientListFeatureFlags([[
            createMockedEnhancedFeatureFlag("Shared", { enabled: false })
        ]]);

        const settings = await load(createMockedConnectionString(), {
            featureFlagOptions: { enabled: true }
        });

        const featureFlags = settings.get<any>("feature_management").feature_flags as any[];
        // "Shared" appears once (from the dedicated endpoint, disabled); "ClassicOnly" remains
        expect(featureFlags.length).equals(2);
        expect(featureFlags.filter(ff => ff.id === "Shared").length).equals(1);
        expect(featureFlags.find(ff => ff.id === "Shared").enabled).equals(false);
        expect(featureFlags.find(ff => ff.id === "ClassicOnly").enabled).equals(true);
    });

    it("should convert an enhanced feature flag into the feature management schema", async () => {
        const enhancedFeatureFlag = createMockedEnhancedFeatureFlag("Variant", {
            conditions: {
                requirementType: "All",
                filters: [{ name: "Microsoft.TimeWindow", parameters: { Start: "Mon, 01 Jan 2024 00:00:00 GMT" } }]
            },
            variants: [
                { name: "Off", value: false, statusOverride: "Disabled" },
                { name: "On", value: true }
            ],
            allocation: {
                defaultWhenEnabled: "Off",
                defaultWhenDisabled: "Off",
                percentile: [{ variant: "On", from: 0, to: 50 }],
                seed: "seed-value"
            },
            telemetry: { enabled: true }
        });
        mockAppConfigurationClientListConfigurationSettings([[]]);
        mockFeatureFlagClientListFeatureFlags([[enhancedFeatureFlag]]);

        const settings = await load(createMockedConnectionString(), {
            featureFlagOptions: { enabled: true }
        });

        const featureFlag = (settings.get<any>("feature_management").feature_flags as any[]).find(ff => ff.id === "Variant");
        expect(featureFlag).not.undefined;
        expect(featureFlag.enabled).equals(true);
        expect(featureFlag.conditions.requirement_type).equals("All");
        expect(featureFlag.conditions.client_filters[0].name).equals("Microsoft.TimeWindow");
        expect(featureFlag.variants[0].name).equals("Off");
        expect(featureFlag.variants[0].configuration_value).equals(false);
        expect(featureFlag.variants[0].status_override).equals("Disabled");
        expect(featureFlag.allocation.default_when_enabled).equals("Off");
        expect(featureFlag.allocation.percentile[0].variant).equals("On");
        // telemetry enabled => metadata populated with the feature flag reference and allocation id
        expect(featureFlag.telemetry.metadata).not.undefined;
        expect(featureFlag.telemetry.metadata.FeatureFlagReference).equals(`${createMockedEndpoint()}/ff/Variant`);
        expect(featureFlag.telemetry.metadata.AllocationId).not.undefined;
    });

    it("should refresh feature flags when the dedicated endpoint changes", async () => {
        mockAppConfigurationClientListConfigurationSettings([[]]);
        mockFeatureFlagClientListFeatureFlags([[
            createMockedEnhancedFeatureFlag("NewFlag", { enabled: true })
        ]]);

        const settings = await load(createMockedConnectionString(), {
            featureFlagOptions: {
                enabled: true,
                refresh: { enabled: true, refreshIntervalInMs: 1000 }
            }
        });

        let featureFlag = (settings.get<any>("feature_management").feature_flags as any[]).find(ff => ff.id === "NewFlag");
        expect(featureFlag.enabled).equals(true);

        // the enhanced feature flag on the dedicated endpoint changes
        restoreMocks();
        mockAppConfigurationClientListConfigurationSettings([[]]);
        mockFeatureFlagClientListFeatureFlags([[
            createMockedEnhancedFeatureFlag("NewFlag", { enabled: false })
        ]]);

        await sleepInMs(1000 + 1);
        await settings.refresh();

        featureFlag = (settings.get<any>("feature_management").feature_flags as any[]).find(ff => ff.id === "NewFlag");
        expect(featureFlag.enabled).equals(false);
    });
});
/* eslint-enable @typescript-eslint/no-unused-expressions */
