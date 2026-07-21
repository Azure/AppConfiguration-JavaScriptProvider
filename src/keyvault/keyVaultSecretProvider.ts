// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { KeyVaultOptions, MIN_SECRET_REFRESH_INTERVAL_IN_MS } from "./keyVaultOptions.js";
import { RefreshTimer } from "../refresh/refreshTimer.js";
import { ArgumentError, KeyVaultReferenceError } from "../common/errors.js";
import { SecretClient, KeyVaultSecretIdentifier } from "@azure/keyvault-secrets";
import { KeyVaultReferenceErrorMessages, buildKeyVaultReferenceErrorMessage } from "../common/errorMessages.js";
import { isRestError } from "@azure/core-rest-pipeline";
import { AuthenticationError } from "@azure/identity";

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

    async loadSecretValue(secretIdentifier: KeyVaultSecretIdentifier): Promise<unknown> {
        const identifierKey = secretIdentifier.sourceId;
        const shouldRefresh = this.#secretRefreshTimer?.canRefresh() ?? false;
        if (this.#cachedSecretValues.has(identifierKey) && !shouldRefresh) {
            return this.#cachedSecretValues.get(identifierKey); // already cached and still fresh
        }
        let secretValue: unknown;
        try {
            secretValue = await this.#getSecretValueFromKeyVault(secretIdentifier);
        } catch (error) {
            if (isRestError(error) || error instanceof AuthenticationError) {
                throw new KeyVaultReferenceError(buildKeyVaultReferenceErrorMessage("Failed to resolve Key Vault reference.", secretIdentifier.sourceId), { cause: error });
            }
            throw error;
        }
        this.#cachedSecretValues.set(identifierKey, secretValue);
        return secretValue;
    }

    // Serves the secret value from cache when available; otherwise loads it from Key Vault on demand.
    async getSecretValue(secretIdentifier: KeyVaultSecretIdentifier): Promise<unknown> {
        const identifierKey = secretIdentifier.sourceId;
        if (this.#cachedSecretValues.has(identifierKey)) {
            return this.#cachedSecretValues.get(identifierKey); // serve from cache
        }
        return this.loadSecretValue(secretIdentifier); // fallback: load on demand
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
