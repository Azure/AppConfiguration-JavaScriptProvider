// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/* eslint-disable @typescript-eslint/no-unused-expressions */
import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);
const expect = chai.expect;
import { load } from "../src/index.js";
import { sinon, createMockedConnectionString, createMockedTokenCredential, mockAppConfigurationClientListConfigurationSettings, mockAppConfigurationClientGetConfigurationSetting, mockSecretClientGetSecret, restoreMocks, createMockedKeyVaultReference, createMockedKeyValue, sleepInMs } from "./utils/testHelper.js";
import { KeyVaultSecret, SecretClient } from "@azure/keyvault-secrets";
import { ErrorMessages, KeyVaultReferenceErrorMessages } from "../src/common/errorMessages.js";

const mockedData = [
    // key, secretUri, value
    ["TestKey", "https://fake-vault-name.vault.azure.net/secrets/fakeSecretName", "SecretValue"],
    ["TestKeyFixedVersion", "https://fake-vault-name.vault.azure.net/secrets/fakeSecretName/741a0fc52610449baffd6e1c55b9d459", "OldSecretValue"],
    ["TestKey2", "https://fake-vault-name2.vault.azure.net/secrets/fakeSecretName2", "SecretValue2"]
];

function mockAppConfigurationClient() {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const kvs = mockedData.map(([key, vaultUri, _value]) => createMockedKeyVaultReference(key, vaultUri));
    mockAppConfigurationClientListConfigurationSettings([kvs]);
}

function mockNewlyCreatedKeyVaultSecretClients() {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    mockSecretClientGetSecret(mockedData.map(([_key, secretUri, value]) => [secretUri, value]));
}

describe("key vault reference", function () {

    beforeEach(() => {
        mockAppConfigurationClient();
        mockNewlyCreatedKeyVaultSecretClients();
    });

    afterEach(() => {
        restoreMocks();
    });

    it("require key vault options to resolve reference", async () => {
        try {
            await load(createMockedConnectionString());
        } catch (error) {
            expect(error.message).eq(ErrorMessages.LOAD_OPERATION_FAILED);
            expect(error.cause.message).eq(KeyVaultReferenceErrorMessages.KEY_VAULT_OPTIONS_UNDEFINED);
            return;
        }
        // we should never reach here, load should throw an error
        throw new Error("Expected load to throw.");
    });

    it("should resolve key vault reference with credential", async () => {
        const settings = await load(createMockedConnectionString(), {
            keyVaultOptions: {
                credential: createMockedTokenCredential()
            }
        });
        expect(settings).not.undefined;
        expect(settings.get("TestKey")).eq("SecretValue");
        expect(settings.get("TestKeyFixedVersion")).eq("OldSecretValue");
    });

    it("should resolve key vault reference with secret resolver", async () => {
        const settings = await load(createMockedConnectionString(), {
            keyVaultOptions: {
                secretResolver: (kvrUrl) => {
                    return "SecretResolver::" + kvrUrl.toString();
                }
            }
        });
        expect(settings).not.undefined;
        expect(settings.get("TestKey")).eq("SecretResolver::https://fake-vault-name.vault.azure.net/secrets/fakeSecretName");
    });

    it("should resolve key vault reference with corresponding secret clients", async () => {
        sinon.restore();
        mockAppConfigurationClient();

        // mock specific behavior per secret client
        const client1 = new SecretClient("https://fake-vault-name.vault.azure.net", createMockedTokenCredential());
        sinon.stub(client1, "getSecret").returns(Promise.resolve({value: "SecretValueViaClient1" } as KeyVaultSecret));
        const client2 = new SecretClient("https://fake-vault-name2.vault.azure.net", createMockedTokenCredential());
        sinon.stub(client2, "getSecret").returns(Promise.resolve({value: "SecretValueViaClient2" } as KeyVaultSecret));
        const settings = await load(createMockedConnectionString(), {
            keyVaultOptions: {
                secretClients: [
                    client1,
                    client2,
                ]
            }
        });
        expect(settings).not.undefined;
        expect(settings.get("TestKey")).eq("SecretValueViaClient1");
        expect(settings.get("TestKey2")).eq("SecretValueViaClient2");
    });

    it("should throw error when secret clients not provided for all key vault references", async () => {
        try {
            await load(createMockedConnectionString(), {
                keyVaultOptions: {
                    secretClients: [
                        new SecretClient("https://fake-vault-name.vault.azure.net", createMockedTokenCredential()),
                    ]
                }
            });
        } catch (error) {
            expect(error.message).eq(ErrorMessages.LOAD_OPERATION_FAILED);
            expect(error.cause.message).eq(KeyVaultReferenceErrorMessages.KEY_VAULT_REFERENCE_UNRESOLVABLE);
            return;
        }
        // we should never reach here, load should throw an error
        throw new Error("Expected load to throw.");
    });

    it("should fallback to use default credential when corresponding secret client not provided", async () => {
        const settings = await load(createMockedConnectionString(), {
            keyVaultOptions: {
                secretClients: [
                    new SecretClient("https://fake-vault-name.vault.azure.net", createMockedTokenCredential()),
                ],
                credential: createMockedTokenCredential()
            }
        });
        expect(settings).not.undefined;
        expect(settings.get("TestKey")).eq("SecretValue");
        expect(settings.get("TestKey2")).eq("SecretValue2");
    });

    it("should resolve key vault reference in parallel", async () => {
        const settings = await load(createMockedConnectionString(), {
            keyVaultOptions: {
                credential: createMockedTokenCredential(),
                parallelSecretResolutionEnabled: true
            }
        });
        expect(settings).not.undefined;
        expect(settings.get("TestKey")).eq("SecretValue");
        expect(settings.get("TestKeyFixedVersion")).eq("OldSecretValue");
    });
});

describe("key vault secret refresh", function () {

    beforeEach(() => {
        const data = [
            ["TestKey", "https://fake-vault-name.vault.azure.net/secrets/fakeSecretName", "SecretValue"]
        ];
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const kvs = data.map(([key, vaultUri, _value]) => createMockedKeyVaultReference(key, vaultUri));
        mockAppConfigurationClientListConfigurationSettings([kvs]);
    });

    afterEach(() => {
        restoreMocks();
    });

    it("should not allow secret refresh interval less than 1 minute", async () => {
        const connectionString = createMockedConnectionString();
        const loadWithInvalidSecretRefreshInterval = load(connectionString, {
            keyVaultOptions: {
                secretClients: [
                    new SecretClient("https://fake-vault-name.vault.azure.net", createMockedTokenCredential()),
                ],
                secretRefreshIntervalInMs: 59999 // less than 60_000 milliseconds
            }
        });
        return expect(loadWithInvalidSecretRefreshInterval).eventually.rejectedWith(ErrorMessages.INVALID_SECRET_REFRESH_INTERVAL);
    });

    it("should reload key vault secret when there is no change to key-values", async () => {
        const client = new SecretClient("https://fake-vault-name.vault.azure.net", createMockedTokenCredential());
        const stub = sinon.stub(client, "getSecret");
        stub.onCall(0).resolves({ value: "SecretValue" } as KeyVaultSecret);
        stub.onCall(1).resolves({ value: "SecretValue - Updated" } as KeyVaultSecret);

        const settings = await load(createMockedConnectionString(), {
            keyVaultOptions: {
                secretClients: [
                    client
                ],
                credential: createMockedTokenCredential(),
                secretRefreshIntervalInMs: 60_000
            }
        });
        expect(settings).not.undefined;
        expect(settings.get("TestKey")).eq("SecretValue");

        await sleepInMs(30_000);
        await settings.refresh();
        // use cached value
        expect(settings.get("TestKey")).eq("SecretValue");

        await sleepInMs(30_000);
        await settings.refresh();
        // secret refresh interval expires, reload secret value
        expect(settings.get("TestKey")).eq("SecretValue - Updated");
    });
});

describe("min secret refresh interval during key-value refresh", function () {
    let getSecretCallCount = 0;
    let sentinelEtag = "initial-etag";

    afterEach(() => {
        restoreMocks();
        getSecretCallCount = 0;
    });

    /**
     * This test verifies the enforcement of the minimum secret refresh interval during key-value refresh.
     * When key-value refresh is triggered (by a watched setting change), the provider calls clearCache()
     * on the KeyVaultSecretProvider. However, clearCache() only clears the cache if the minimum secret
     * refresh interval (60 seconds) has passed. This prevents overwhelming Key Vaults with too many requests.
     */
    it("should not re-fetch secrets when key-value refresh happens within min secret refresh interval", async () => {
        // Setup: key vault reference + sentinel key for watching
        const kvWithSentinel = [
            createMockedKeyVaultReference("TestKey", "https://fake-vault-name.vault.azure.net/secrets/fakeSecretName"),
            createMockedKeyValue({ key: "sentinel", value: "initialValue", etag: sentinelEtag })
        ];
        mockAppConfigurationClientListConfigurationSettings([kvWithSentinel]);
        mockAppConfigurationClientGetConfigurationSetting(kvWithSentinel);

        // Mock SecretClient with call counting
        const client = new SecretClient("https://fake-vault-name.vault.azure.net", createMockedTokenCredential());
        sinon.stub(client, "getSecret").callsFake(async () => {
            getSecretCallCount++;
            return { value: "SecretValue" } as KeyVaultSecret;
        });

        // Load with key-value refresh enabled (watching sentinel)
        const settings = await load(createMockedConnectionString(), {
            refreshOptions: {
                enabled: true,
                refreshIntervalInMs: 1000, // 1 second refresh interval for key-values
                watchedSettings: [{ key: "sentinel" }]
            },
            keyVaultOptions: {
                secretClients: [client]
            }
        });

        expect(settings.get("TestKey")).eq("SecretValue");
        expect(getSecretCallCount).eq(1); // Initial load fetched the secret

        // Simulate sentinel change to trigger key-value refresh
        sentinelEtag = "changed-etag-1";
        const updatedKvs = [
            createMockedKeyVaultReference("TestKey", "https://fake-vault-name.vault.azure.net/secrets/fakeSecretName"),
            createMockedKeyValue({ key: "sentinel", value: "changedValue1", etag: sentinelEtag })
        ];
        restoreMocks();
        mockAppConfigurationClientListConfigurationSettings([updatedKvs]);
        mockAppConfigurationClientGetConfigurationSetting(updatedKvs);
        sinon.stub(client, "getSecret").callsFake(async () => {
            getSecretCallCount++;
            return { value: "SecretValue" } as KeyVaultSecret;
        });

        // Wait for refresh interval and trigger refresh
        await sleepInMs(1000 + 100);
        await settings.refresh();

        // Key-value refresh happened, but secret should NOT be re-fetched
        // because min secret refresh interval (60s) hasn't passed
        expect(getSecretCallCount).eq(1); // Still 1, no additional getSecret call

        // Trigger another key-value refresh
        sentinelEtag = "changed-etag-2";
        const updatedKvs2 = [
            createMockedKeyVaultReference("TestKey", "https://fake-vault-name.vault.azure.net/secrets/fakeSecretName"),
            createMockedKeyValue({ key: "sentinel", value: "changedValue2", etag: sentinelEtag })
        ];
        restoreMocks();
        mockAppConfigurationClientListConfigurationSettings([updatedKvs2]);
        mockAppConfigurationClientGetConfigurationSetting(updatedKvs2);
        sinon.stub(client, "getSecret").callsFake(async () => {
            getSecretCallCount++;
            return { value: "SecretValue" } as KeyVaultSecret;
        });

        await sleepInMs(1000 + 100);
        await settings.refresh();

        // Still no additional getSecret call due to min interval enforcement
        expect(getSecretCallCount).eq(1);
    });

    it("should re-fetch secrets after min secret refresh interval passes during key-value refresh", async () => {
        // Setup: key vault reference + sentinel key for watching
        let currentSentinelValue = "initialValue";
        sentinelEtag = "initial-etag";

        const getKvs = () => [
            createMockedKeyVaultReference("TestKey", "https://fake-vault-name.vault.azure.net/secrets/fakeSecretName"),
            createMockedKeyValue({ key: "sentinel", value: currentSentinelValue, etag: sentinelEtag })
        ];

        mockAppConfigurationClientListConfigurationSettings([getKvs()]);
        mockAppConfigurationClientGetConfigurationSetting(getKvs());

        // Mock SecretClient with call counting
        const client = new SecretClient("https://fake-vault-name.vault.azure.net", createMockedTokenCredential());
        sinon.stub(client, "getSecret").callsFake(async () => {
            getSecretCallCount++;
            return { value: `SecretValue-${getSecretCallCount}` } as KeyVaultSecret;
        });

        // Load with key-value refresh enabled
        const settings = await load(createMockedConnectionString(), {
            refreshOptions: {
                enabled: true,
                refreshIntervalInMs: 1000,
                watchedSettings: [{ key: "sentinel" }]
            },
            keyVaultOptions: {
                secretClients: [client]
            }
        });

        expect(settings.get("TestKey")).eq("SecretValue-1");
        expect(getSecretCallCount).eq(1);

        // Wait for min secret refresh interval (60 seconds) to pass
        await sleepInMs(60_000 + 100);

        // Now change sentinel to trigger key-value refresh
        currentSentinelValue = "changedValue";
        sentinelEtag = "changed-etag";
        restoreMocks();
        mockAppConfigurationClientListConfigurationSettings([getKvs()]);
        mockAppConfigurationClientGetConfigurationSetting(getKvs());
        sinon.stub(client, "getSecret").callsFake(async () => {
            getSecretCallCount++;
            return { value: `SecretValue-${getSecretCallCount}` } as KeyVaultSecret;
        });

        await sleepInMs(1000 + 100); // Wait for kv refresh interval
        await settings.refresh();

        // Now getSecret SHOULD be called again because min interval has passed
        expect(getSecretCallCount).eq(2);
        expect(settings.get("TestKey")).eq("SecretValue-2");
    });
});
/* eslint-enable @typescript-eslint/no-unused-expressions */
