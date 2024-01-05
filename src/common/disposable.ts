// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

export class Disposable {
    private disposed = false;
    constructor(private callOnDispose: () => any) { }

    dispose() {
        if (!this.disposed) {
            this.callOnDispose();
        }
        this.disposed = true;
    }

}