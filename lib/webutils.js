/*
 *  Copyright 2017 Adobe Systems Incorporated. All rights reserved.
 *  This file is licensed to you under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License. You may obtain a copy
 *  of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software distributed under
 *  the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 *  OF ANY KIND, either express or implied. See the License for the specific language
 *  governing permissions and limitations under the License.
 */

'use strict';

var request = require('request');
var reqlog = require('./logging').getLogger('request');
var eventManager = require('./eventmanager');
var common = require('./common');

/**
 * Submits a request using the nodejs request module.
 * @param {object} options Options that will be passed directly to the request module.
 * @param {function} cb Will be invoked when the request is complete.
 * @param {Error|string} err Will be truthy if there was an error during the request.
 * @param {Response} resp Object containing response information.
 * @param {string} body The body portion of the response.
 *
 */
function submitRequest(options, cb) {
  options = options || {};
  var forceEvents = options.forceEvents;
  var ts = new Date().getTime();
  var method = options.method || 'GET';
  var url = options.url;
  var transferred = 0;
  var emitter = options.emitter;

  function emitEvent(event) {
    if (emitter) {
      if (emitter.emitShareEvent) {
        if (forceEvents || eventManager.shouldSendEvent(event, common.EVENT_TIMEOUT)) {
          eventManager.registerEventEmit(event);
          emitter.emitShareEvent(event);
        }
      } else {
        eventManager.emitEvent(emitter, event, null, common.EVENT_TIMEOUT);
      }
    }
  }

  function emitNetworkLoss() {
    var lastNetworkLoss = eventManager.getLastEventEmit('networkloss');
    var lastNetworkRestore = eventManager.getLastEventEmit('networkrestored');

    // determine if networkloss has already been sent. If it hasn't, or network restore was the more recent event,
    // send the loss event
    if (!lastNetworkLoss || lastNetworkRestore > lastNetworkLoss) {
      emitEvent('networkloss');
    }
  }

  function emitNetworkRestored() {
    // determine if networkloss event has been sent. if it has and networkrestored has NOT been sent, send event
    var lastNetworkLoss = eventManager.getLastEventEmit('networkloss');
    var lastNetworkRestore = eventManager.getLastEventEmit('networkrestored');
    if (lastNetworkLoss && lastNetworkRestore < lastNetworkLoss) {
      emitEvent('networkrestored');
    }
  }

  if (options.headers) {
    if (options.headers['X-Destination']) {
      url += ' > ' + options.headers['X-Destination'];
    }
  }
  var logger = reqlog;
  if (options.logger) {
    logger = options.logger;
  }

  var callback = cb;

  if (callback) {
    // wrap the provided callback so that we can report network-related issues
    callback = function (err, res, body) {
      if (err) {
        emitNetworkLoss();
      }
      cb(err, res, body);
    };
  }

  logger.info('[%d] -> %s %s', ts, method, url);
  return request(options, callback)
    .on('response', function (res) {
      if (res.statusCode > 500 && res.statusCode < 600) {
        // don't send network loss event for 500 status code
        emitNetworkLoss();
      } else {
        // "successful" response. send networkrestored event if needed
        emitNetworkRestored();
      }

      if (res.statusCode == 401) {
        // unauthorized, login token has most likely expired
        emitEvent('unauthorized');
      }
      res.on('data', function (chunk) {
        transferred += chunk.length;
      });

      res.on('end', function () {
        var end = new Date().getTime();
        var totalTime = (end - ts) || 1;
        var elapsed = totalTime;
        var time = 'ms';
        if (totalTime > 1000) {
          elapsed /= 1000;
          time = 's';
        }
        var rateText = '';

        if (transferred > 0) {
          var rate = Math.round(transferred / elapsed);
          var measure = 'b';
          if (rate >= 1024) {
            rate /= 1024; // kb
            measure = 'kb';
            if (rate >= 1024) {
              rate /= 1024; // mb
              measure = 'mb';
              if (rate >= 1024) {
                rate /= 1024; // gb
                measure = 'gb';
              }
            }
          }

          rateText = '[' + transferred + 'b][' + Math.round(rate * 10) / 10 + measure + '/' + time + ']';
        }

        logger.info('[%d] <- %d %s %s [%d to %d][%dms]%s', ts, res.statusCode, method, url, ts, end, totalTime, rateText);
      });
    })
    .on('error', function (err) {
      logger.error('[%d] <- ERR %s %s', ts, method, url, err);
      emitNetworkLoss();
    });
}

/**
 * Monitors the data transfer progress of a request.
 * @param {HTTPRequest} transfer The request to monitor.
 * @param {String} serverPath The value to use as the progress's server path value.
 * @param {String} fullPath The value to use as the progress's local path value.
 * @param {Number} totalSize The value to use as the progress's total value.
 * @param {Function} progressCallback Will be invoked whenever meaningful transfer progress has been made.
 * @param {Object} progressCallback.data Parameter of the progressCallback that contains progress information.
 * @param {String} progressCallback.data.path Server path of the file, as specified by a parameter.
 * @param {Number} progressCallback.data.read Total number of bytes that have transferred so far.
 * @param {Number} progressCallback.data.total Total number of bytes as specified by a parameter.
 * @param {Number} progressCallback.data.rate Rate, in bytes per second, that the file is transferring.
 * @param {Number} progressCallback.data.elapsed The amount of time, in milliseconds, that has passed since the request started.
 */
function monitorTransferProgress(transfer, serverPath, totalSize, progressCallback) {
  var totalRead = 0;
  var startTime = new Date().getTime();
  var lastCheck = startTime;
  var rate = 0;
  transfer.on('data', function (chunk) {
    totalRead += chunk.length;
    var currCheck = new Date().getTime();
    // determine byte rate per second
    var elapsed = (currCheck - startTime);
    if (elapsed > 0) {
      rate = Math.round(totalRead / (elapsed / 1000));
    }
    if ((currCheck - lastCheck) >= 1000) {
      lastCheck = currCheck;
      progressCallback({path: serverPath, read: totalRead, total: totalSize, rate: rate, elapsed: elapsed});
    }
  });
}

module.exports.submitRequest = submitRequest;
module.exports.monitorTransferProgress = monitorTransferProgress;
