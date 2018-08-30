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
var JCR = require('../jcr/constants');
var DAM = require('../dam/constants');
var logger = require('../../logging').getLogger('spi');
var utils = require('../../utils');
var webutils = require('../../webutils');
var ntstatus = require('../../ntstatus');
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
  this.options = options;
  this.autoUpload = true;
  this.syncInProgress = false;

  this.rq.on('itemupdated', function (data) {
    var itemPath = data.path;
    var itemContext = data.context;
    var logger = itemContext.spi();
    logger.debug('processor received itemupdated event for %s', itemPath);
    self.share.cancelUpload(itemPath, false);
  });

  this.rq.on('pathupdated', function (data) {
    var path = data.path;
    var itemContext = data.context;
    var logger = itemContext.spi();
    logger.debug('processor received pathupdated event for %s', path);

    self.share.cancelUpload(path, true);
  });
}

util.inherits(RQProcessor, EventEmitter);

function _checkExists(tree, method, path, cb) {
  if (method == 'POST' || method == 'PUT' || method == 'DELETE') {
    this.share.resourceExists(tree, path, cb);
  } else {
    cb(null, false);
  }
}

function _processItemMethod (tree, parentPath, name, localPrefix, method, processCb) {
  var self = this;
  var context = tree.getContext();
  var logger = context.spi();
  var serverPath = Path.join(parentPath, name);
  var localPath = Path.join(localPrefix, serverPath);

  function handleResult(err) {
    if (err) {
      var immediateFail = false;
      if (err.status) {
        immediateFail = (err.status == ntstatus.STATUS_ACCESS_DENIED || err.status == ntstatus.STATUS_NOT_SUPPORTED);
      }
      processCb({err: err, immediateFail: immediateFail});
      return;
    }
    if (method != 'DELETE') {
      tree.refreshWorkFiles(serverPath, function (err) {
        if (err) {
          logger.error('unable to refresh work files for file %s', serverPath, err);
        }
        processCb();
      });
    } else {
      // no need to refresh work files for deleted items
      processCb();
    }
  }

  _checkExists.call(self, tree, method, serverPath, function (err, exists) {
    if (err) {
      self.share.emitSyncFileError(serverPath, method, err);
      handleResult(err);
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
        handleResult();
        return;
      }

      if (method == 'PUT') {
        self.share.updateResource(tree, serverPath, localPath, handleResult);
      } else if (method == 'POST') {
        self.share.createFileResource(tree, serverPath, localPath, handleResult);
      } else {
        // DELETE
        self.share.deleteResource(tree, serverPath, true, handleResult);
      }
    }
  });
};

function _syncItem(config, tree, item, parentPath, name, method, localPrefix, cb) {
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
  _processItemMethod.call(self, tree, parentPath, name, localPrefix, method, function (err) {
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

            _syncItem.call(self, config, tree, item, path, name, method, item.localPrefix, function (err) {
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
      self.share.emitSyncFileError(path, method, err);
      sendResult(err);
      return;
    }
    _syncItem.call(self, options, tree, item, parentPath, name, method, localPrefix, sendResult);
  });
};

function _doSync(config, cb)
{
  var self = this;
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
}

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

  var eventLoop = function () {
    if (self.autoUpload) {
      self.timeout = setTimeout(function () {
        _doSync.call(self, config, eventLoop);
      }, config.frequency);
    }
  };

  // immediately sync on start
  _doSync.call(self, config, eventLoop);
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
  this.stopped = true;
};

/**
 * Starts or stops the automatic sync process
 * @param {boolean} if the autoUpload is false, sync will be done manually.
 */
RQProcessor.prototype.setAutoUpload = function (autoUpload) {
  this.autoUpload = autoUpload;
  if(autoUpload == false ) {
    clearTimeout(this.timeout);
  } else {
    this.start(this.options);
  }
};

/**
 * Starts the processor and syncs all pending requests at once.
 * @param {Object} config Various configuration options for controlling how the processor will behave.
 */
RQProcessor.prototype.syncAll = function (config, cb) {
  logger.info('starting request queue processor');
  var self = this;
  if(this.syncInProgress) {
  	cb();
  	return;
  }
  self.stopped = false;
  var expiration = config.expiration;
  config.expiration = 0;
  // immediately sync on start
  self.syncInProgress = true;
  _doSync.call(self, config, function() {
    config.expiration  = expiration;
    self.syncInProgress = false;
    cb();
  });
};

module.exports = RQProcessor;
