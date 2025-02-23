// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

export class Disposable {
    #disposed = false;
    #callOnDispose: () => any;

    constructor(callOnDispose: () => any) {
        this.#callOnDispose = callOnDispose;
    }

    dispose() {
        if (!this.#disposed) {
            this.#callOnDispose();
        }
        this.#disposed = true;
    }
}
