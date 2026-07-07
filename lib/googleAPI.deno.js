import * as constants from '../constants.deno.js';
import * as verbose from './verbose.deno.js';

var NAME = 'GOOGLE API';
var GET_TOKEN = 'https://accounts.google.com/o/oauth2/token';
var SCOPE = 'https://www.googleapis.com/auth/androidpublisher';
var PRODUCT_DETAIL = 'https://www.googleapis.com/androidpublisher/v3/applications/%s/purchases/products/%s/tokens/%s';
var SUBSCR_DETAIL = 'https://www.googleapis.com/androidpublisher/v3/applications/%s/purchases/subscriptionsv2/tokens/%s';

var conf = {
    clientEmail: null,
    privateKey: null
};

export { config, validatePurchase };

function config(_conf) {
    if (!_conf.clientEmail) {
        throw new Error('Google API requires client email');
    }
    if (!_conf.privateKey) {
        throw new Error('Google API requires private key');
    }
    conf.clientEmail = _conf.clientEmail;
    conf.privateKey = _conf.privateKey;
}

function validatePurchase(_googleServiceAccount, receipt, cb) {
    verbose.log(NAME, 'Validate this', receipt);
    if (!receipt.packageName) {
        return cb(new Error('Missing Package Name'), {
            status: constants.VALIDATION.FAILURE,
            message: 'Missing Package Name',
            data: receipt
        });
    } else if (!receipt.productId) {
        return cb(new Error('Missing Product ID'), {
            status: constants.VALIDATION.FAILURE,
            message: 'Missing Product ID',
            data: receipt
        });
    } else if (!receipt.purchaseToken) {
        return cb(new Error('Missing Purchase Token'), {
            status: constants.VALIDATION.FAILURE,
            message: 'Missing Purchase Token',
            data: receipt
        });
    }
    var googleServiceAccount = conf;
    if (_googleServiceAccount && _googleServiceAccount.clientEmail && _googleServiceAccount.privateKey) {
        verbose.log(NAME, 'Using one time key data:', _googleServiceAccount);
        googleServiceAccount = _googleServiceAccount;
    }
    _getToken(googleServiceAccount.clientEmail, googleServiceAccount.privateKey, function (error, data) {
        if (error) {
            return cb(error, {
                status: constants.VALIDATION.FAILURE,
                message: error.message
            });
        }
        var url = _getValidationUrl(receipt);
        verbose.log(NAME, 'Validation URL:', url);
        fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': data.token_type + ' ' + data.access_token
            }
        })
        .then(function (res) {
            return res.json().then(function (body) {
                return { statusCode: res.status, body: body };
            });
        })
        .then(function (result) {
            if (result.statusCode === 410) {
                verbose.log(NAME, 'Receipt is no longer valid');
                return cb(new Error('ReceiptNoLongerValid'), {
                    status: constants.VALIDATION.FAILURE,
                    message: result.body
                });
            }
            if (result.statusCode > 399) {
                verbose.log(NAME, 'Validation failed:', result.statusCode, result.body);
                var msg;
                try {
                    msg = JSON.stringify(result.body, null, 2);
                } catch (e) {
                    msg = result.body;
                }
                return cb(new Error('Status:' + result.statusCode + ' - ' + msg), {
                    status: constants.VALIDATION.FAILURE,
                    message: result.body,
                    data: receipt
                });
            }
            var resp = {
                service: constants.SERVICES.GOOGLE,
                status: constants.VALIDATION.SUCCESS,
                packageName: receipt.packageName,
                productId: receipt.productId,
                purchaseToken: receipt.purchaseToken
            };
            for (var name in result.body) {
                resp[name] = result.body[name];
            }
            cb(null, resp);
        })
        .catch(function (error) {
            cb(error, { status: constants.VALIDATION.FAILURE, message: error.message });
        });
    });
}

function _getToken(clientEmail, privateKey, cb) {
    var now = Math.floor(Date.now() / 1000);
    var payload = {
        iss: clientEmail,
        scope: SCOPE,
        aud: GET_TOKEN,
        exp: now + 3600,
        iat: now
    };
    _makeJWT(payload, privateKey)
        .then(function (jwt) {
            fetch(GET_TOKEN, {
                method: 'POST',
                headers: { 'content-type': 'application/x-www-form-urlencoded' },
                body: 'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' + jwt
            })
            .then(function (res) {
                return res.json().then(function (body) {
                    return { status: res.status, body: body };
                });
            })
            .then(function (result) {
                if (result.status > 399) {
                    return cb(new Error('Failed to get token: ' + JSON.stringify(result.body)));
                }
                cb(null, result.body);
            })
            .catch(function (error) {
                cb(error);
            });
        })
        .catch(function (error) {
            cb(error);
        });
}

function _getValidationUrl(receipt) {
    if (receipt.subscription) {
        return SUBSCR_DETAIL
            .replace('%s', encodeURIComponent(receipt.packageName))
            .replace('%s', encodeURIComponent(receipt.purchaseToken));
    }
    return PRODUCT_DETAIL
        .replace('%s', encodeURIComponent(receipt.packageName))
        .replace('%s', encodeURIComponent(receipt.productId))
        .replace('%s', encodeURIComponent(receipt.purchaseToken));
}

function _pemToArrayBuffer(pem) {
    var b64 = pem
        .replace(/-----BEGIN.*?-----/g, '')
        .replace(/-----END.*?-----/g, '')
        .replace(/\s/g, '');
    var binaryString = atob(b64);
    var bytes = new Uint8Array(binaryString.length);
    for (var i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
}

function _base64url(buf) {
    var binary = '';
    var bytes = new Uint8Array(buf);
    for (var i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary)
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
}

function _makeJWT(payload, privateKeyPem) {
    var header = { alg: 'RS256', typ: 'JWT' };
    var encoder = new TextEncoder();
    var headerB64 = _base64url(encoder.encode(JSON.stringify(header)));
    var payloadB64 = _base64url(encoder.encode(JSON.stringify(payload)));
    var signingInput = headerB64 + '.' + payloadB64;
    var keyData = _pemToArrayBuffer(privateKeyPem);
    return crypto.subtle.importKey(
        'pkcs8',
        keyData,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['sign']
    )
    .then(function (key) {
        return crypto.subtle.sign(
            { name: 'RSASSA-PKCS1-v1_5' },
            key,
            encoder.encode(signingInput)
        );
    })
    .then(function (signature) {
        return signingInput + '.' + _base64url(signature);
    });
}
