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

'use strict';

var EventEmitter = require('events').EventEmitter;
var util = require('util');
var logger = require('../../logging').getLogger('spi');
var utils = require('../../utils');
var webutils = require('../../webutils');
var fs = require('fs');
var Path = require('path');
var async = require('async');

var SMBContext = require('../../smbcontext');

function RQProcessor(tree, options) {
  // call the super constructor to initialize `this`
  EventEmitter.call(this);

  var self = this;

  options = options || {};

  this.rq = tree.rq;
  this.tree = tree;
  this.share = tree.share;
  this.stopped = true;
  this.activeRequests = {};
  this.options = options;

  this.rq.on('itemupdated', function (data) {
    var itemPath = data.path;
    var itemContext = data.context;
    var logger = itemContext.spi();
    logger.debug('processor received itemupdated event for %s', itemPath);
    if (self.abortUpload(itemPath)) {
      logger.info('%s was updated mid-upload. canceling upload.', itemPath);

      self.sync(self.currConfig, self.currCb);
    }
  });

  this.rq.on('pathupdated', function (data) {
    var path = data.path;
    var itemContext = data.context;
    var logger = itemContext.spi();
    logger.debug('processor received pathupdated event for %s', path);

    var prefix = path;
    if (prefix != '/') {
      prefix += '/';
    }
    for (var property in self.activeRequests) {
      if (property.length > prefix.length) {
        if (property.substr(0, prefix.length) == prefix) {
          if (self.abortUpload(property)) {
            logger.info('%s path was changed mid-upload. canceling upload.', path);

            self.sync(self.currConfig, self.currCb);
          }
        }
      }
    }
  });
}

util.inherits(RQProcessor, EventEmitter);

/**
 * Normalizes a unicode string in order to avoid issues related to different code points.
 * @param {String} str The value to be normalized.
 * @returns {String} A normalized string value.
 */
RQProcessor.prototype.unicodeNormalize = function (str) {
  if (!this.options.noUnicodeNormalize) {
    return utils.unicodeNormalize(str);
  } else {
    return str;
  }
};

function _emitContextEvent(eventName, eventData, context) {
  this.emit(eventName, {data: eventData, context: context});
};

/**
 * Looks at the current in-progress requests and aborts the request for a given path if it's found to be
 * in-progress.
 * @param {String} itemPath The path to the item to abort.
 * @return {Boolean} Indicates whether a request was aborted or not.
 */
RQProcessor.prototype.abortUpload = function (itemPath) {
  // TODO: would be good to wrap activeRequests in some kind of mutex to prevent threading issues
  var self = this;
  if (self.activeRequests[itemPath]) {
    var file = self.activeRequests[itemPath].file;
    self.activeRequests[itemPath].req.abort();
    self.activeRequests[itemPath] = undefined;
    self.emit('syncabort', {path: itemPath, file: file});
    return true;
  }
  return false;
};

function _checkExists(tree, method, path, cb) {
  var exists = false;

  if (method == 'POST' || method == 'PUT' || method == 'DELETE') {
    this.share.resourceExists(tree, path, cb);
  } else {
    cb(null, exists);
  }
}

function _processItemMethod (tree, parentPath, name, remotePrefix, localPrefix, method, processCb) {
  var self = this;
  var context = tree.getContext();
  var logger = context.spi();
  var serverPath = Path.join(parentPath, name);

  var remotePrefix = remotePrefix;
  if (remotePrefix.charAt(remotePrefix.length - 1) == '/') {
    remotePrefix = remotePrefix.substr(0, remotePrefix.length - 1);
  }
  var url = remotePrefix + encodeURI(utils.normalizeSMBFileName(serverPath));
  var localPath = self.unicodeNormalize(Path.join(localPrefix, serverPath));

  var removeActiveUpload = function () {
    // remove active request from queue when finished
    logger.debug('removing path %s from list of active uploads', serverPath);
    delete self.activeRequests[serverPath];
  };
  var handleError = function (localPath, method, err, immediateFail) {
    logger.info('encountered handled error while attempting to process local file %s', localPath, err);
    _emitContextEvent.call(self, 'syncerr', {path: serverPath, file: localPath, method: method, err: err}, context);
    removeActiveUpload();
    processCb({err: err, immediateFail: immediateFail});
  };
  var endSync = function () {
    logger.info('finished sync of file %s', serverPath);
    _emitContextEvent.call(self, 'syncend', {path: serverPath, file: localPath, method: method}, context);
    processCb();
  };
  var completeRequest = function () {
    removeActiveUpload();
    self.tree.share.invalidateContentCache(tree, self.unicodeNormalize(parentPath), true);
    if (method != 'DELETE') {
      tree.refreshWorkFiles(self.unicodeNormalize(serverPath), function (err) {
        if (err) {
          logger.error('unable to delete work files for local file %s', localPath, err);
        }
        endSync();
      });
    } else {
      // no need to refresh work files for deleted items
      endSync();
    }
  };

  logger.info('beginning sync of file %s', serverPath);
  _emitContextEvent.call(self, 'syncstart', {path: serverPath, file: localPath, method: method}, context);

  if (url.match(/\/\./g)) {
    logger.warn('%s: attempt to sync path containing names beginning with a period', serverPath);
    handleError(localPath, method, 'files containing names beginning with a period are forbidden', true);
  } else {
    var options = self.share.applyRequestDefaults(tree, {
      url: url,
      method: method,
      headers: {}
    });

    var getRequest = function () {
      return webutils.submitRequest(options, function (err, resp) {
        if (err) {
          // failed
          handleError(localPath, method, err);
        } else if (resp.statusCode == 423) {
          logger.debug('path [%s] name [%s] received locked status, indicating file is checked out', serverPath, name);
          handleError(localPath, method, 'Asset is checked out by another user', true);
        } else if (resp.statusCode != 200 && resp.statusCode != 201) {
          logger.debug('received response with invalid status code %d', resp.statusCode);
          handleError(localPath, method, 'unexpected status code: ' + resp.statusCode);
        } else {
          logger.debug('path [%s] name [%s] request completed', serverPath, name);
          completeRequest();
        }
      })
    };

    _checkExists.call(self, tree, method, serverPath, function (err, exists) {
      if (err) {
        handleError(localPath, method, err);
      } else {
        // handle cases where the queued method has become out of sync with what is in the remote
        if (!exists && method == 'PUT') {
          // path doesn't exist and we're trying to update it. switch to create instead
          method = 'POST';
        } else if (exists && method == 'POST') {
          // path already exists and we're trying to create it. switch to update instead
          method = 'PUT';
        } else if (!exists && method == 'DELETE') {
          // trying to delete a path that doesn't exist. ignore request
          completeRequest();
          return;
        }
        options.method = method;
        if (method == 'POST' || method == 'PUT') {
          options.headers['content-type'] = utils.lookupMimeType(serverPath);
          var read, stats;
          fs.stat(localPath, function (err, stats) {
            if (err) {
              handleError(localPath, method, err);
            } else {
              read = fs.createReadStream(localPath);
              read.on('error', function (err) {
                handleError(localPath, method, err);
              });

              var req = getRequest();

              webutils.monitorTransferProgress(read, serverPath, localPath, stats.size, function (progress) {
                logger.debug('%s: read %d of %d bytes, upload %d percent complete, rate of %d bytes/sec', serverPath, progress.read, stats.size, Math.round(progress.read / stats.size * 100), progress.rate);
                _emitContextEvent.call(self, 'syncprogress', progress, context);
              });

              logger.debug('adding path %s to list of active uploads', serverPath);
              self.activeRequests[serverPath] = {};
              self.activeRequests[serverPath].req = req;
              self.activeRequests[serverPath].file = localPath;
              read.pipe(req);
            }
          });
        } else {
          getRequest();
        }
      }
    });
  }
};

function _syncItem(config, tree, item, parentPath, name, method, remotePrefix, localPrefix, cb) {
  var self = this;
  var context = tree.getContext();
  var logger = context.spi();
  logger.debug('path [%s] name [%s] beginning to process %s', parentPath, name, method);

  if (item) {
    method = item.method;

    // initial implementation confused PUT and POST, so swap them for backward compatibility
    if (method == 'PUT') {
      method = 'POST';
    } else if (method == 'POST') {
      method = 'PUT';
    }
  }

  _processItemMethod.call(self, tree, parentPath, name, remotePrefix, localPrefix, method, function (err) {
    if (item) {
      if (err) {
        var immediateFail = false;
        if (err.err) {
          immediateFail = err.immediateFail;
          err = err.err;
        }
        if (immediateFail) {
          self.rq.completeRequest(context, parentPath, name, function (err) {
            if (err) {
              logger.error('unable to immediately remove request for path: %s, name: %s', parentPath, name, err);
            }
            cb();
          });
        } else {
          logger.info('encountered error while attempting to sync path: %s, name: %s. incrementing retry count.', parentPath, name, err);
          self.rq.incrementRetryCount(context, parentPath, name, config.retryDelay, function (err) {
            if (err) {
              logger.error('unable to update retry count for path %s', parentPath, err);
            }
            cb();
          });
        }
      } else {
        self.rq.completeRequest(context, parentPath, name, function (err) {
          cb();
        });
      }
    } else {
      cb(err);
    }
  });
};

/**
 * Executes a sync process by retrieving the oldest ready request from the request queue and executing
 * it against the remote source. Will continue to execute until there are no more pending requests in the
 * queue.
 * @param {Object} config Various configuration options for controlling how the sync will behave.
 * @param {Number} config.expiration The age, in milliseconds, that a request much reach before it will be processed.
 * @param {Number} config.maxRetries The maximum number of times that the processor will attempt to sync a file before purging it.
 * @param {Number} config.retryDelay The amount of time, in milliseconds, that the processor will wait before attempting to retry syncing a record.
 */
RQProcessor.prototype.sync = function (config, cb) {
  var self = this;
  self.currConfig = config;
  self.currCb = cb;
  var context = new SMBContext().withLabel('RQProcessor.sync');
  var tree = self.tree.createTree(context);
  var logger = context.spi();

  function sendResult(err) {
    if (cb) {
      cb(err);
    } else if (err) {
      logger.error('unexpected error while syncing', err);
    }
  }

  var doProcess = true;
  async.whilst(function () {return doProcess;},
    function (callback) {
      logger.debug('checking for requests that need to be processed');
      self.rq.getProcessRequest(context, config.expiration, config.maxRetries, function (err, item) {
        if (err) {
          sendResult(err);
        } else {
          if (item) {
            var path = item.path;
            var name = item.name;
            var method = item.method;

            _syncItem.call(self, config, tree, item, path, name, method, item.remotePrefix, item.localPrefix, function (err) {
              if (err) {
                logger.info('%s sync for path: %s, name: %s failed due to error', method, path, name, err);
              } else {
                logger.debug('finished %s sync for path: %s, name: %s', method, path, name);
              }
              callback();
            });
          } else {
            logger.debug('no more requests to process. finishing sync');
            doProcess = false;
            callback();
          }
        }
      });
    }, function (err) {
      if (err) {
        logger.error('unexpected error during continuous sync process', err);
      }
      sendResult();
    });
};

/**
 * Syncs a single item by its path.
 * @param {String} path Path of the item to sync.
 * @param {Object} options Options for providing information to the sync process.
 * @param {String} options.remotePrefix Prefix to prepend to the path to construct a full URL to the target.
 * @param {String} options.localPrefix Prefix to prepend to the path to construct a full path to the item on disk.
 * @param [Boolean] options.isDelete Optional value that should be set to true if the sync is a delete operation.
 * @param [Function] cb Will be invoked when the operation is complete.
 * @param [Error] cb.err Truthy if there were errors during the sync.
 */
RQProcessor.prototype.syncPath = function (path, options, cb) {
  options = options || {};
  var self = this;
  var context = new SMBContext().withLabel('RQProcessor.syncPath');
  var tree = self.tree.createTree(context);
  var logger = context.spi();
  var parentPath = utils.getParentPath(path);
  var name = utils.getPathName(path);
  var method = options.isDelete ? 'DELETE' : 'PUT';
  var remotePrefix = options.remotePrefix;
  var localPrefix = options.localPrefix;

  function sendResult (err) {
    if (err) {
      logger.error('unexpected error while syncing path', err);
    }
    if (cb) {
      cb(err);
    }
  }

  self.rq.getRequest(context, parentPath, name, function (err, item) {
    if (err) {
      sendResult(err);
      return;
    }
    _syncItem.call(self, options, tree, item, parentPath, name, method, remotePrefix, localPrefix, sendResult);
  });
};

/**
 * Starts the processor by initiating a loop that will run on a regular interval. The loop will check for any
 * requests that are ready to be synced and will perform the operations.
 * @param {Object} config Various configuration options for controlling how the processor will behave.
 * @param {Number} config.maxRetries The maximum number of times that the processor will attempt to sync a file before purging it.
 * @param {Number} config.frequency The amount of time, in milliseconds, between each execution of the processing workflow.
 */
RQProcessor.prototype.start = function (config) {
  logger.info('starting request queue processor');
  var self = this;
  self.stopped = false;

  var doSync = function (cb) {
    logger.debug('request queue processor starting sync process');
    self.sync(config, function (err) {
      if (err) {
        self.emit('error', err);
      }

      self.rq.purgeFailedRequests(config.maxRetries, function (err, purged) {
        if (err) {
          self.emit('error', err);
        } else {
          if (purged.length) {
            logger.debug('found purged requests, sending event');
            self.emit('purged', purged);
          }
        }

        logger.debug('request queue processor ending sync process');

        if (!self.stopped) {
          cb();
        }
      });
    });
  };

  var eventLoop = function () {
    self.timeout = setTimeout(function () {
      doSync(eventLoop);
    }, config.frequency);
  };

  // immediately sync on start
  doSync(eventLoop);
};

/**
 * Stops the processor by exiting the event loop.
 */
RQProcessor.prototype.stop = function () {
  logger.info('stopping request queue processor');
  var self = this;
  if (this.timeout) {
    logger.debug('clearing event loop timeout');
    clearTimeout(this.timeout);
  }
  // abort any active requests
  for (var property in self.activeRequests) {
    logger.info('processor was stopped mid-upload of %s. canceling upload.', property);

    self.abortUpload(property);
  }
  this.stopped = true;
};

module.exports = RQProcessor;
