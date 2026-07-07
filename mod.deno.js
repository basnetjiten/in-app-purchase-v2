import * as apple from './lib/apple.deno.js';
import * as googleApi from './lib/googleAPI.deno.js';
import * as constants from './constants.deno.js';
import * as verbose from './lib/verbose.deno.js';

export var APPLE = constants.SERVICES.APPLE;
export var GOOGLE = constants.SERVICES.GOOGLE;
export var VALIDATION = constants.VALIDATION;

function getService(receipt) {
    if (!receipt) {
        throw new Error('Receipt was null or undefined');
    }
    if (typeof receipt === 'object') {
        if (receipt.signature || receipt.purchaseToken) {
            return GOOGLE;
        }
    }
    return APPLE;
}

export function config(configIn) {
    if (!configIn) {
        return;
    }
    verbose.setup(configIn);
    if (configIn.googleServiceAccount) {
        googleApi.config(configIn.googleServiceAccount);
    }
    apple.readConfig(configIn);
}

export function setup() {
    return new Promise(function (resolve, reject) {
        apple.setup(function (error) {
            if (error) return reject(error);
            resolve();
        });
    });
}

export function validate(service, receipt) {
    if (receipt === undefined) {
        receipt = service;
        service = getService(receipt);
    }
    return new Promise(function (resolve, reject) {
        switch (service) {
            case APPLE:
                apple.validatePurchase(null, receipt, function (error, data) {
                    if (error) return reject(error);
                    resolve(data);
                });
                break;
            case GOOGLE:
                googleApi.validatePurchase(null, receipt, function (error, data) {
                    if (error) return reject(error);
                    resolve(data);
                });
                break;
            default:
                reject(new Error('Invalid service: ' + service));
        }
    });
}

export function validateOnce(service, secretOrPubKey, receipt) {
    if (receipt === undefined) {
        receipt = secretOrPubKey;
        secretOrPubKey = service;
        service = getService(receipt);
    }
    return new Promise(function (resolve, reject) {
        switch (service) {
            case APPLE:
                apple.validatePurchase(secretOrPubKey, receipt, function (error, data) {
                    if (error) return reject(error);
                    resolve(data);
                });
                break;
            case GOOGLE:
                googleApi.validatePurchase(secretOrPubKey, receipt, function (error, data) {
                    if (error) return reject(error);
                    resolve(data);
                });
                break;
            default:
                reject(new Error('Invalid service: ' + service));
        }
    });
}

export function isValidated(response) {
    if (response && response.status === constants.VALIDATION.SUCCESS) {
        return true;
    }
    return false;
}

export function isExpired(purchasedItem) {
    if (!purchasedItem || !purchasedItem.transactionId) {
        throw new Error('Invalid purchased item given:\n' + JSON.stringify(purchasedItem));
    }
    if (purchasedItem.cancellationDate) {
        return true;
    }
    if (!purchasedItem.expirationDate) {
        return false;
    }
    if (Date.now() - purchasedItem.expirationDate >= 0) {
        return true;
    }
    return false;
}

export function isCanceled(purchasedItem) {
    if (!purchasedItem || !purchasedItem.transactionId) {
        throw new Error('Invalid purchased item given:\n' + JSON.stringify(purchasedItem));
    }
    if (purchasedItem.cancellationDate) {
        return true;
    }
    return false;
}

export function getPurchaseData(purchaseData, options) {
    if (!purchaseData || !purchaseData.service) {
        return null;
    }
    switch (purchaseData.service) {
        case APPLE:
            return apple.getPurchaseData(purchaseData, options);
        case GOOGLE:
            return googleApi.getPurchaseData(purchaseData, options);
        default:
            return null;
    }
}

var iap = {
    config: config,
    setup: setup,
    validate: validate,
    validateOnce: validateOnce,
    isValidated: isValidated,
    isExpired: isExpired,
    isCanceled: isCanceled,
    getPurchaseData: getPurchaseData,
    APPLE: APPLE,
    GOOGLE: GOOGLE,
    VALIDATION: VALIDATION
};

export default iap;
