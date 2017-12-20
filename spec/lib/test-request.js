/*
 *  Copyright 2016 Adobe Systems Incorporated. All rights reserved.
 *  This file is licensed to you under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License. You may obtain a copy
 *  of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software distributed under
 *  the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 *  OF ANY KIND, either express or implied. See the License for the specific language
 *  governing permissions and limitations under the License.
 */

var util = require('util');
var async = require('async');
var URL = require('url');

var TestStream = require('./test-stream');

var requestedUrls = {};
var urls;
var dataz;
var requestCb = function (url, method, headers, cb) {
  cb();
}

function TestRequest(options, reqCb) {
  TestStream.call(this, 'test-request');

  this.url = options.url;
  this.headers = options.headers || {};
  this.method = options.method || 'GET';
  this.aborted = false;
  this.statusCode = 501;
  this.resCb = false;
  this.reqCb = reqCb;
}

util.inherits(TestRequest, TestStream);

function setData(url, headers, data) {
  dataz[url] = {headers: headers, data: data};
};

TestRequest.prototype.setStatusCode = function (statusCode) {
  this.statusCode = statusCode;
};

TestRequest.prototype.setResponseCallback = function (callback) {
  var self = this;
  this.setReadStream(function (readCb) {
    callback(self.url, self.headers, function (err, statusCode, data) {
      readCb(err, data);
    });
  });
  this.resCb = callback;
};

TestRequest.prototype.end = function (data, encoding, cb) {
  var self = this;

  function _doEnd(err, statusCode, endData) {
    if (err) {
      self.emit('error', err);
      if (cb) {
        cb(err);
      }
      if (self.reqCb) {
        self.reqCb(err);
      }
    } else {
      if (!statusCode) {
        statusCode = self.statusCode;
      }
      var res = new TestResponse(statusCode);

      if (endData) {
        res.write(endData);
      }

      res.on('finish', function () {
        if (self.reqCb) {
          self.reqCb(null, res, res.getWritten());
        }
        self.emit('response', res);
        res.emit('end');
        self.emit('end');
        if (cb) {
          cb(null, res);
        }
      });

      res.end();
    }
  }

  function getTargetUrl(currUrl, targetUrl) {
    var currParsed = URL.parse(currUrl);
    var targetParsed = URL.parse(targetUrl);

    if (!targetParsed.host) {
      return currParsed.protocol + '//' + currParsed.host + targetUrl;
    } else {
      return targetUrl;
    }
  }

  if (!self.aborted) {
    TestStream.prototype.end.call(self, data, encoding, function (err) {
      if (!err) {
        var data = '';
        if (self.method == 'POST') {
          data = self.getWritten();
          setData(self.url, self.headers, data);
        } else if (self.method == 'PUT') {
          data = self.getWritten();
          setData(self.url, self.headers, data);
        } else if (self.method == 'DELETE') {
          delete dataz[self.url];
        } else if (self.method == 'MOVE') {
          var targetUrl = getTargetUrl(self.url, self.headers['X-Destination']);
          self.headers['X-Destination'] = targetUrl;
          dataz[targetUrl] = dataz[self.url];
          delete dataz[self.url];
          if (urls[self.url]) {
            urls[targetUrl] = urls[self.url];
            delete urls[self.url];
          }
        }
        var reqData = {data: data};
        if (self.resCb) {
          self.resCb(self.url, self.headers, function (err, statusCode, data) {
            requestCb(self.url, self.method, self.headers, reqData, function () {
              _doEnd(err, statusCode, data);
            });
          });
        } else {
          requestCb(self.url, self.method, self.headers, reqData, _doEnd);
        }
      }
    });
  }
};

TestRequest.prototype.abort = function () {
  this.aborted = true;
};

function TestResponse(statusCode) {
  TestStream.call(this);

  this.headers = {};
  this.statusCode = statusCode;
  this.statusMessage = '';
}

util.inherits(TestResponse, TestStream);

TestResponse.prototype.writeHead = function (statusCode, statusMessage, headers) {
  this.statusCode = statusCode;
  this.headers = headers || {};
  this.statusMessage = statusMessage || '';
};

function addRequestedUrl(url, method) {
  if (!requestedUrls[url]) {
    requestedUrls[url] = {};
  }
  if (!requestedUrls[url][method]) {
    requestedUrls[url][method] = 0;
  }
  requestedUrls[url][method]++;
}

function clearAll() {
  requestedUrls = {};
  urls = {};
  dataz = {};
};

function request(options, cb) {
  var method = options.method ? options.method : 'GET';
  addRequestedUrl(options.url, method);

  var req;
  if (method != 'GET' && method != 'HEAD' && method != 'DELETE' && method != 'MOVE') {
    req = new TestRequest(options, cb);
  } else {
    req = new TestRequest(options);
  }
  req.on('error', function (err) {
    // caught error event to avoid crash
  });

  if (urls[options.url]) {
    req.setResponseCallback(urls[options.url]);
  } else if (dataz[options.url] && (method != 'POST') && method != 'MOVE') {
    if (method == 'GET') {
      req.setResponseCallback(function (url, headers, resCb) {
        resCb(null, 200, dataz[options.url].data);
      });
    } else {
      req.setStatusCode(200);
    }
  } else if (method == 'POST' || method == 'MOVE') {
    req.setStatusCode(201);
  } else {
    req.setStatusCode(404);
  }

  if ((method == 'GET' || method == 'HEAD' || method == 'DELETE' || method == 'MOVE') && cb) {
    req.end(null, null, function (err, res) {
      if (err) {
        cb(err);
      } else {
        cb(null, res, res.getWritten());
      }
    });
  }

  return req;
};

function registerUrl(url, callback) {
  urls[url] = callback;
}

function unregisterUrl(url) {
  delete urls[url];
}

function setUrlData(url, data) {
  dataz[url].data = data;
}

function setRequestCallback(callback) {
  requestCb = callback;
}

function registerUrlStatusCode(url, statusCode) {
  this.registerUrl(url, function (url, headers, callback) {
    callback(null, statusCode, '');
  });
}

function getUrlMethodRequestCount(url, method) {
  if (requestedUrls[url]) {
    if (requestedUrls[url][method]) {
      return requestedUrls[url][method];
    }
  }
  return 0;
}

function wasUrlRequested(url) {
  return (getUrlMethodRequestCount(url, 'GET') >= 0);
}

function printRegisteredUrls() {
  console.log('urls', urls);
  console.log('datas', dataz);
}

function printRequestedUrls() {
  console.log('requested urls', requestedUrls);
}

module.exports.request = request;
module.exports.clearAll = clearAll;
module.exports.registerUrl = registerUrl;
module.exports.unregisterUrl = unregisterUrl;
module.exports.setUrlData = setUrlData;
module.exports.setRequestCallback = setRequestCallback;
module.exports.registerUrlStatusCode = registerUrlStatusCode;
module.exports.wasUrlRequested = wasUrlRequested;
module.exports.getUrlMethodRequestCount = getUrlMethodRequestCount;
module.exports.printRegisteredUrls = printRegisteredUrls;
module.exports.printRequestedUrls = printRequestedUrls;
module.exports.TestRequest = TestRequest;
module.exports.TestResponse = TestResponse;
