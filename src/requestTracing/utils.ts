// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { AppConfigurationClient, ConfigurationSettingId, GetConfigurationSettingOptions, ListConfigurationSettingsOptions } from "@azure/app-configuration";
import { AzureAppConfigurationOptions } from "../AzureAppConfigurationOptions.js";
import { FeatureFlagTracingOptions } from "./FeatureFlagTracingOptions.js";
import {
    AZURE_FUNCTION_ENV_VAR,
    AZURE_WEB_APP_ENV_VAR,
    CONTAINER_APP_ENV_VAR,
    DEV_ENV_VAL,
    ENV_AZURE_APP_CONFIGURATION_TRACING_DISABLED,
    ENV_KEY,
    FEATURE_FILTER_TYPE_KEY,
    FF_MAX_VARIANTS_KEY,
    FF_FEATURES_KEY,
    HOST_TYPE_KEY,
    HostType,
    KEY_VAULT_CONFIGURED_TAG,
    KUBERNETES_ENV_VAR,
    NODEJS_DEV_ENV_VAL,
    NODEJS_ENV_VAR,
    REQUEST_TYPE_KEY,
    RequestType,
    SERVICE_FABRIC_ENV_VAR,
    CORRELATION_CONTEXT_HEADER_NAME,
    REPLICA_COUNT_KEY,
    FAILOVER_REQUEST_TAG,
    FEATURES_KEY,
    LOAD_BALANCE_CONFIGURED_TAG
} from "./constants";

export interface RequestTracingOptions {
    enabled: boolean;
    appConfigOptions: AzureAppConfigurationOptions | undefined;
    initialLoadCompleted: boolean;
    replicaCount: number;
    isFailoverRequest: boolean;
    featureFlagTracing: FeatureFlagTracingOptions | undefined;
}

// Utils
export function listConfigurationSettingsWithTrace(
    requestTracingOptions: RequestTracingOptions,
    client: AppConfigurationClient,
    listOptions: ListConfigurationSettingsOptions
) {
    const actualListOptions = { ...listOptions };
    if (requestTracingOptions.enabled) {
        actualListOptions.requestOptions = {
            customHeaders: {
                [CORRELATION_CONTEXT_HEADER_NAME]: createCorrelationContextHeader(requestTracingOptions)
            }
        };
    }

    return client.listConfigurationSettings(actualListOptions);
}

export function getConfigurationSettingWithTrace(
    requestTracingOptions: RequestTracingOptions,
    client: AppConfigurationClient,
    configurationSettingId: ConfigurationSettingId,
    getOptions?: GetConfigurationSettingOptions,
) {
    const actualGetOptions = { ...getOptions };

    if (requestTracingOptions.enabled) {
        actualGetOptions.requestOptions = {
            customHeaders: {
                [CORRELATION_CONTEXT_HEADER_NAME]: createCorrelationContextHeader(requestTracingOptions)
            }
        };
    }

    return client.getConfigurationSetting(configurationSettingId, actualGetOptions);
}

export function createCorrelationContextHeader(requestTracingOptions: RequestTracingOptions): string {
    /*
    RequestType: 'Startup' during application starting up, 'Watch' after startup completed.
    Host: identify with defined envs
    Env: identify by env `NODE_ENV` which is a popular but not standard. Usually, the value can be "development", "production".
    ReplicaCount: identify how many replicas are found
    Features: LB
    Filter: CSTM+TIME+TRGT
    MaxVariants: identify the max number of variants feature flag uses
    FFFeatures: Seed+Telemetry
    UsersKeyVault
    Failover
    */
    const keyValues = new Map<string, string | undefined>();
    const tags: string[] = [];

    keyValues.set(REQUEST_TYPE_KEY, requestTracingOptions.initialLoadCompleted ? RequestType.WATCH : RequestType.STARTUP);
    keyValues.set(HOST_TYPE_KEY, getHostType());
    keyValues.set(ENV_KEY, isDevEnvironment() ? DEV_ENV_VAL : undefined);

    const appConfigOptions = requestTracingOptions.appConfigOptions;
    if (appConfigOptions?.keyVaultOptions) {
        const { credential, secretClients, secretResolver } = appConfigOptions.keyVaultOptions;
        if (credential !== undefined || secretClients?.length || secretResolver !== undefined) {
            tags.push(KEY_VAULT_CONFIGURED_TAG);
        }
    }

    const featureFlagTracing = requestTracingOptions.featureFlagTracing;
    if (featureFlagTracing) {
        keyValues.set(FEATURE_FILTER_TYPE_KEY, featureFlagTracing.usesAnyFeatureFilter() ? featureFlagTracing.createFeatureFiltersString() : undefined);
        keyValues.set(FF_FEATURES_KEY, featureFlagTracing.usesAnyTracingFeature() ? featureFlagTracing.createFeaturesString() : undefined);
        if (featureFlagTracing.maxVariants > 0) {
            keyValues.set(FF_MAX_VARIANTS_KEY, featureFlagTracing.maxVariants.toString());
        }
    }

    if (requestTracingOptions.isFailoverRequest) {
        tags.push(FAILOVER_REQUEST_TAG);
    }
    if (requestTracingOptions.replicaCount > 0) {
        keyValues.set(REPLICA_COUNT_KEY, requestTracingOptions.replicaCount.toString());
    }

    // Compact tags: Features=LB+...
    if (appConfigOptions?.loadBalancingEnabled) {
        keyValues.set(FEATURES_KEY, LOAD_BALANCE_CONFIGURED_TAG);
    }

    const contextParts: string[] = [];
    for (const [k, v] of keyValues) {
        if (v !== undefined) {
            contextParts.push(`${k}=${v}`);
        }
    }
    for (const tag of tags) {
        contextParts.push(tag);
    }

    return contextParts.join(",");
}

export function requestTracingEnabled(): boolean {
    const requestTracingDisabledEnv = getEnvironmentVariable(ENV_AZURE_APP_CONFIGURATION_TRACING_DISABLED);
    const disabled = requestTracingDisabledEnv?.toLowerCase() === "true";
    return !disabled;
}

function getEnvironmentVariable(name: string) {
    // Make it compatible with non-Node.js runtime
    if (typeof process !== "undefined" && typeof process?.env === "object") {
        return process.env[name];
    } else {
        return undefined;
    }
}

function getHostType(): string | undefined {
    let hostType: string | undefined;
    if (getEnvironmentVariable(AZURE_FUNCTION_ENV_VAR)) {
        hostType = HostType.AZURE_FUNCTION;
    } else if (getEnvironmentVariable(AZURE_WEB_APP_ENV_VAR)) {
        hostType = HostType.AZURE_WEB_APP;
    } else if (getEnvironmentVariable(CONTAINER_APP_ENV_VAR)) {
        hostType = HostType.CONTAINER_APP;
    } else if (getEnvironmentVariable(KUBERNETES_ENV_VAR)) {
        hostType = HostType.KUBERNETES;
    } else if (getEnvironmentVariable(SERVICE_FABRIC_ENV_VAR)) {
        hostType = HostType.SERVICE_FABRIC;
    } else if (isBrowser()) {
        hostType = HostType.BROWSER;
    } else if (isWebWorker()) {
        hostType = HostType.WEB_WORKER;
    }
    return hostType;
}

function isDevEnvironment(): boolean {
    const envType = getEnvironmentVariable(NODEJS_ENV_VAR);
    if (NODEJS_DEV_ENV_VAL === envType?.toLowerCase()) {
        return true;
    }
    return false;
}

export function isBrowser() {
    // https://developer.mozilla.org/en-US/docs/Web/API/Window
    const isWindowDefinedAsExpected = typeof window === "object" && typeof Window === "function" && window instanceof Window;
    // https://developer.mozilla.org/en-US/docs/Web/API/Document
    const isDocumentDefinedAsExpected = typeof document === "object" && typeof Document === "function" && document instanceof Document;

    return isWindowDefinedAsExpected && isDocumentDefinedAsExpected;
}

export function isWebWorker() {
    // https://developer.mozilla.org/en-US/docs/Web/API/WorkerGlobalScope
    const workerGlobalScopeDefined = typeof WorkerGlobalScope !== "undefined";
    // https://developer.mozilla.org/en-US/docs/Web/API/WorkerNavigator
    const isNavigatorDefinedAsExpected = typeof navigator === "object" && typeof WorkerNavigator === "function" && navigator instanceof WorkerNavigator;
    // https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers#importing_scripts_and_libraries
    const importScriptsAsGlobalFunction = typeof importScripts === "function";

    return workerGlobalScopeDefined && importScriptsAsGlobalFunction && isNavigatorDefinedAsExpected;
}

