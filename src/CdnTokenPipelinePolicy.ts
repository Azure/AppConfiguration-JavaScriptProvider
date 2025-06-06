// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { PipelinePolicy } from "@azure/core-rest-pipeline";

export const CDN_TOKEN_LOOKUP_HEADER = "cdn-token-lookup";

/**
 * The pipeline policy that retrieves the CDN token from the request header and appends it to the request URL. After that the lookup header is removed from the request.
 * @remarks
 * The policy position should be perCall.
 * The App Configuration service will not recognize the CDN token query parameter in the url, but this can help to break the CDN cache as the cache entry is based on the URL.
 */
export class CdnTokenPipelinePolicy implements PipelinePolicy {
    name: string = "AppConfigurationCdnTokenPolicy";

    async sendRequest(request, next) {
        if (request.headers.has(CDN_TOKEN_LOOKUP_HEADER)) {
            const token = request.headers.get(CDN_TOKEN_LOOKUP_HEADER);
            request.headers.delete(CDN_TOKEN_LOOKUP_HEADER);

            const url = new URL(request.url);
            url.searchParams.append("_", token); // _ is a dummy query parameter to break the CDN cache
            request.url = url.toString();
        }

        return next(request);
    }
}
