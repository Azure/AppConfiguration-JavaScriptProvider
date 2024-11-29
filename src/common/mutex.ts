// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

export class ExclusiveExecutor {
    isExecuting = false;

    /**
     * Execute the given function exclusively. If there is any previous execution in progress, the new execution will be aborted.
     */
    async execute(fn) {
        if (this.isExecuting) {
            return; // do nothing
        }
        this.isExecuting = true;
        try {
            await fn();
        } finally {
            this.isExecuting = false;
        }
    }
}
