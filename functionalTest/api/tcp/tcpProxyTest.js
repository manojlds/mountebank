'use strict';

var assert = require('assert'),
    Proxy = require('../../../src/models/tcp/tcpProxy'),
    api = require('../api'),
    promiseIt = require('../../testHelpers').promiseIt,
    port = api.port + 1,
    isWindows = require('os').platform().indexOf('win') === 0,
    net = require('net'),
    timeout = parseInt(process.env.SLOW_TEST_TIMEOUT_MS || 3000);

describe('tcp proxy', function () {
    if (isWindows) {
        // the DNS resolver errors take a lot longer on Windows
        this.timeout(10000);
    }
    else {
        this.timeout(timeout);
    }

    var noOp = function () {},
        logger = { debug: noOp, info: noOp, warn: noOp, error: noOp };

    describe('#to', function () {
        promiseIt('should send same request information to proxied socket', function () {
            var stub = { responses: [{ is: { data: 'howdy!' } }] },
                request = { protocol: 'tcp', port: port, stubs: [stub], name: this.name },
                proxy = Proxy.create(logger, 'utf8');

            return api.post('/imposters', request).then(function () {
                return proxy.to({ host: 'localhost', port: port }, { data: 'hello, world!' });
            }).then(function (response) {
                assert.deepEqual(response.data.toString(), 'howdy!');
            }).finally(function () {
                return api.del('/imposters');
            });
        });

        promiseIt('should proxy binary data', function () {
            var buffer = new Buffer([0, 1, 2, 3]),
                stub = { responses: [{ is: { data: buffer.toString('base64') } }] },
                request = { protocol: 'tcp', port: port, stubs: [stub], mode: 'binary', name: this.name },
                proxy = Proxy.create(logger, 'base64');

            return api.post('/imposters', request).then(function () {
                return proxy.to({ host: 'localhost', port: port }, { data: buffer });
            }).then(function (response) {
                assert.deepEqual(new Buffer(response.data, 'base64').toJSON(), [0, 1, 2, 3]);
            }).finally(function () {
                return api.del('/imposters');
            });
        });

        promiseIt('should wait for remote socket to end before returning', function () {
            var server = net.createServer(function (client) {
                client.on('data', function () {
                    // force multiple data packets
                    client.write((new Array(10*1024*1024)).join("x"));
                });
            });
            server.listen(port);

            var proxy = Proxy.create(logger, 'utf8');

            return proxy.to({ host: 'localhost', port: port }, { data: 'hello, world!' }).then(function (response) {
                assert.strictEqual(response.data.length, 10*1024*1024 - 1);
            }).finally(function () {
                server.close();
            });
        });

        promiseIt('should gracefully deal with DNS errors', function () {
            var proxy = Proxy.create(logger, 'utf8');

            return proxy.to({ host: 'no.such.domain', port: 80 }, { data: 'hello, world!' }).then(function () {
                assert.fail('should not have resolved promise');
            }, function (reason) {
                assert.deepEqual(reason, {
                    code: 'invalid proxy',
                    message: 'Cannot resolve {"host":"no.such.domain","port":80}'
                });
            });
        });

        promiseIt('should gracefully deal with non listening ports', function () {
            var proxy = Proxy.create(logger, 'utf8');

            return proxy.to({ host: 'localhost', port: 18000 }, { data: 'hello, world!' }).then(function () {
                assert.fail('should not have resolved promise');
            }, function (reason) {
                assert.deepEqual(reason, {
                    code: 'invalid proxy',
                    message: 'Unable to connect to {"host":"localhost","port":18000}'
                });
            });
        });
    });
});
