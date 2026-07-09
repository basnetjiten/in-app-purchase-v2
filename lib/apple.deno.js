import async from './async.deno.js';
import * as verbose from './verbose.deno.js';
import * as constants from '../constants.deno.js';
import * as responseData from './responseData.deno.js';

var errorMap = {
    21000: 'The App Store could not read the JSON object you provided.',
    21002: 'The data in the receipt-data property was malformed.',
    21003: 'The receipt could not be authenticated.',
    21004: 'The shared secret you provided does not match the shared secret on file for your account.',
    21005: 'The receipt server is not currently available.',
    21006: 'This receipt is valid but the subscription has expired. When this status code is returned to your server, the receipt data is also decoded and returned as part of the response.',
    21007: 'This receipt is a sandbox receipt, but it was sent to the production service for verification.',
    21008: 'This receipt is a production receipt, but it was sent to the sandbox service for verification.',
    2: 'The receipt is valid, but purchased nothing.'
};
var REC_KEYS = {
    IN_APP: 'in_app',
    LRI: 'latest_receipt_info',
    BUNDLE_ID: 'bundle_id',
    BID: 'bid',
    TRANSACTION_ID: 'transaction_id',
    ORIGINAL_TRANSACTION_ID: 'original_transaction_id',
    PRODUCT_ID: 'product_id',
    ITEM_ID: 'item_id',
    ORIGINAL_PURCHASE_DATE_MS: 'original_purchase_date_ms',
    EXPIRES_DATE_MS: 'expires_date_ms',
    EXPIRES_DATE: 'expires_date',
    EXPIRATION_DATE: 'expiration_date',
    EXPIRATION_INTENT: 'expiration_intent',
    CANCELLATION_DATE: 'cancellation_date',
    PURCHASE_DATE_MS: 'purchase_date_ms',
    IS_TRIAL: 'is_trial_period'
};
var config = null;
var sandboxHost = 'sandbox.itunes.apple.com';
var liveHost = 'buy.itunes.apple.com';
var path = '/verifyReceipt';
var testMode = false;

export { readConfig, setup, validatePurchase, getPurchaseData };

function isExpired(responseData) {
    if (responseData[REC_KEYS.LRI] && responseData[REC_KEYS.LRI][REC_KEYS.EXPIRES_DATE]) {
        var exp = parseInt(responseData[REC_KEYS.LRI][REC_KEYS.EXPIRES_DATE]);
        if (exp > Date.now()) {
            return true;
        }
        return false;
    }
}

function isValidConfigKey(key) {
    return key.match(/^apple/);
}

function readConfig(configIn) {
    if (!configIn) {
        return;
    }
    verbose.setup(configIn);
    testMode = configIn.test || false;
    verbose.log('<Apple> test mode?', testMode);
    config = {};
    var configValueSet = false;
    Object.keys(configIn).forEach(function (key) {
        if (isValidConfigKey(key)) {
            config[key] = configIn[key];
            configValueSet = true;
        }
    });
    if (!configValueSet) {
        config = null;
    }
}

function setup(cb) {
    if (!config || !config.applePassword) {
        if (typeof Deno !== 'undefined' && Deno.env && Deno.env.get('APPLE_IAP_PASSWORD')) {
            config = config || {};
            config.applePassword = Deno.env.get('APPLE_IAP_PASSWORD');
        }
    }
    return cb();
}

function validatePurchase(secret, receipt, cb) {
    var prodPath = 'https://' + liveHost + path;
    var sandboxPath = 'https://' + sandboxHost + path;
    var status;
    var validatedData;
    var isValid = false;
    var content = { 'receipt-data': receipt };
    if (config && config.applePassword) {
        content.password = config.applePassword;
    }
    if (config && config.appleExcludeOldTransactions) {
        content['exclude-old-transactions'] = config.appleExcludeOldTransactions;
    }
    if (secret) {
        verbose.log('<Apple> Using dynamic applePassword:', secret);
        content.password = secret;
    }
    verbose.log('<Apple> Validatation data:', content);

    var tryProd = function (next) {
        if (testMode) {
            verbose.log('<Apple> test mode: skip production validation');
            return next();
        }
        verbose.log('<Apple> Try validate against production:', prodPath);
        send(prodPath, content, function (error, res, data) {
            verbose.log('<Apple>', prodPath, 'validation response:', data);
            if (error) {
                status = data ? data.status : 1;
                validatedData = {
                    sandbox: false,
                    status: status,
                    message: errorMap[status] || 'Unknown'
                };
                applyResponseData(validatedData, data);
                verbose.log('<Apple>', prodPath, 'failed:', error, validatedData);
                error.validatedData = validatedData;
                return next(error);
            }
            if (data.status > 0 && data.status !== 21007 && data.status !== 21002) {
                if (data.status === 21006 && !isExpired(data)) {
                    validatedData = data;
                    validatedData.sandbox = false;
                    validatedData.status = 0;
                    verbose.log('<Apple> Valid receipt, but has been cancelled (not expired yet)');
                    isValid = true;
                    return next();
                }
                verbose.log('<Apple>', prodPath, 'failed:', data);
                status = data.status;
                var emsg = errorMap[status] || 'Unknown';
                var err = new Error(emsg);
                validatedData = {
                    sandbox: false,
                    status: status,
                    message: emsg
                };
                applyResponseData(validatedData, data);
                verbose.log('<Apple>', prodPath, 'failed:', validatedData);
                err.validatedData = validatedData;
                return next(err);
            }
            if (data.status === 21007 || data.status === 21002) {
                return next();
            }
            validatedData = data;
            validatedData.sandbox = false;
            verbose.log('<Apple> Production validation successful:', validatedData);
            isValid = true;
            next();
        });
    };

    var trySandbox = function (next) {
        if (isValid) {
            return next();
        }
        verbose.log('<Apple> Try validate against sandbox:', sandboxPath);
        send(sandboxPath, content, function (error, res, data) {
            verbose.log('<Apple>', sandboxPath, 'validation response:', data);
            if (error) {
                status = data ? data.status : 1;
                validatedData = {
                    sandbox: true,
                    status: status,
                    message: errorMap[status] || 'Unknown'
                };
                applyResponseData(validatedData, data);
                verbose.log('<Apple>', sandboxPath, 'failed:', error, validatedData);
                error.validatedData = validatedData;
                return next(error);
            }
            if (data.status > 0) {
                if (data.status === 21006 && !isExpired(data)) {
                    validatedData = data;
                    validatedData.sandbox = true;
                    validatedData.status = 0;
                    verbose.log('<Apple> Valid receipt, but has been cancelled (not expired yet)');
                    isValid = true;
                    return next();
                }
                verbose.log('<Apple>', sandboxPath, 'failed:', data);
                status = data.status;
                var emsg = errorMap[status] || 'Unknown';
                var err = new Error(emsg);
                validatedData = {
                    sandbox: true,
                    status: status,
                    message: emsg
                };
                applyResponseData(validatedData, data);
                verbose.log('<Apple>', sandboxPath, 'failed:', validatedData);
                err.validatedData = validatedData;
                return next(err);
            }
            validatedData = data;
            validatedData.sandbox = true;
            verbose.log('<Apple> Sandbox validation successful:', validatedData);
            next();
        });
    };

    var done = function (error) {
        if (error) {
            return cb(error, validatedData);
        }
        handleResponse(receipt, validatedData, cb);
    };

    var tasks = [
        tryProd,
        trySandbox
    ];
    async.series(tasks, done);
}

function getPurchaseData(purchase, options) {
    if (!purchase || !purchase.receipt) {
        return null;
    }
    var data = [];
    if (purchase.receipt[REC_KEYS.IN_APP]) {
        var now = Date.now();
        var tids = [];
        var list = purchase.receipt[REC_KEYS.IN_APP];
        var lri = purchase[REC_KEYS.LRI] || purchase.receipt[REC_KEYS.LRI];
        if (lri && Array.isArray(lri)) {
            list = list.concat(lri);
        }
        list.sort(function (a, b) {
            return parseInt(b[REC_KEYS.PURCHASE_DATE_MS], 10) - parseInt(a[REC_KEYS.PURCHASE_DATE_MS], 10);
        });
        for (var i = 0, len = list.length; i < len; i++) {
            var item = list[i];
            var tid = item['original_' + REC_KEYS.TRANSACTION_ID];
            var exp = getSubscriptionExpireDate(item);
            if (
                options &&
                options.ignoreCanceled &&
                item[REC_KEYS.CANCELLATION_DATE] &&
                item[REC_KEYS.CANCELLATION_DATE].length &&
                (!exp || now - exp >= 0)
            ) {
                continue;
            }
            if (options && options.ignoreExpired && exp && now - exp >= 0) {
                continue;
            }
            if (tids.indexOf(tid) > -1) {
                continue;
            }
            tids.push(tid);
            var parsed = responseData.parse(item);
            parsed.transactionId = parsed.transactionId.toString();
            if (parsed.originalTransactionId && !isNaN(parsed.originalTransactionId)) {
                parsed.originalTransactionId = parsed.originalTransactionId.toString();
            }
            if (parsed.isTrialPeriod !== undefined) {
                parsed.isTrial = bool(parsed.isTrialPeriod);
            } else {
                parsed.isTrial = false;
            }
            parsed.bundleId = purchase.receipt[REC_KEYS.BUNDLE_ID] || purchase.receipt[REC_KEYS.BID];
            parsed.expirationDate = exp;
            data.push(parsed);
        }
        return data;
    }
    var receipt = purchase[REC_KEYS.LRI] || purchase.receipt;
    data.push({
        bundleId: receipt[REC_KEYS.BUNDLE_ID] || receipt[REC_KEYS.BID],
        appItemId: receipt[REC_KEYS.ITEM_ID],
        originalTransactionId:    receipt[REC_KEYS.ORIGINAL_TRANSACTION_ID],
        transactionId:    receipt[REC_KEYS.TRANSACTION_ID],
        productId: receipt[REC_KEYS.PRODUCT_ID],
        originalPurchaseDate: receipt[REC_KEYS.ORIGINAL_PURCHASE_DATE_MS],
        purchaseDate: receipt[REC_KEYS.PURCHASE_DATE_MS],
        quantity: parseInt(receipt.quantity, 10),
        expirationDate: getSubscriptionExpireDate(receipt),
        isTrial: bool(receipt[REC_KEYS.IS_TRIAL]),
        cancellationDate: receipt[REC_KEYS.CANCELLATION_DATE] || 0
    });
    return data;
}

function bool(val) {
    return val === 'true' ? true : false;
}

function getSubscriptionExpireDate(data) {
    if (!data) {
        return 0;
    }
    if (data[REC_KEYS.EXPIRES_DATE_MS]) {
        return parseInt(data[REC_KEYS.EXPIRES_DATE_MS], 10);
    }
    if (data[REC_KEYS.EXPIRES_DATE]) {
        return data[REC_KEYS.EXPIRES_DATE];
    }
    if (data[REC_KEYS.EXPIRATION_DATE]) {
        return data[REC_KEYS.EXPIRATION_DATE];
    }
    if (data[REC_KEYS.EXPIRATION_INTENT]) {
        return parseInt(data[REC_KEYS.EXPIRATION_INTENT], 10);
    }
    return 0;
}

function handleResponse(receipt, data, cb) {
    data.service = constants.SERVICES.APPLE;
    if (data.status === constants.VALIDATION.SUCCESS) {
        if (data.receipt[REC_KEYS.IN_APP] && !data.receipt[REC_KEYS.IN_APP].length) {
            data.status = constants.VALIDATION.POSSIBLE_HACK;
            data.message = errorMap[data.status];
            verbose.log(
                '<Apple>',
                'Empty purchased detected: in_app array is empty:',
                'consider invalid and does not validate',
                data
            );
            return cb(new Error('failed to validate for empty purchased list'), data);
        }
        return cb(null, data);
    } else {
        data.message = errorMap[data.status] || 'Unknown';
     }
     cb(new Error(data.message), data);
}

function send(url, content, cb) {
    fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(content)
    })
    .then(function (res) {
        return res.text().then(function (text) {
            var body;
            try {
                body = JSON.parse(text);
            } catch (e) {
                body = text;
            }
            var response = { statusCode: res.status, status: res.status };
            cb(null, response, body);
        });
    })
    .catch(function (error) {
        cb(error);
    });
}

function applyResponseData(target, source) {
    for (var key in source) {
        if (target[key] === undefined) {
            target[key] = source[key];
        }
    }
}
