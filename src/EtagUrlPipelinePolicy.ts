// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { PipelinePolicy } from "@azure/core-rest-pipeline";

export const ETAG_LOOKUP_HEADER = "Etag-Lookup";

/**
 * The pipeline policy that retrieves the etag from the request header and appends it to the request URL. After that the etag header is removed from the request.
 * @remarks
 * The policy position should be perCall.
 * The App Configuration service will not recognize the etag query parameter in the url, but this can help to break the CDN cache as the cache entry is based on the URL.
 */
export class EtagUrlPipelinePolicy implements PipelinePolicy {
    name: string = "AppConfigurationEtagUrlPolicy";

    async sendRequest(request, next) {
        if (request.headers.has(ETAG_LOOKUP_HEADER)) {
            const etag = request.headers.get(ETAG_LOOKUP_HEADER);
            request.headers.delete(ETAG_LOOKUP_HEADER);

            const url = new URL(request.url);
            url.searchParams.append("etag", etag);
            request.url = url.toString();
        }

        return next(request);
    }
}
