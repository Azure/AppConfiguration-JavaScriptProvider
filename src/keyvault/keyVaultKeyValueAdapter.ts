// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { ConfigurationSetting, isSecretReference, parseSecretReference } from "@azure/app-configuration";
import { IKeyValueAdapter } from "../keyValueAdapter.js";
import { AzureKeyVaultSecretProvider } from "./keyVaultSecretProvider.js";
import { KeyVaultOptions } from "./keyVaultOptions.js";
import { RefreshTimer } from "../refresh/refreshTimer.js";
import { ArgumentError, KeyVaultReferenceError } from "../common/errors.js";
import { KeyVaultReferenceErrorMessages } from "../common/errorMessages.js";
import { KeyVaultSecretIdentifier, parseKeyVaultSecretIdentifier } from "@azure/keyvault-secrets";
import { isRestError } from "@azure/core-rest-pipeline";
import { AuthenticationError } from "@azure/identity";

export class AzureKeyVaultKeyValueAdapter implements IKeyValueAdapter {
    #keyVaultOptions: KeyVaultOptions | undefined;
    #keyVaultSecretProvider: AzureKeyVaultSecretProvider;

    constructor(keyVaultOptions?: KeyVaultOptions, refreshTimer?: RefreshTimer) {
        this.#keyVaultOptions = keyVaultOptions;
        this.#keyVaultSecretProvider = new AzureKeyVaultSecretProvider(keyVaultOptions, refreshTimer);
    }

    canProcess(setting: ConfigurationSetting): boolean {
        return isSecretReference(setting);
    }

    async processKeyValue(setting: ConfigurationSetting): Promise<[string, unknown]> {
        if (!this.#keyVaultOptions) {
            throw new ArgumentError(KeyVaultReferenceErrorMessages.KEY_VAULT_OPTIONS_UNDEFINED);
        }
        let secretIdentifier: KeyVaultSecretIdentifier;
        try {
            secretIdentifier = parseKeyVaultSecretIdentifier(
                parseSecretReference(setting).value.secretId
            );
        } catch (error) {
            throw new KeyVaultReferenceError(buildKeyVaultReferenceErrorMessage("Invalid Key Vault reference.", setting), { cause: error });
        }

        try {
            const secretValue = await this.#keyVaultSecretProvider.getSecretValue(secretIdentifier);
            return [setting.key, secretValue];
        } catch (error) {
            if (isRestError(error) || error instanceof AuthenticationError) {
                throw new KeyVaultReferenceError(buildKeyVaultReferenceErrorMessage("Failed to resolve Key Vault reference.", setting, secretIdentifier.sourceId), { cause: error });
            }
            throw error;
        }
    }

    async preload(settings: ConfigurationSetting[]): Promise<void> {
        if (!this.#keyVaultOptions) {
            return; // no-op when keyVaultOptions is not configured
        }
        const uniqueSecretIdentifiers = new Map<string, KeyVaultSecretIdentifier>();
        for (const setting of settings) {
            if (!this.canProcess(setting)) {
                continue;
            }
            try {
                const secretIdentifier = parseKeyVaultSecretIdentifier(
                    parseSecretReference(setting).value.secretId
                );
                uniqueSecretIdentifiers.set(secretIdentifier.sourceId, secretIdentifier); // dedup by sourceId
            } catch {
                // Skip invalid references; processKeyValue re-parses and raises KeyVaultReferenceError with context.
            }
        }

        const loadSecret = async (secretIdentifier: KeyVaultSecretIdentifier) => {
            try {
                await this.#keyVaultSecretProvider.loadSecretValue(secretIdentifier);
            } catch {
                // Leave uncached; getSecretValue re-fetches and surfaces the error during resolution.
            }
        };

        if (this.#keyVaultOptions?.parallelSecretResolutionEnabled) {
            await Promise.all([...uniqueSecretIdentifiers.values()].map(loadSecret));
        } else {
            for (const secretIdentifier of uniqueSecretIdentifiers.values()) {
                await loadSecret(secretIdentifier);
            }
        }
    }

    async onChangeDetected(): Promise<void> {
        this.#keyVaultSecretProvider.clearCache();
        return;
    }
}

function buildKeyVaultReferenceErrorMessage(message: string, setting: ConfigurationSetting, secretIdentifier?: string ): string {
    return `${message} Key: '${setting.key}' Label: '${setting.label ?? ""}' ETag: '${setting.etag ?? ""}' ${secretIdentifier ? ` SecretIdentifier: '${secretIdentifier}'` : ""}`;
}
