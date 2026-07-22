// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { PipelinePolicy } from "@azure/core-rest-pipeline";

/**
 * The pipeline policy that remove the authorization header from the request to allow anonymous access to the Azure Front Door.
 * @remarks
 * The policy position should be perRetry, since it should be executed after the "Sign" phase: https://github.com/Azure/azure-sdk-for-js/blob/main/sdk/core/core-client/src/serviceClient.ts
 */
export class AnonymousRequestPipelinePolicy implements PipelinePolicy {
    name: string = "AppConfigurationAnonymousRequestPolicy";

    async sendRequest(request, next) {
        if (request.headers.has("authorization")) {
            request.headers.delete("authorization");
        }
        return next(request);
    }
}

/**
 * The pipeline policy that remove the "sync-token" header from the request.
 * The policy position should be perRetry. It should be executed after the SyncTokenPolicy in @azure/app-configuration, which is executed after retry phase: https://github.com/Azure/azure-sdk-for-js/blob/main/sdk/appconfiguration/app-configuration/src/appConfigurationClient.ts#L198
 */
export class RemoveSyncTokenPipelinePolicy implements PipelinePolicy {
    name: string = "AppConfigurationRemoveSyncTokenPolicy";

    async sendRequest(request, next) {
        if (request.headers.has("sync-token")) {
            request.headers.delete("sync-token");
        }
        return next(request);
    }
}
