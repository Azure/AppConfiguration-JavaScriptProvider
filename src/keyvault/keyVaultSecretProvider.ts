// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { KeyVaultOptions, MIN_SECRET_REFRESH_INTERVAL_IN_MS } from "./keyVaultOptions.js";
import { RefreshTimer } from "../refresh/refreshTimer.js";
import { ArgumentError } from "../common/errors.js";
import { SecretClient, KeyVaultSecretIdentifier } from "@azure/keyvault-secrets";
import { KeyVaultReferenceErrorMessages } from "../common/errorMessages.js";

export class AzureKeyVaultSecretProvider {
    #keyVaultOptions: KeyVaultOptions | undefined;
    #secretRefreshTimer: RefreshTimer | undefined;
    #minSecretRefreshTimer: RefreshTimer;
    #secretClients: Map<string, SecretClient>; // map key vault hostname to corresponding secret client
    #cachedSecretValues: Map<string, any> = new Map<string, any>(); // map secret identifier to secret value

    constructor(keyVaultOptions?: KeyVaultOptions, refreshTimer?: RefreshTimer) {
        if (keyVaultOptions?.secretRefreshIntervalInMs !== undefined) {
            if (refreshTimer === undefined) {
                throw new ArgumentError("Refresh timer must be specified when Key Vault secret refresh is enabled.");
            }
            if (refreshTimer.interval !== keyVaultOptions.secretRefreshIntervalInMs) {
                throw new ArgumentError("Refresh timer does not match the secret refresh interval.");
            }
        }
        this.#keyVaultOptions = keyVaultOptions;
        this.#secretRefreshTimer = refreshTimer;
        this.#minSecretRefreshTimer = new RefreshTimer(MIN_SECRET_REFRESH_INTERVAL_IN_MS);
        this.#secretClients = new Map();
        for (const client of this.#keyVaultOptions?.secretClients ?? []) {
            const clientUrl = new URL(client.vaultUrl);
            this.#secretClients.set(clientUrl.host, client);
        }
    }

    async loadSecretValue(secretIdentifier: KeyVaultSecretIdentifier): Promise<void> {
        const identifierKey = secretIdentifier.sourceId;
        const shouldRefresh = this.#secretRefreshTimer?.canRefresh() ?? false;
        if (this.#cachedSecretValues.has(identifierKey) && !shouldRefresh) {
            return; // already cached and still fresh
        }
        this.#cachedSecretValues.set(identifierKey, await this.#getSecretValueFromKeyVault(secretIdentifier));
    }

    // Reads a secret value that was fetched into the cache during preload. All network I/O happens in preload.
    getSecretValue(secretIdentifier: KeyVaultSecretIdentifier): unknown {
        return this.#cachedSecretValues.get(secretIdentifier.sourceId);
    }

    clearCache(): void {
        if (this.#minSecretRefreshTimer.canRefresh()) {
            this.#cachedSecretValues.clear();
            this.#minSecretRefreshTimer.reset();
        }
    }

    async #getSecretValueFromKeyVault(secretIdentifier: KeyVaultSecretIdentifier): Promise<unknown> {
        if (!this.#keyVaultOptions) {
            throw new ArgumentError(KeyVaultReferenceErrorMessages.KEY_VAULT_OPTIONS_UNDEFINED);
        }
        const { name: secretName, vaultUrl, sourceId, version } = secretIdentifier;
        // precedence: secret clients > custom secret resolver
        const client = this.#getSecretClient(new URL(vaultUrl));
        if (client) {
            const secret = await client.getSecret(secretName, { version });
            return secret.value;
        }
        if (this.#keyVaultOptions.secretResolver) {
            return await this.#keyVaultOptions.secretResolver(new URL(sourceId));
        }
        // When code reaches here, it means that the key vault reference cannot be resolved in all possible ways.
        throw new ArgumentError(KeyVaultReferenceErrorMessages.KEY_VAULT_REFERENCE_UNRESOLVABLE);
    }

    #getSecretClient(vaultUrl: URL): SecretClient | undefined {
        let client = this.#secretClients.get(vaultUrl.host);
        if (client !== undefined) {
            return client;
        }
        if (this.#keyVaultOptions?.credential) {
            client = new SecretClient(vaultUrl.toString(), this.#keyVaultOptions.credential, this.#keyVaultOptions.clientOptions);
            this.#secretClients.set(vaultUrl.host, client);
            return client;
        }
        return undefined;
    }
}
