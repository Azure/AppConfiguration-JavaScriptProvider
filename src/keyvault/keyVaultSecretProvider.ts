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

    /**
     * Fetches the given unique secrets ahead of resolution to warm the cache. Honors the secret refresh
     * timer and the parallel resolution option. This is best-effort: per-secret failures are swallowed so
     * that the error is surfaced with full context later by getSecretValue during resolution.
     */
    async preloadSecrets(secretIdentifiers: KeyVaultSecretIdentifier[]): Promise<void> {
        const loadSecret = async (secretIdentifier: KeyVaultSecretIdentifier) => {
            try {
                await this.#loadSecretValue(secretIdentifier);
            } catch {
                // Leave uncached; getSecretValue re-fetches and surfaces the error during resolution.
            }
        };

        if (this.#keyVaultOptions?.parallelSecretResolutionEnabled) {
            await Promise.all(secretIdentifiers.map(loadSecret));
        } else {
            for (const secretIdentifier of secretIdentifiers) {
                await loadSecret(secretIdentifier);
            }
        }
    }

    /**
     * Fetches a secret value into the cache if it is not cached yet, or if the secret refresh interval has
     * expired. This is the only place the refresh timer gates a fetch.
     */
    async #loadSecretValue(secretIdentifier: KeyVaultSecretIdentifier): Promise<void> {
        const identifierKey = secretIdentifier.sourceId;
        const shouldRefresh = this.#secretRefreshTimer?.canRefresh() ?? false;
        if (this.#cachedSecretValues.has(identifierKey) && !shouldRefresh) {
            return; // already cached and still fresh
        }
        this.#cachedSecretValues.set(identifierKey, await this.#getSecretValueFromKeyVault(secretIdentifier));
    }

    async getSecretValue(secretIdentifier: KeyVaultSecretIdentifier): Promise<unknown> {
        const identifierKey = secretIdentifier.sourceId;

        // Return the cached value if available. Freshness is handled by preloadSecrets, which warms the
        // cache before resolution.
        if (this.#cachedSecretValues.has(identifierKey)) {
            return this.#cachedSecretValues.get(identifierKey);
        }

        // Fallback for secrets that preload skipped or failed to fetch. Failures are not cached, so a
        // subsequent call will retry.
        const secretValue = await this.#getSecretValueFromKeyVault(secretIdentifier);
        this.#cachedSecretValues.set(identifierKey, secretValue);
        return secretValue;
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
