// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { randomUUID } from "node:crypto";
import { AppConfigurationClient, featureFlagContentType, featureFlagPrefix } from "@azure/app-configuration";
import type { ConfigurationSettingId, FeatureFlagValue, SetConfigurationSettingParam } from "@azure/app-configuration";
import type { PipelinePolicy } from "@azure/core-rest-pipeline";
import type { TokenCredential } from "@azure/identity";
import type { AzureAppConfiguration } from "../../src/index.js";

export const INTEGRATION_TEST_ENDPOINT = "https://appconfig-jsprovider-integrationtest.azconfig.io";
export const REFRESH_INTERVAL_IN_MS = 1_000;
const REFRESH_TIMEOUT_IN_MS = 30_000;

export async function refreshUntil(
    settings: Pick<AzureAppConfiguration, "refresh">,
    condition: () => boolean,
    description: string
): Promise<void> {
    const deadline = Date.now() + REFRESH_TIMEOUT_IN_MS;

    while (Date.now() < deadline) {
        await settings.refresh();
        if (Date.now() < deadline && condition()) {
            return;
        }

        const remaining = deadline - Date.now();
        if (remaining > 0) {
            await new Promise<void>(resolve => setTimeout(resolve, Math.min(REFRESH_INTERVAL_IN_MS, remaining)));
        }
    }

    throw new Error(`Timed out after ${REFRESH_TIMEOUT_IN_MS} ms waiting for ${description}.`);
}

export function createNotModifiedResponseTracker(): { readonly count: number; policy: PipelinePolicy } {
    let count = 0;
    return {
        get count() {
            return count;
        },
        policy: {
            name: "integration-test-not-modified-tracker",
            async sendRequest(request, next) {
                const response = await next(request);
                if (response.status === 304) {
                    count++;
                }
                return response;
            }
        }
    };
}

export class IntegrationTestContext {
    readonly keyPrefix = `jsprovider-it-${randomUUID()}-`;
    readonly #client: AppConfigurationClient;
    #settings: ConfigurationSettingId[] = [];

    constructor(endpoint: string, credential: TokenCredential) {
        this.#client = new AppConfigurationClient(endpoint, credential);
    }

    key(name: string): string {
        return `${this.keyPrefix}${name}`;
    }

    featureFlagKey(name: string): string {
        return `${featureFlagPrefix}${this.key(name)}`;
    }

    async setSetting(
        name: string,
        value: string,
        options: Pick<SetConfigurationSettingParam, "label" | "contentType"> = {}
    ): Promise<void> {
        await this.#setSetting({ ...options, key: this.key(name), value });
    }

    async setFeatureFlag(
        name: string,
        enabled: boolean,
        options: Pick<ConfigurationSettingId, "label"> = {}
    ): Promise<void> {
        await this.#setSetting({
            ...options,
            key: this.featureFlagKey(name),
            contentType: featureFlagContentType,
            value: {
                id: this.key(name),
                enabled,
                conditions: { clientFilters: [], requirementType: "Any" }
            }
        });
    }

    async deleteSetting(name: string, options: Pick<ConfigurationSettingId, "label"> = {}): Promise<void> {
        await this.#client.deleteConfigurationSetting({ key: this.key(name), label: options.label });
    }

    async deleteFeatureFlag(name: string, options: Pick<ConfigurationSettingId, "label"> = {}): Promise<void> {
        await this.#client.deleteConfigurationSetting({ key: this.featureFlagKey(name), label: options.label });
    }

    async #setSetting(setting: SetConfigurationSettingParam | SetConfigurationSettingParam<FeatureFlagValue>): Promise<void> {
        // A failed request may still have written the setting, so track it before sending.
        if (!this.#settings.some(existing => existing.key === setting.key && existing.label === setting.label)) {
            this.#settings.push({ key: setting.key, label: setting.label });
        }

        await this.#client.setConfigurationSetting(setting);
    }

    async cleanup(): Promise<void> {
        const failedSettings: ConfigurationSettingId[] = [];
        const errors: Error[] = [];

        for (const setting of this.#settings) {
            try {
                await this.#client.deleteConfigurationSetting(setting);
            } catch (error) {
                failedSettings.push(setting);
                errors.push(new Error(
                    `Failed to delete integration test key '${setting.key}' with label '${setting.label ?? "<no label>"}'.`,
                    { cause: error }
                ));
            }
        }

        this.#settings = failedSettings;
        if (errors.length > 0) {
            throw new AggregateError(errors, `Failed to clean up integration test settings with prefix '${this.keyPrefix}'.`);
        }
    }
}
