var enabled = false;

export function setup(config) {
    enabled = (config && config.verbose === true) ? true : false;
}

export function log() {
    if (!enabled) {
        return;
    }
    var logs = [];
    logs.push('[' + Date.now() + '][VERBOSE]');
    for (var i in arguments) {
        logs.push(arguments[i]);
    }
    console.log.apply(console, logs);
}
