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
        // Secret references are parsed, validated and resolved during preload; here we only read the
        // cached value. Parsing is guaranteed to succeed because preload runs first.
        const secretIdentifier = parseKeyVaultSecretIdentifier(
            parseSecretReference(setting).value.secretId
        );
        const secretValue = this.#keyVaultSecretProvider.getSecretValue(secretIdentifier);
        return [setting.key, secretValue];
    }

    async preload(settings: ConfigurationSetting[]): Promise<void> {
        if (!this.#keyVaultOptions) {
            return; // no-op when keyVaultOptions is not configured
        }
        // Deduplicate references by secret identifier (sourceId)
        // ConfigurationSetting is for Key Vault reference error building.
        const uniqueSecrets = new Map<string, { secretIdentifier: KeyVaultSecretIdentifier; setting: ConfigurationSetting }>();
        for (const setting of settings) {
            if (!this.canProcess(setting)) {
                continue;
            }
            let secretIdentifier: KeyVaultSecretIdentifier;
            try {
                secretIdentifier = parseKeyVaultSecretIdentifier(
                    parseSecretReference(setting).value.secretId
                );
            } catch (error) {
                throw new KeyVaultReferenceError(buildKeyVaultReferenceErrorMessage("Invalid Key Vault reference.", setting), { cause: error });
            }
            if (!uniqueSecrets.has(secretIdentifier.sourceId)) {
                uniqueSecrets.set(secretIdentifier.sourceId, { secretIdentifier, setting });
            }
        }

        const loadSecret = async ({ secretIdentifier, setting }: { secretIdentifier: KeyVaultSecretIdentifier; setting: ConfigurationSetting }) => {
            try {
                await this.#keyVaultSecretProvider.loadSecretValue(secretIdentifier);
            } catch (error) {
                if (isRestError(error) || error instanceof AuthenticationError) {
                    throw new KeyVaultReferenceError(buildKeyVaultReferenceErrorMessage("Failed to resolve Key Vault reference.", setting, secretIdentifier.sourceId), { cause: error });
                }
                throw error;
            }
        };

        const uniqueSecretEntries = [...uniqueSecrets.values()];
        if (this.#keyVaultOptions.parallelSecretResolutionEnabled) {
            await Promise.all(uniqueSecretEntries.map(loadSecret));
        } else {
            for (const entry of uniqueSecretEntries) {
                await loadSecret(entry);
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
