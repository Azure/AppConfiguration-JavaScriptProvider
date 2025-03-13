// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { ConfigurationSetting, isSecretReference, parseSecretReference } from "@azure/app-configuration";
import { IKeyValueAdapter } from "../IKeyValueAdapter.js";
import { AzureKeyVaultSecretProvider } from "./AzureKeyVaultSecretProvider.js";
import { KeyVaultOptions } from "./KeyVaultOptions.js";
import { RefreshTimer } from "../refresh/RefreshTimer.js";
import { ArgumentError, KeyVaultReferenceError } from "../error.js";
import { parseKeyVaultSecretIdentifier, KeyVaultSecretIdentifier } from "@azure/keyvault-secrets";

export class AzureKeyVaultKeyValueAdapter implements IKeyValueAdapter {
    #keyVaultOptions: KeyVaultOptions | undefined;
    #keyVaultSecretProvider: AzureKeyVaultSecretProvider;

    constructor(keyVaultOptions: KeyVaultOptions | undefined, refreshTimer?: RefreshTimer) {
        this.#keyVaultOptions = keyVaultOptions;
        this.#keyVaultSecretProvider = new AzureKeyVaultSecretProvider(keyVaultOptions, refreshTimer);
    }

    canProcess(setting: ConfigurationSetting): boolean {
        return isSecretReference(setting);
    }

    async processKeyValue(setting: ConfigurationSetting): Promise<[string, unknown]> {
        if (!this.#keyVaultOptions) {
            throw new ArgumentError("Failed to process the key vault reference. The keyVaultOptions is not configured.");
        }

        const secretIdentifier: KeyVaultSecretIdentifier = parseKeyVaultSecretIdentifier(
            parseSecretReference(setting).value.secretId
        );
        try {
            const secretValue = await this.#keyVaultSecretProvider.getSecretValue(secretIdentifier);
            return [setting.key, secretValue];
        } catch (error) {
            if (error instanceof ArgumentError) {
                throw error;
            }
            throw new KeyVaultReferenceError(buildKeyVaultReferenceErrorMessage(error.message, setting, secretIdentifier.sourceId));
        }
    }

    async onChangeDetected(): Promise<void> {
        this.#keyVaultSecretProvider.clearCache();
        return;
    }
}

function buildKeyVaultReferenceErrorMessage(message: string, setting: ConfigurationSetting, secretIdentifier?: string ): string {
    return `${message} Key: '${setting.key}' Label: '${setting.label ?? ""}' ETag: '${setting.etag ?? ""}' SecretIdentifier: '${secretIdentifier ?? ""}'`;
}
